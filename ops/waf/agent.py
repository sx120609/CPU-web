#!/usr/bin/env python3
"""CPU-web CC guard. Standard library only; observe is the default."""
from __future__ import annotations

import argparse
from collections import Counter
import ipaddress
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

from engine import BanBook, Detector, address, configuration, parse_event
from adaptive import Adaptive

TABLE = "cpu_web_waf"
OWNER = "CPU-web dynamic WAF v1"


def atomic_json(path, data):
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=True, separators=(",", ":"))
        f.flush()
        os.fsync(f.fileno())
    os.replace(temporary, path)


class LogTail:
    """Incremental reads, no historical replay at startup; rotation and lag are explicit gaps."""
    def __init__(self, path, read_budget, backlog_budget, start_at_end=True):
        self.path, self.read_budget, self.backlog_budget = Path(path), read_budget, backlog_budget
        self.start_at_end = start_at_end
        self.file = None
        self.identity = None
        self.pending = b""
        self.discard = False

    def close(self):
        if self.file:
            self.file.close()
            self.file = None

    def read(self):
        try:
            stat = self.path.stat()
        except FileNotFoundError:
            return [], "missing"
        identity = (stat.st_dev, stat.st_ino)
        gap = None
        if self.file is None or identity != self.identity:
            first = self.identity is None
            self.close()
            self.file = self.path.open("rb")
            self.identity = identity
            self.pending = b""
            self.discard = False
            if first and self.start_at_end:
                self.file.seek(0, os.SEEK_END)
                gap = "startup_tail"
            elif not first:
                gap = "rotation"
        if stat.st_size < self.file.tell():
            self.file.seek(0)
            self.pending = b""
            self.discard = False
            gap = "truncated"
        if stat.st_size - self.file.tell() > self.backlog_budget:
            self.file.seek(max(0, stat.st_size - self.read_budget))
            self.pending = b""
            self.discard = True
            gap = "backlog_skipped"
        data = self.pending + self.file.read(self.read_budget)
        parts = data.split(b"\n")
        self.pending = parts.pop()
        if self.discard and parts:
            parts.pop(0)
            self.discard = False
        if len(self.pending) > 4096:
            self.pending = b""
            self.discard = True
            gap = gap or "oversize_line"
        return [line for line in parts if len(line) <= 4096], gap


def command(args, **kwargs):
    return subprocess.run(args, text=True, capture_output=True, timeout=5, check=True, **kwargs)


class Firewall:
    def __init__(self, cfg, execute=command):
        self.cfg, self.execute = cfg, execute

    def ensure(self):
        # Listing all tables distinguishes a missing table from a permission/tool failure.
        tables = json.loads(self.execute(["nft", "-j", "list", "tables"]).stdout)["nftables"]
        exists = any(x.get("table", {}).get("name") == TABLE and x["table"].get("family") == "inet" for x in tables)
        if exists:
            data = json.loads(self.execute(["nft", "-j", "list", "table", "inet", TABLE]).stdout)["nftables"]
            owned = any(x.get("table", {}).get("comment") == OWNER for x in data)
            if not owned:
                raise RuntimeError("refusing to use an unowned firewall table")
            # Do not silently keep a different port scope after config changes.
            found = [x["chain"].get("comment") for x in data if "chain" in x and x["chain"].get("name") == "ingress"]
            if found != [self.scope()]:
                raise RuntimeError("firewall port scope differs; stop guard and remove its table before reconfiguration")
            return
        ports = ", ".join(str(p) for p in sorted(set(self.cfg["protectedTcpPorts"])))
        rules = f'''table inet {TABLE} {{
 comment "{OWNER}"
 set banned4 {{ type ipv4_addr; flags timeout; timeout 5m; size 4096; }}
 set banned6 {{ type ipv6_addr; flags timeout; timeout 5m; size 4096; }}
 chain ingress {{
  type filter hook input priority -10; policy accept;
  comment "{self.scope()}"
  ip saddr @banned4 tcp dport {{ {ports} }} counter drop
  ip6 saddr @banned6 tcp dport {{ {ports} }} counter drop
 }}
}}
'''
        self.execute(["nft", "--check", "-f", "-"], input=rules)
        self.execute(["nft", "-f", "-"], input=rules)

    def scope(self):
        return "TCP ports " + ",".join(str(p) for p in sorted(set(self.cfg["protectedTcpPorts"])))

    def active(self, now):
        output = {}
        for family in (4, 6):
            objects = json.loads(self.execute(["nft", "-j", "list", "set", "inet", TABLE, f"banned{family}"]).stdout)["nftables"]
            for obj in objects:
                for item in obj.get("set", {}).get("elem", []):
                    elem = item.get("elem", {}) if isinstance(item, dict) else {}
                    if not isinstance(elem.get("val"), str) or type(elem.get("expires")) not in (int, float):
                        raise RuntimeError("unexpected nft timeout schema; cannot reconcile bans")
                    ip = address(elem["val"])
                    # libnftables JSON reports whole SECONDS, not kernel netlink milliseconds.
                    # Round conservatively so a near-expiring entry is not renewed early.
                    seconds = elem["expires"]
                    if seconds >= 0:
                        output[str(ip)] = now + min(seconds + 1, 86401)
        return output

    def live_peers(self):
        expression = "( " + " or ".join(f"sport = :{p}" for p in self.cfg["protectedTcpPorts"]) + " )"
        rows = self.execute(["ss", "-Htn", "state", "established", expression]).stdout.splitlines()
        peers = set()
        for row in rows:
            fields = row.split()
            if len(fields) < 4:
                continue
            try:
                peers.add(str(address(fields[3].rsplit(":", 1)[0].strip("[]"))))
            except ValueError:
                continue
        return peers

    def add(self, bans):
        if not bans:
            return
        lines = []
        for ban in bans:
            ip = address(ban["ip"])
            seconds = ban["seconds"]
            if type(seconds) is not int or not 30 <= seconds <= 86400:
                raise ValueError("invalid ban timeout")
            lines.append(f"add element inet {TABLE} banned{ip.version} {{ {ip} timeout {seconds}s }}")
        # nft applies a batch atomically. No shell interpolation, rule flushing or nginx reload.
        self.execute(["nft", "-f", "-"], input="\n".join(lines) + "\n")

    def remove(self, ips):
        lines = []
        for value in ips:
            ip = address(value)
            lines.append(f"delete element inet {TABLE} banned{ip.version} {{ {ip} }}")
        if lines:
            self.execute(["nft", "-f", "-"], input="\n".join(lines) + "\n")


