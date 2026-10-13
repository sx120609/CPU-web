import io
import json
from pathlib import Path
import subprocess
import tempfile
import tarfile
import unittest

from agent import Firewall, LogTail, OWNER, TABLE, atomic_json, replay, restore_book
from engine import BanBook, Detector, configuration, parse_event
from package import build, verify


def config(**overrides):
    return configuration({"hosts": ["cputime.cn"], "sharedIngress": False, **overrides})


def event(ts=100, ip="8.8.8.8", peer=None, group="share", rejected=True):
    return json.dumps({"v": 1, "ts": str(ts), "host": "cputime.cn", "client": ip,
                       "peer": peer or ip, "group": group,
                       "limit": "REJECTED" if rejected else "PASSED"})


def feed(detector, count, **options):
    for _ in range(count):
        detector.ingest(parse_event(event(**options), options.get("ts", 100), detector.cfg))


class DetectionTests(unittest.TestCase):
    def test_default_service_has_no_kernel_firewall_permission(self):
        service = Path(__file__).with_name('cpu-web-waf.service').read_text()
        line = next(line for line in service.splitlines() if line.startswith('CapabilityBoundingSet='))
        self.assertNotIn('CAP_NET_ADMIN', line)
        self.assertIn('CAP_NET_BIND_SERVICE', line)
        self.assertIn('NoNewPrivileges=true', service)

    def test_shared_campus_can_never_be_ip_isolated_even_during_attack(self):
        d = Detector(config(sharedIngress=True, mode="adaptive", attackRequestsPerSecond=10))
        feed(d, 50000)
        decisions, status = d.evaluate(101)
        self.assertEqual(status["phase"], "attack")
        self.assertEqual(decisions, [])
        self.assertEqual(len(d.clients), 0)
        with self.assertRaises(ValueError):
            config(sharedIngress=True, mode="enforce", dedicatedIngressConfirmed=True)
    def test_ban_requires_concentration_and_rejection_evidence(self):
        d = Detector(config())
        feed(d, 250, rejected=False)
        self.assertEqual(d.evaluate(101)[0], [])  # popular legitimate page
        d = Detector(config())
        feed(d, 250)
        feed(d, 100, group="other", rejected=False)
        self.assertEqual(d.evaluate(101)[0], [])  # mixed campus NAT traffic
        d = Detector(config())
        feed(d, 250)
        ban = d.evaluate(101)[0][0]
        self.assertEqual((ban["requests"], ban["ip"]), (250, "8.8.8.8"))

    def test_distributed_attack_changes_mode_and_recovers(self):
        d = Detector(config(attackRequestsPerSecond=50))
        for i in range(1, 6):
            feed(d, 110, ip=f"8.8.8.{i}")
        decisions, status = d.evaluate(101)
        self.assertEqual(status["phase"], "attack")
        self.assertEqual(len(decisions), 5)
        self.assertEqual(d.evaluate(112)[1]["phase"], "recovery")
        self.assertEqual(d.evaluate(162)[1]["phase"], "normal")
        self.assertEqual(d.clients, {})

    def test_proxy_forwarded_identity_is_never_banned_at_kernel(self):
        d = Detector(config())
        feed(d, 1000, ip="8.8.8.8", peer="1.1.1.1")
        self.assertEqual(d.evaluate(101)[0], [])
        self.assertNotIn("1.1.1.1", d.clients)

    def test_allowlist_private_ipv6_and_mapped_addresses(self):
        d = Detector(config(allowCidrs=["8.8.8.0/24"], trustedProxyCidrs=["1.1.1.1/32"]))
        for ip in ("8.8.8.8", "1.1.1.1", "127.0.0.1", "10.2.3.4", "::1", "::ffff:8.8.8.8"):
            feed(d, 250, ip=ip)
        self.assertEqual(d.evaluate(101)[0], [])
        feed(d, 250, ip="2606:4700:4700::1111")
        self.assertEqual(d.evaluate(101)[0][0]["ip"], "2606:4700:4700::1111")

    def test_buckets_expire_and_clock_baseline_cannot_be_poisoned(self):
        d = Detector(config())
        feed(d, 50000)
        d.evaluate(101)
        self.assertEqual(d.baseline, 0)
        self.assertEqual(d.evaluate(111)[0], [])
        for ts in range(200, 250):
            feed(d, 30, ts=ts, rejected=False)
            d.evaluate(ts)
        self.assertLessEqual(d.baseline, d.cfg["attackRequestsPerSecond"] / 2)

    def test_client_budget_is_bounded_and_eviction_does_not_ban(self):
        d = Detector(config(maximumClients=100))
        for i in range(200):
            feed(d, 1, ip=f"8.8.9.{i}")
        self.assertEqual(len(d.clients), 100)
        self.assertEqual(d.evictions, 100)
        self.assertEqual(d.evaluate(101)[0], [])

    def test_stale_future_invalid_and_untrusted_host_logs_are_ignored(self):
        cfg = config()
        for line in (event(ts=70), event(ts=103), "not json", '[]', event(ip="; rm"),
                     event().replace('cputime.cn', 'attacker.example'),
                     event().replace('"100"', '"NaN"'), " " * 4097):
            self.assertIsNone(parse_event(line, 100, cfg))

    def test_status_code_and_fake_ua_alone_are_not_evidence(self):
        d = Detector(config())
        item = json.loads(event(rejected=False)) | {"status": 500, "ua": "bad bot", "xff": "1.1.1.1"}
        for _ in range(400):
            d.ingest(parse_event(json.dumps(item), 100, d.cfg))
        self.assertEqual(d.evaluate(101)[0], [])

    def test_configuration_rejects_unsafe_modes_and_numbers(self):
        for override in ({"mode": "enforce"}, {"pollSeconds": float("nan")},
                         {"protectedTcpPorts": ["443; flush ruleset"]}, {"minimumRequests": True},
                         {"windowSeconds": 10.5}, {"unknown": 1}, {"hosts": []},
                         {"allowCidrs": ["0.0.0.1/0"]}, {"logPath": "relative"}):
            with self.assertRaises(ValueError):
                config(**override)


