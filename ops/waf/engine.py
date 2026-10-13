"""Bounded, deterministic CC detection. No network or firewall side effects here."""
from __future__ import annotations

from collections import Counter, OrderedDict
from dataclasses import dataclass, field
import ipaddress
import json
import math


def address(value):
    ip = ipaddress.ip_address(value)
    return ip.ipv4_mapped if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped else ip


def configuration(raw):
    defaults = {
        "mode": "observe", "logPath": "/var/log/nginx/cpu-web-waf.jsonl",
        "stateDirectory": "/var/lib/cpu-web-waf", "hosts": [],
        "protectedGroups": ["share"], "allowCidrs": [], "trustedProxyCidrs": [],
        "protectedTcpPorts": [443], "dedicatedIngressConfirmed": False,
        "sharedIngress": True,
        "nginxBinary": "/www/server/nginx/sbin/nginx",
        "nginxConfig": "/www/server/nginx/conf/nginx.conf",
        "adaptiveCooldownSeconds": 180,
        "windowSeconds": 10, "minimumRequests": 200, "attackMinimumRequests": 100,
        "concentration": .95, "minimumRejectedFraction": .5,
        "attackRequestsPerSecond": 150, "baselineMultiplier": 4,
        "recoverySeconds": 60, "banSeconds": 300, "maximumBanSeconds": 3600,
        "strikeMemorySeconds": 86400, "maximumClients": 20000, "maximumBans": 2048,
        "maximumReadBytes": 4194304, "maximumBacklogBytes": 16777216, "pollSeconds": .5,
    }
    if not isinstance(raw, dict) or set(raw) - set(defaults):
        raise ValueError("unknown configuration keys")
    cfg = defaults | raw
    if cfg["mode"] not in ("observe", "adaptive", "enforce"):
        raise ValueError("mode must be observe, adaptive or enforce")
    if type(cfg["sharedIngress"]) is not bool:
        raise ValueError("sharedIngress must be boolean")
    if cfg["mode"] == "enforce" and cfg["sharedIngress"]:
        raise ValueError("shared ingress MUST NOT use IP isolation; use adaptive mode")
    if not isinstance(cfg["dedicatedIngressConfirmed"], bool):
        raise ValueError("dedicatedIngressConfirmed must be boolean")
    if cfg["mode"] == "enforce" and not cfg["dedicatedIngressConfirmed"]:
        raise ValueError("kernel bans affect ALL virtual hosts on protected ports; confirm ingress scope")
    for key in ("hosts", "protectedGroups", "allowCidrs", "trustedProxyCidrs", "protectedTcpPorts"):
        if not isinstance(cfg[key], list) or len(cfg[key]) > 256:
            raise ValueError(f"invalid {key}")
    if not cfg["hosts"] or not all(isinstance(h, str) and 0 < len(h) <= 253 for h in cfg["hosts"]):
        raise ValueError("explicit hosts required")
    if not cfg["protectedGroups"] or len(cfg["protectedGroups"]) > 8 or not all(
        isinstance(g, str) and g.isascii() and g.isalnum() and len(g) <= 24 and g != "other"
        for g in cfg["protectedGroups"]
    ):
        raise ValueError("invalid protectedGroups")
    if not cfg["protectedTcpPorts"] or any(type(p) is not int or not 1 <= p <= 65535 for p in cfg["protectedTcpPorts"]):
        raise ValueError("invalid protectedTcpPorts")
    bounds = {
        "windowSeconds": (2, 60), "minimumRequests": (20, 1000000),
        "attackMinimumRequests": (20, 1000000), "concentration": (.8, 1),
        "minimumRejectedFraction": (.1, 1), "attackRequestsPerSecond": (1, 1000000),
        "baselineMultiplier": (2, 20), "recoverySeconds": (10, 3600),
        "banSeconds": (30, 3600), "maximumBanSeconds": (30, 86400),
        "strikeMemorySeconds": (60, 604800), "maximumClients": (100, 50000),
        "maximumBans": (1, 4096), "maximumReadBytes": (4096, 16777216),
        "maximumBacklogBytes": (4096, 67108864), "pollSeconds": (.1, 10),
        "adaptiveCooldownSeconds": (30, 3600),
    }
    fractions = {"concentration", "minimumRejectedFraction", "baselineMultiplier", "pollSeconds"}
    for key, (low, high) in bounds.items():
        value = cfg[key]
        if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError(f"invalid {key}")
        if key not in fractions and type(value) is not int:
            raise ValueError(f"{key} must be an integer")
    if cfg["attackMinimumRequests"] > cfg["minimumRequests"] or cfg["maximumBanSeconds"] < cfg["banSeconds"]:
        raise ValueError("inconsistent thresholds")
    if cfg["maximumBacklogBytes"] < cfg["maximumReadBytes"]:
        raise ValueError("backlog budget must cover one read")
    for key in ("logPath", "stateDirectory", "nginxBinary", "nginxConfig"):
        if not isinstance(cfg[key], str) or not cfg[key].startswith("/") or "\x00" in cfg[key]:
            raise ValueError(f"{key} must be an absolute Linux path")
    cfg["networks"] = [ipaddress.ip_network(x, strict=True) for x in cfg["allowCidrs"] + cfg["trustedProxyCidrs"]]
    cfg["hosts"] = {h.lower() for h in cfg["hosts"]}
    return cfg


