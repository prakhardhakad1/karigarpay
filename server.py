"""Start KarigarPay locally. Use an HTTPS reverse proxy for phone access."""
import argparse
import logging
import uvicorn
from karigarpay.app import create_app


def main():
    parser = argparse.ArgumentParser(description="KarigarPay private local server")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("port must be between 1 and 65535")
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    uvicorn.run(create_app(), host="127.0.0.1", port=args.port, access_log=False, proxy_headers=False)


if __name__ == "__main__":
    main()