def restore_book(path, book, detector, now, active=None):
    if path.exists():
        if path.stat().st_size > 2097152:
            raise ValueError("ban state exceeds budget")
        saved = json.loads(path.read_text(encoding="utf-8"))
        for ip, entry in list(saved.items())[:book.cfg["maximumBans"] * 2]:
            if not detector.eligible(ip) or not isinstance(entry, dict):
                continue
            expiry, memory, strikes = entry.get("expires"), entry.get("rememberUntil"), entry.get("strikes")
            if (type(expiry) not in (int, float) or type(memory) not in (int, float)
                    or not math_finite(expiry, memory) or type(strikes) is not int or not 1 <= strikes <= 16):
                continue
            if now < memory <= now + max(book.cfg["strikeMemorySeconds"], book.cfg["maximumBanSeconds"]):
                book.entries[str(address(ip))] = {"expires": min(expiry, now + book.cfg["maximumBanSeconds"]),
                                                  "rememberUntil": memory, "strikes": strikes}
    if active is not None:
        for ip, entry in book.entries.items():
            entry["expires"] = active.get(ip, 0)
        for ip, expiry in active.items():
            book.entries.setdefault(ip, {"strikes": 1, "rememberUntil": now + book.cfg["strikeMemorySeconds"]})["expires"] = expiry


def math_finite(*values):
    import math
    return all(math.isfinite(x) for x in values)


def replay(cfg, source):
    detector, book = Detector(cfg), BanBook(cfg)
    clock, last_check, accepted, rejected, count = 0, 0, 0, 0, 0
    phases = Counter()
    for line in source:
        if len(line) > 4096:
            rejected += 1
            continue
        try:
            timestamp = float(json.loads(line)["ts"])
            if not math_finite(timestamp) or timestamp < 0:
                raise ValueError()
        except (ValueError, TypeError, KeyError):
            rejected += 1
            continue
        clock = max(clock, timestamp)
        event = parse_event(line, clock, cfg)
        if not event:
            rejected += 1
            continue
        detector.ingest(event)
        accepted += 1
        if clock - last_check >= cfg["pollSeconds"]:
            decisions, status = detector.evaluate(clock)
            phases[status["phase"]] += 1
            for decision in decisions:
                ban = book.proposal(decision, clock)
                if ban:
                    book.commit(ban)
                    count += 1
            last_check = clock
    decisions, status = detector.evaluate(clock)
    for decision in decisions:
        ban = book.proposal(decision, clock)
        if ban:
            book.commit(ban)
            count += 1
    return {"mode": "replay-no-enforcement", "accepted": accepted, "ignored": rejected,
            "wouldBan": count, "phases": dict(phases), "final": status}


