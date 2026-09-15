"""Isolated, repeatable Windows/local launcher; never installs globally."""
from pathlib import Path
import argparse
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
ENV = Path.home() / ".workbuddy-ai" / "binaries" / "python" / "envs" / "karigarpay"


def main():
    parser = argparse.ArgumentParser(description="Install isolated dependencies and start KarigarPay")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--install-only", action="store_true")
    args = parser.parse_args()
    if sys.version_info < (3, 11):
        raise SystemExit("Python 3.11 or newer is required. Install it, then run run.bat again.")
    if not 1024 <= args.port <= 65535:
        parser.error("Port must be between 1024 and 65535")
    python = ENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not python.exists():
        ENV.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run([sys.executable, "-m", "venv", str(ENV)], check=True)
    lock = ROOT / "requirements-lock.txt"
    requirements = lock if lock.exists() else ROOT / "requirements.txt"
    print("Installing KarigarPay dependencies into its isolated environment...", flush=True)
    subprocess.run([str(python), "-m", "pip", "install", "--disable-pip-version-check", "-r", str(requirements)], check=True)
    if not (ROOT / "static/icons/icon-192.png").exists():
        subprocess.run([str(python), str(ROOT / "build_icons.py")], check=True)
    if args.install_only:
        print("Dependencies are ready. Run run.bat to start the app.")
        return 0
    print(f"\nKarigarPay: http://localhost:{args.port}\nCreate your business on the welcome screen.\nPress Ctrl+C to stop.\n", flush=True)
    try:
        return subprocess.call([str(python), str(ROOT / "main.py"), "--port", str(args.port)], cwd=str(ROOT))
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as exc:
        print(f"Setup failed (exit {exc.returncode}). Check your internet connection and Python installation.", file=sys.stderr)
        raise SystemExit(exc.returncode)
