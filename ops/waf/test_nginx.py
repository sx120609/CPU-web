"""Real nginx integration. REQUIRE_WAF_NGINX=1 makes missing nginx a hard failure."""
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import unittest

from engine import configuration, parse_event
from adaptive import Adaptive, content
from agent import command

ROOT = Path(__file__).resolve().parent
NGINX = os.environ.get("TEST_NGINX_BIN") or shutil.which("nginx")
if os.environ.get("REQUIRE_WAF_NGINX") == "1" and not NGINX:
    raise RuntimeError("real nginx required")


class Origin(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *_):
        pass


@unittest.skipUnless(NGINX, "nginx is not installed; CI requires it")
class NginxTests(unittest.TestCase):
    def test_failed_adaptive_update_restores_map_and_backs_off(self):
        directory = self.enterContext(tempfile.TemporaryDirectory(prefix="cpu-waf-rollback-"))
        cfg = configuration({"hosts": ["cputime.cn"], "stateDirectory": directory})
        calls = []
        def fail(args):
            calls.append(args)
            raise RuntimeError("nginx config conflict")
        control = Adaptive(cfg, fail)
        control.initialize()
        with self.assertRaisesRegex(RuntimeError, "config conflict"):
            control.apply("attack", now=1000)
        self.assertFalse(control.current())
        self.assertFalse(control.apply("attack", now=1001))
        self.assertEqual(len(calls), 2)

    def exercise(self, dry_run, trusted_proxy=False, tight=False):
        origin = ThreadingHTTPServer(("127.0.0.1", 0), Origin)
        origin.daemon_threads = True
        thread = threading.Thread(target=origin.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(origin.server_close)
        self.addCleanup(origin.shutdown)
        directory = Path(self.enterContext(tempfile.TemporaryDirectory(prefix="cpu-waf-nginx-")))
        with socket.socket() as reserve:
            reserve.bind(("127.0.0.1", 0))
            port = reserve.getsockname()[1]
        logfile = directory / "access.jsonl"
        (directory / "nginx").mkdir()
        adaptive_map = directory / "nginx/adaptive.conf"
        adaptive_map.write_text(content(False))
        http_snippet = (ROOT / "nginx-http.conf").read_text().replace('/var/lib/cpu-web-waf/nginx/adaptive.conf', str(adaptive_map))
        server = (ROOT / "nginx-server.conf").read_text().replace("/var/log/nginx/cpu-web-waf.jsonl", str(logfile))
        if not dry_run:
            server = server.replace("dry_run on;", "dry_run off;")
        proxy = "set_real_ip_from 127.0.0.1; real_ip_header X-Forwarded-For;" if trusted_proxy else ""
        config = directory / "nginx.conf"
        config.write_text(f'''daemon off; master_process on; worker_processes 1; pid {directory}/nginx.pid;
error_log {directory}/error.log warn;
events {{ worker_connections 1024; }}
http {{
 client_body_temp_path {directory}/body;
 proxy_temp_path {directory}/proxy;
 fastcgi_temp_path {directory}/fastcgi;
 uwsgi_temp_path {directory}/uwsgi;
 scgi_temp_path {directory}/scgi;
 {http_snippet}
 server {{ listen 127.0.0.1:{port}; server_name cputime.cn;
  {proxy}
  {server}
  location / {{ proxy_pass http://127.0.0.1:{origin.server_port}; }}
 }}
}}''')
        validation = subprocess.run([NGINX, "-p", str(directory) + "/", "-c", str(config), "-t"], capture_output=True, text=True)
        self.assertEqual(validation.returncode, 0, validation.stderr)
        process = subprocess.Popen([NGINX, "-p", str(directory) + "/", "-c", str(config)], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        def stop():
            if process.poll() is None:
                process.terminate()
            process.wait(timeout=5)
            process.stderr.close()
        self.addCleanup(stop)
        for _ in range(100):
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=.1):
                    break
            except OSError:
                if process.poll() is not None:
                    self.fail(process.stderr.read().decode())
                time.sleep(.02)
        def request(path):
            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
            connection.request("GET", path, headers={"Host": "cputime.cn", "X-Forwarded-For": "8.8.8.8",
                "Cookie": "secret-do-not-log", "Authorization": "Bearer secret-do-not-log"})
            response = connection.getresponse()
            code = response.status
            response.read()
            connection.close()
            return code
        paths = ("/share/topic/28036?token=secret-do-not-log", "/SHARE/%74opic/28036")
        statuses = [request(paths[i % 2]) for i in range(220)]
        self.assertEqual(request("/api/ready"), 200)
        self.assertEqual(request("/api/jwxt-gateway"), 200)
        if dry_run:
            self.assertEqual(set(statuses), {200})
        else:
            # 100 visitors sharing a single IP all pass the initial global burst.
            # The former per-IP burst of 40 would fail this regression check.
            self.assertEqual(statuses[:100], [200] * 100)
            self.assertIn(429, statuses)
            self.assertLess(statuses.count(200), 200)
        if tight:
            cfg = configuration({"hosts": ["cputime.cn"], "mode": "adaptive", "sharedIngress": True,
                "stateDirectory": str(directory), "nginxBinary": NGINX, "nginxConfig": str(config)})
            control = Adaptive(cfg, command)
            self.assertTrue(control.apply("attack", now=1000))
            self.assertTrue(control.current())
            self.assertFalse(control.apply("normal", now=1001))
            self.assertEqual(request("/api/ready"), 200)
            self.assertTrue(control.apply("normal", now=1200))
            self.assertFalse(control.current())
        process.terminate()
        process.wait(timeout=5)
        text = logfile.read_text()
        self.assertNotIn("secret-do-not-log", text)
        logs = [json.loads(line) for line in text.splitlines()]
        self.assertTrue(any(row["limit"] == ("REJECTED_DRY_RUN" if dry_run else "REJECTED") for row in logs))
        shares = [row for row in logs if row["group"] == "share"]
        self.assertEqual(len(shares), 220)
        self.assertTrue(all(row["peer"] == "127.0.0.1" for row in shares))
        expected_client = "8.8.8.8" if trusted_proxy else "127.0.0.1"
        self.assertTrue(all(row["client"] == expected_client for row in shares))
        cfg = configuration({"hosts": ["cputime.cn"]})
        self.assertTrue(all(parse_event(json.dumps(row), float(row["ts"]), cfg) for row in shares))

    def test_real_nginx_limits_before_origin_without_touching_other_routes(self):
        self.exercise(False)

    def test_observe_mode_and_realip_peer_are_preserved(self):
        self.exercise(True, trusted_proxy=True)

    def test_shared_ingress_adapts_route_budget_without_ip_isolation(self):
        self.exercise(False, tight=True)


if __name__ == "__main__":
    unittest.main()
