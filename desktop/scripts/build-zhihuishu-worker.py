"""Build the per-platform self-contained worker; no Python installation needed by users."""
import os
import pathlib
import subprocess
import sys

desktop = pathlib.Path(__file__).resolve().parents[1]
os.environ.setdefault("PYINSTALLER_CONFIG_DIR", str(desktop / "build/zhihuishu-pyinstaller/cache"))
source = desktop.parent / "server/python/zhihuishu"
subprocess.run([
    sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--onedir",
    "--name", "cpu-zhs-worker", "--distpath", str(desktop / "zhihuishu-runtime"),
    "--workpath", str(desktop / "build/zhihuishu-pyinstaller"),
    "--specpath", str(desktop / "build/zhihuishu-pyinstaller"),
    "--paths", str(source / "vendor"), "--hidden-import", "fucker", "--hidden-import", "worker", "--paths", str(source),
    "--collect-all", "tiktoken", "--collect-all", "tiktoken_ext",
    "--collect-data", "certifi", "--collect-submodules", "Crypto",
    "--add-data", f"{source / 'vendor'}:vendor", str(source / "loader.py"),
], check=True)
executable = desktop / "zhihuishu-runtime/cpu-zhs-worker" / ("cpu-zhs-worker.exe" if sys.platform == "win32" else "cpu-zhs-worker")
result = subprocess.run([str(executable)], input="", text=True, capture_output=True, timeout=45, check=True)
assert '{"type": "ready"}' in result.stdout, "Packaged worker did not start"
print("Packaged worker startup verified")
subprocess.run(["node", str(desktop / "scripts/verify-zhihuishu-stdio.cjs"), str(executable)], check=True)

subprocess.run([str(executable), "--component-dir", str(source), "--check-component"], check=True, timeout=45)
