"""Campus-safe adaptive route budgets. Never isolates IPs or changes proxy routes."""
import os
from pathlib import Path
import time

MARKER = "# CPU-web adaptive route guard v1"


def content(tight):
    return MARKER + "\nmap $cpu_waf_group $cpu_waf_attack_key {\n    default \"\";\n" + (
        '    share "share";\n' if tight else ""
    ) + "}\n"


class Adaptive:
    def __init__(self, cfg, execute):
        self.cfg, self.execute = cfg, execute
        self.path = Path(cfg["stateDirectory"]) / "nginx/adaptive.conf"
        self.last_change = float("-inf")

    def initialize(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.write(content(False))
        else:
            self.current()

    def current(self):
        raw = self.path.read_text()
        if raw not in (content(False), content(True)):
            raise RuntimeError("unrecognized adaptive map; refusing to overwrite it")
        return raw == content(True)

    def write(self, value):
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(value)
        os.chmod(temporary, 0o644)
        os.replace(temporary, self.path)

    def apply(self, phase, now=None):
        import fcntl
        now = time.monotonic() if now is None else now
        tight = phase in ("attack", "recovery")
        current = self.current()
        if tight == current or now - self.last_change < self.cfg["adaptiveCooldownSeconds"]:
            return False
        # Share this lock with deployment/operations when changing nginx configuration.
        with (self.path.parent / "reload.lock").open("w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            old = self.path.read_text()
            self.write(content(tight))
            try:
                self.execute([self.cfg["nginxBinary"], "-t", "-c", self.cfg["nginxConfig"]])
                self.execute([self.cfg["nginxBinary"], "-s", "reload", "-c", self.cfg["nginxConfig"]])
            except Exception:
                self.write(old)
                # Best effort restore if a reload command had an ambiguous outcome.
                try:
                    self.execute([self.cfg["nginxBinary"], "-t", "-c", self.cfg["nginxConfig"]])
                    self.execute([self.cfg["nginxBinary"], "-s", "reload", "-c", self.cfg["nginxConfig"]])
                except Exception:
                    pass
                raise
            finally:
                # Failed changes also back off; never issue a reload storm.
                self.last_change = now
            return True