def run(cfg):
    import fcntl
    os.umask(0o077)
    directory = Path(cfg["stateDirectory"])
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / "agent.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        audit = logging.getLogger("cpu-web-waf")
        audit.setLevel(logging.INFO)
        handler = RotatingFileHandler(directory / "audit.jsonl", maxBytes=10485760, backupCount=3)
        audit.addHandler(handler)
        def record(kind, **data):
            audit.info(json.dumps({"ts": time.time(), "event": kind, **data}, separators=(",", ":")))
        detector, book = Detector(cfg), BanBook(cfg)
        firewall = Firewall(cfg) if cfg["mode"] == "enforce" else None
        adaptive = Adaptive(cfg, command) if cfg["mode"] == "adaptive" else None
        if adaptive:
            adaptive.initialize()
        if firewall:
            firewall.ensure()
        state = directory / ("bans.json" if firewall else "observe-bans.json")
        active = firewall.active(time.time()) if firewall else None
        if active is not None:
            exempt = [ip for ip in active if not detector.eligible(ip)]
            firewall.remove(exempt)
            for ip in exempt:
                del active[ip]
        restore_book(state, book, detector, time.time(), active)
        tail = LogTail(cfg["logPath"], cfg["maximumReadBytes"], cfg["maximumBacklogBytes"])
        stopping = False
        def stop(*_):
            nonlocal stopping
            stopping = True
        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        errors, ignored, processed, last_write, last_phase, last_gap = 0, 0, 0, 0, None, None
        record("started", mode=cfg["mode"])
        try:
            while not stopping:
                now = time.time()
                try:
                    lines, gap = tail.read()
                    if gap:
                        detector.reset_window()
                        if gap != last_gap:
                            record("log_gap", reason=gap)
                    last_gap = gap
                    for line in lines:
                        event = parse_event(line, now, cfg)
                        if event:
                            detector.ingest(event)
                            processed += 1
                        else:
                            ignored += 1
                    decisions, status = detector.evaluate(now)
                    if adaptive:
                        if adaptive.apply(status["phase"]):
                            record("route_budget", tight=adaptive.current(), note="no IP isolation")
                        status["routeBudget"] = "tight" if adaptive.current() else "normal"
                    if status["phase"] != last_phase:
                        record("phase", **status)
                        last_phase = status["phase"]
                    proposals = []
                    peers = firewall.live_peers() if firewall and decisions else None
                    for decision in decisions:
                        if peers is not None and decision["ip"] not in peers:
                            continue
                        ban = book.proposal(decision, now)
                        if ban:
                            proposals.append(ban)
                            # Bound netlink batch size; commit only after command success.
                            if len(proposals) >= 64:
                                break
                    active_count = sum(e["expires"] > now for e in book.entries.values())
                    proposals = proposals[:max(0, cfg["maximumBans"] - active_count)]
                    if firewall:
                        firewall.add(proposals)
                    for ban in proposals:
                        book.commit(ban)
                        record("ban" if firewall else "would_ban", **ban)
                    if proposals or now - last_write >= 5:
                        book.prune(now)
                        atomic_json(state, book.entries)
                        atomic_json(directory / "status.json", status | {"ts": now, "mode": cfg["mode"],
                            "processed": processed, "ignored": ignored, "errors": errors, "logGap": gap,
                            "activeBans": sum(e["expires"] > now for e in book.entries.values())})
                        last_write = now
                except Exception as exc:
                    errors += 1
                    detector.reset_window()
                    record("error", type=type(exc).__name__, message=str(exc)[:300])
                    atomic_json(directory / "status.json", {"ts": now, "mode": cfg["mode"],
                                "health": "degraded", "errors": errors, "errorType": type(exc).__name__})
                    # Existing TTLs continue to expire even if nft/logs fail. Never flush other rules.
                    time.sleep(min(5, cfg["pollSeconds"] * 4))
                time.sleep(cfg["pollSeconds"])
        finally:
            tail.close()
            record("stopped", note="kernel entries expire independently")
            handler.close()
            audit.removeHandler(handler)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("check", "run", "replay", "init-adaptive"))
    parser.add_argument("--config", required=True)
    parser.add_argument("--input", help="our JSONL schema only; replay never creates a firewall")
    args = parser.parse_args()
    cfg = configuration(json.loads(Path(args.config).read_text(encoding="utf-8")))
    if args.action == "check":
        print(json.dumps({"valid": True, "mode": cfg["mode"]}))
    elif args.action == "init-adaptive":
        Adaptive(cfg, command).initialize()
    elif args.action == "replay":
        if not args.input:
            parser.error("replay requires --input")
        with Path(args.input).open("rb") as source:
            print(json.dumps(replay(cfg, source)))
    else:
        if sys.platform != "linux":
            parser.error("run requires Linux; check and replay are portable")
        run(cfg)


if __name__ == "__main__":
    main()
