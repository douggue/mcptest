"""Start Cutroom:  python run.py  [--port 8000] [--host 127.0.0.1]"""
import argparse

import uvicorn

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--reload", action="store_true")
    ap.add_argument("--open", action="store_true", help="open the app in your browser once it is up")
    a = ap.parse_args()
    import os
    os.environ["CUTROOM_PORT"] = str(a.port)
    print(f"\n  Cutroom is running at http://{a.host}:{a.port}\n")
    if a.host not in ("127.0.0.1", "localhost") and not os.environ.get("CUTROOM_PASSWORD"):
        print("  WARNING: reachable from the network with no password. Set CUTROOM_PASSWORD to require a login.\n")
    if a.open:
        import threading
        import webbrowser
        threading.Timer(1.5, lambda: webbrowser.open(f"http://127.0.0.1:{a.port}")).start()
    uvicorn.run("server.main:app", host=a.host, port=a.port, reload=a.reload, log_level="warning")
