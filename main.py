"""KarigarPay ASGI entrypoint. Run with run.bat or python main.py."""
import argparse
import logging
import uvicorn
from karigarpay.app import create_app

app = create_app()

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("Port must be between 1024 and 65535")
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    # Deliberately loopback-only. Put an HTTPS reverse proxy in front for phones.
    uvicorn.run(app, host="127.0.0.1", port=args.port, proxy_headers=False, access_log=False)
