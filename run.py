"""Start Cutroom:  python run.py  [--port 8000] [--host 127.0.0.1]"""
import argparse

import uvicorn

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--reload", action="store_true")
    a = ap.parse_args()
    import os
    os.environ["CUTROOM_PORT"] = str(a.port)
    print(f"\n  Cutroom is running at http://{a.host}:{a.port}\n")
    uvicorn.run("server.main:app", host=a.host, port=a.port, reload=a.reload, log_level="warning")