class BanTests(unittest.TestCase):
    def test_no_poll_renewal_exponential_repeat_and_expiry(self):
        b = BanBook(config())
        first = b.proposal({"ip": "8.8.8.8"}, 100)
        b.commit(first)
        self.assertEqual(first["seconds"], 300)
        self.assertIsNone(b.proposal({"ip": "8.8.8.8"}, 200))
        second = b.proposal({"ip": "8.8.8.8"}, 401)
        b.commit(second)
        self.assertEqual(second["seconds"], 600)
        third = b.proposal({"ip": "8.8.8.8"}, 100000)
        self.assertEqual(third["seconds"], 300)

    def test_capacity_and_failure_do_not_commit(self):
        b = BanBook(config(maximumBans=1))
        proposal = b.proposal({"ip": "8.8.8.8"}, 100)
        self.assertEqual(b.entries, {})
        b.commit(proposal)
        self.assertIsNone(b.proposal({"ip": "1.1.1.1"}, 100))

    def test_restart_reconciles_with_kernel_not_old_disk_expiry(self):
        cfg = config()
        b = BanBook(cfg)
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / "state.json"
            atomic_json(p, {"8.8.8.8": {"expires": 500, "strikes": 2, "rememberUntil": 1000}})
            restore_book(p, b, Detector(cfg), 100, {"1.1.1.1": 150})
        self.assertEqual(b.entries["8.8.8.8"]["expires"], 0)
        self.assertEqual(b.entries["1.1.1.1"]["expires"], 150)