def parse_event(line, now, cfg):
    """Only our JSON schema; never consume combined logs or raw X-Forwarded-For."""
    try:
        if len(line) > 4096:
            return None
        data = json.loads(line)
        timestamp = float(data["ts"])
        if not math.isfinite(timestamp) or not now - cfg["windowSeconds"] < timestamp <= now + 1:
            return None
        if data["v"] != 1 or data["host"].lower() not in cfg["hosts"]:
            return None
        client, peer = address(data["client"]), address(data["peer"])
        group = data["group"] if data["group"] in cfg["protectedGroups"] else "other"
        rejected = data.get("limit") in ("REJECTED", "REJECTED_DRY_RUN")
        # Do not treat generic 4xx/5xx as attacker evidence; outages affect innocent clients.
        return (int(timestamp), str(client), str(peer), group, rejected)
    except (ValueError, TypeError, KeyError, AttributeError):
        return None


@dataclass
class Client:
    buckets: dict = field(default_factory=dict)
    direct: bool = True


class Detector:
    def __init__(self, cfg):
        self.cfg = cfg
        self.clients = OrderedDict()
        self.routes = {}
        self.baseline = 0.0
        self.phase = "normal"
        self.last_hot = 0
        self.last_evaluation = None
        self.evictions = 0

    def reset_window(self):
        self.clients.clear()
        self.routes.clear()

    def eligible(self, ip):
        if self.cfg["sharedIngress"]:
            return False
        obj = address(ip)
        return obj.is_global and not obj.is_multicast and not any(obj in net for net in self.cfg["networks"])

    def ingest(self, event):
        second, ip, peer, group, rejected = event
        if group != "other":
            self.routes.setdefault(second, Counter())[group] += 1
        # Proxy clients contribute to aggregate detection but can NEVER cause a kernel peer ban.
        if ip != peer or not self.eligible(ip):
            if ip in self.clients:
                self.clients[ip].direct = False
            return
        client = self.clients.get(ip)
        if client is None:
            if len(self.clients) >= self.cfg["maximumClients"]:
                self.clients.popitem(last=False)
                self.evictions += 1
            client = self.clients[ip] = Client()
        self.clients.move_to_end(ip)
        bucket = client.buckets.setdefault(second, Counter())
        bucket["total"] += 1
        bucket[group] += 1
        if rejected and group != "other":
            bucket["rejected:" + group] += 1

    def evaluate(self, now):
        cutoff = int(now) - self.cfg["windowSeconds"]
        for second in list(self.routes):
            if second <= cutoff:
                del self.routes[second]
        groups = Counter()
        for counts in self.routes.values():
            groups.update(counts)
        rps = sum(groups.values()) / self.cfg["windowSeconds"]
        trigger = max(self.cfg["attackRequestsPerSecond"], self.baseline * self.cfg["baselineMultiplier"])
        hot = rps >= trigger
        if hot:
            self.phase, self.last_hot = "attack", now
        elif self.phase != "normal" and now - self.last_hot < self.cfg["recoverySeconds"]:
            self.phase = "recovery"
        else:
            self.phase = "normal"
            # Time-normalized, capped baseline; floods cannot train an unlimited threshold.
            elapsed = min(10, max(0, now - (self.last_evaluation or now)))
            alpha = 1 - math.exp(-elapsed / 300)
            target = min(rps, self.cfg["attackRequestsPerSecond"] / 2)
            self.baseline += alpha * (target - self.baseline)
        self.last_evaluation = now
        minimum = self.cfg["attackMinimumRequests"] if self.phase != "normal" else self.cfg["minimumRequests"]
        decisions = []
        for ip, client in list(self.clients.items()):
            for second in list(client.buckets):
                if second <= cutoff:
                    del client.buckets[second]
            if not client.buckets:
                del self.clients[ip]
                continue
            counts = Counter()
            for bucket in client.buckets.values():
                counts.update(bucket)
            group = max(self.cfg["protectedGroups"], key=lambda g: counts[g])
            count, total = counts[group], counts["total"]
            if (client.direct and count >= minimum and count / total >= self.cfg["concentration"]
                    and counts["rejected:" + group] / count >= self.cfg["minimumRejectedFraction"]):
                decisions.append({"ip": ip, "group": group, "requests": count, "total": total,
                                  "rejected": counts["rejected:" + group], "phase": self.phase})
        return decisions, {"phase": self.phase, "rps": rps, "baseline": round(self.baseline, 3),
                           "clients": len(self.clients), "evictions": self.evictions}


class BanBook:
    """Kernel TTL is authoritative; this book prevents renewal on every poll."""
    def __init__(self, cfg):
        self.cfg, self.entries = cfg, {}

    def prune(self, now):
        self.entries = {ip: e for ip, e in self.entries.items() if e["rememberUntil"] > now}

    def proposal(self, decision, now):
        self.prune(now)
        ip = decision["ip"]
        old = self.entries.get(ip)
        if old and old["expires"] > now:
            return None
        if sum(e["expires"] > now for e in self.entries.values()) >= self.cfg["maximumBans"]:
            return None
        if ip not in self.entries and len(self.entries) >= self.cfg["maximumBans"] * 2:
            expired = [key for key, e in self.entries.items() if e["expires"] <= now]
            if not expired:
                return None
            del self.entries[min(expired, key=lambda key: self.entries[key]["rememberUntil"])]
        strikes = min(16, old["strikes"] + 1) if old else 1
        seconds = min(self.cfg["maximumBanSeconds"], self.cfg["banSeconds"] * 2 ** (strikes - 1))
        return decision | {"seconds": seconds, "strikes": strikes, "expires": now + seconds,
                           "rememberUntil": now + max(seconds, self.cfg["strikeMemorySeconds"])}

    def commit(self, ban):
        self.entries[ban["ip"]] = {k: ban[k] for k in ("expires", "rememberUntil", "strikes")}
