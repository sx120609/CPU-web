"""Run ONLY in a fresh network namespace: sudo unshare --net ... python3 this_file."""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest

from agent import Firewall, TABLE
from engine import configuration

ENABLED = os.environ.get("CPU_WAF_NETNS_TEST") == "1"
if ENABLED:
    if sys.platform != "linux" or os.geteuid() != 0:
        raise RuntimeError("isolated kernel test requires Linux root")
    if os.readlink("/proc/self/ns/net") == os.readlink("/proc/1/ns/net"):
        raise RuntimeError("refusing to touch the host network namespace")
    if not all(shutil.which(x) for x in ("nft", "ss", "ip")):
        raise RuntimeError("nft, ss and ip required")


@unittest.skipUnless(ENABLED, "explicit isolated network namespace required")
class KernelTest(unittest.TestCase):
    def test_real_daemon_blocks_only_proven_source_and_ttl_survives_exit(self):
        subprocess.run(["ip", "link", "set", "lo", "up"], check=True)
        subprocess.run(["ip", "address", "add", "8.8.8.8/32", "dev", "lo"], check=True)
        subprocess.run(["nft", "add", "table", "inet", "unrelated_test_table"], check=True)
        root = Path(self.enterContext(tempfile.TemporaryDirectory(prefix="cpu-waf-kernel-")))
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        listener.listen(20)
        self.addCleanup(listener.close)
        port = listener.getsockname()[1]
        attacker = socket.socket()
        self.addCleanup(attacker.close)
        attacker.bind(("8.8.8.8", 0))
        attacker.connect(("127.0.0.1", port))
        accepted, _ = listener.accept()
        self.addCleanup(accepted.close)
        logfile = root / "access.jsonl"
        logfile.touch()
        raw = {"hosts": ["cputime.cn"], "mode": "enforce", "dedicatedIngressConfirmed": True,
               "sharedIngress": False,
               "protectedTcpPorts": [port], "stateDirectory": str(root / "state"), "logPath": str(logfile),
               "minimumRequests": 20, "attackMinimumRequests": 20, "banSeconds": 30,
               "maximumBanSeconds": 30, "pollSeconds": .1}
        path = root / "config.json"
        path.write_text(json.dumps(raw))
        process = subprocess.Popen([sys.executable, str(Path(__file__).with_name("agent.py")), "run", "--config", str(path)], stderr=subprocess.PIPE)
        def stop():
            if process.poll() is None:
                process.terminate()
            process.wait(timeout=5)
            process.stderr.close()
        self.addCleanup(stop)
        status = root / "state/status.json"
        for _ in range(100):
            if status.exists():
                break
            if process.poll() is not None:
                self.fail(process.stderr.read().decode())
            time.sleep(.05)
        self.assertTrue(status.exists(), "daemon must start")
        with logfile.open("a") as output:
            for _ in range(30):
                print(json.dumps({"v": 1, "ts": time.time(), "host": "cputime.cn", "client": "8.8.8.8",
                                  "peer": "8.8.8.8", "group": "share", "limit": "REJECTED"}), file=output)
        firewall = Firewall(configuration(raw))
        expires = None
        for _ in range(100):
            active = firewall.active(time.time())
            if "8.8.8.8" in active:
                expires = active["8.8.8.8"]
                break
            time.sleep(.05)
        self.assertIsNotNone(expires, (root / "state/audit.jsonl").read_text())
        # Actual TCP SYN from the banned source is dropped, a different peer still connects.
        blocked = socket.socket()
        self.addCleanup(blocked.close)
        blocked.settimeout(.3)
        blocked.bind(("8.8.8.8", 0))
        with self.assertRaises(TimeoutError):
            blocked.connect(("127.0.0.1", port))
        with socket.create_connection(("127.0.0.1", port), timeout=.5):
            pass
        subprocess.run(["nft", "list", "table", "inet", "unrelated_test_table"], check=True, capture_output=True)
        process.terminate()
        process.wait(timeout=5)
        self.assertIn("8.8.8.8", firewall.active(time.time()))
        time.sleep(max(0, expires - time.time()) + .3)
        self.assertNotIn("8.8.8.8", firewall.active(time.time()), subprocess.check_output(["nft", "-j", "list", "set", "inet", TABLE, "banned4"], text=True))
        with socket.socket() as recovered:
            recovered.bind(("8.8.8.8", 0))
            recovered.settimeout(.5)
            recovered.connect(("127.0.0.1", port))


if __name__ == "__main__":
    unittest.main()