class TailTests(unittest.TestCase):
    def test_startup_skips_history_partial_lines_and_copytruncate(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / "access.log"
            p.write_bytes(b"historical\n")
            t = LogTail(p, 4096, 8192)
            self.addCleanup(t.close)
            self.assertEqual(t.read(), ([], "startup_tail"))
            with p.open("ab") as f:
                f.write(b'{"new":')
            self.assertEqual(t.read(), ([], None))
            with p.open("ab") as f:
                f.write(b'1}\n')
            self.assertEqual(t.read()[0], [b'{"new":1}'])
            p.write_bytes(b"new\n")
            self.assertEqual(t.read(), ([b"new"], "truncated"))
            t.close()

    def test_rotation_and_backlog_skip_do_not_join_different_lines(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / "access.log"
            p.write_bytes(b"old\npartial")
            t = LogTail(p, 4096, 8192, start_at_end=False)
            self.addCleanup(t.close)
            self.assertEqual(t.read()[0], [b"old"])
            # Windows cannot rename an open handle; real rotation is exercised on Linux.
            if sys_platform() != "win32":
                p.rename(p.with_suffix(".old"))
                p.write_bytes(b"fresh\n")
                self.assertEqual(t.read(), ([b"fresh"], "rotation"))
            with p.open("ab") as f:
                f.write(b"x" * 10000 + b"\nlast\n")
            lines, gap = t.read()
            self.assertEqual(gap, "backlog_skipped")
            self.assertEqual(lines, [b"last"])
            t.close()

    def test_oversized_line_does_not_parse_its_tail_as_an_event(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / "access.log"
            p.write_bytes(b"x" * 4500 + b'{}\nvalid\n')
            t = LogTail(p, 4096, 10000, start_at_end=False)
            self.addCleanup(t.close)
            self.assertEqual(t.read()[0], [])
            self.assertEqual(t.read()[0], [b"valid"])
            t.close()


def sys_platform():
    import sys
    return sys.platform


class FirewallTests(unittest.TestCase):
    def test_no_shell_and_only_owned_sets(self):
        calls = []
        def fake(args, **kwargs):
            calls.append((args, kwargs))
            return subprocess.CompletedProcess(args, 0, '{"nftables": []}', '')
        f = Firewall(config(), fake)
        f.ensure()
        f.add([{"ip": "8.8.8.8", "seconds": 300}, {"ip": "2606:4700:4700::1111", "seconds": 600}])
        self.assertNotIn("flush ruleset", str(calls))
        self.assertIn("banned6", calls[-1][1]["input"])
        self.assertIn("timeout 300s", calls[-1][1]["input"])
        self.assertTrue(all("shell" not in kwargs for _, kwargs in calls))
        with self.assertRaises(ValueError):
            f.add([{"ip": "8.8.8.8; flush ruleset", "seconds": 300}])

    def test_existing_foreign_table_or_scope_is_rejected(self):
        def fake(args, **kwargs):
            return subprocess.CompletedProcess(args, 0, json.dumps({"nftables": [
                {"table": {"family": "inet", "name": TABLE, "comment": "someone else"}}
            ]}), '')
        with self.assertRaises(RuntimeError):
            Firewall(config(), fake).ensure()

    def test_kernel_ttls_are_read_without_resetting(self):
        def fake(args, **kwargs):
            elem = [{"elem": {"val": "8.8.8.8", "expires": 123}}] if args[-1] == "banned4" else []
            return subprocess.CompletedProcess(args, 0, json.dumps({"nftables": [{"set": {"elem": elem}}]}), '')
        self.assertEqual(Firewall(config(), fake).active(100)["8.8.8.8"], 224)

    def test_ss_ipv4_ipv6_parser(self):
        def fake(args, **kwargs):
            return subprocess.CompletedProcess(args, 0,
                '0 0 127.0.0.1:443 8.8.8.8:1234\n0 0 [::1]:443 [2606:4700:4700::1111]:4567\n', '')
        self.assertEqual(Firewall(config(), fake).live_peers(), {"8.8.8.8", "2606:4700:4700::1111"})

    def test_replay_never_calls_firewall_even_with_enforce_config(self):
        cfg = config(mode="enforce", dedicatedIngressConfirmed=True)
        source = io.StringIO("\n".join(event(ts=100 + i / 1000) for i in range(250)))
        result = replay(cfg, source)
        self.assertEqual(result["mode"], "replay-no-enforcement")
        self.assertEqual(result["wouldBan"], 1)


class PackageTests(unittest.TestCase):
    def test_commit_hashes_and_archive_paths_are_verified(self):
        with tempfile.TemporaryDirectory() as directory:
            artifact = build("a" * 40, directory)
            manifest = verify(artifact, "a" * 40)
            self.assertIn("ops/waf/agent.py", manifest["files"])
            with self.assertRaises(ValueError):
                verify(artifact, "b" * 40)
            tampered = Path(directory) / "tampered.tar.gz"
            with tarfile.open(artifact, "r:gz") as original, tarfile.open(tampered, "w:gz") as output:
                for member in original.getmembers():
                    data = original.extractfile(member).read()
                    if member.name == "ops/waf/agent.py":
                        data += b"# modified"
                        member.size = len(data)
                    output.addfile(member, io.BytesIO(data))
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                verify(tampered, "a" * 40)

    def test_short_commit_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                build("main", directory)


if __name__ == "__main__":
    unittest.main()
