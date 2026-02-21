#!/usr/bin/env python3
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import json, os, sys, time
from urllib.parse import urlparse

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
RUNS_DIR = os.path.join(ROOT, "runs")

class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        path = super().translate_path(path)
        rel = os.path.relpath(path, os.getcwd())
        return os.path.join(ROOT, rel)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != "/submit-score":
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"Not Found")
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length)
            data = json.loads(raw.decode("utf-8"))
        except Exception as e:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(("Bad JSON: %s" % e).encode("utf-8"))
            return

        os.makedirs(RUNS_DIR, exist_ok=True)
        ts = int(time.time())
        season = (data.get("season_id") or "S1").replace("/", "_")
        pub = (data.get("player_pubkey") or "unknown").replace("/", "_")
        score = str(data.get("score") or "0")
        run_hash = (data.get("run_hash") or "nohash")[:16]

        season_dir = os.path.join(RUNS_DIR, season)
        os.makedirs(season_dir, exist_ok=True)
        fname = f"{ts}_{score}_{pub[:8]}_{run_hash}.json"
        out_path = os.path.join(season_dir, fname)

        try:
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            self.send_response(500)
            self.end_headers()
            self.wfile.write(("Save failed: %s" % e).encode("utf-8"))
            return

        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        resp = {"ok": True, "saved": os.path.relpath(out_path, ROOT)}
        self.wfile.write(json.dumps(resp).encode("utf-8"))

def main():
    port = 8000
    if len(sys.argv) >= 2:
        port = int(sys.argv[1])
    os.chdir(ROOT)
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Serving {ROOT} on http://localhost:{port} (POST /submit-score -> ./runs/)")
    httpd.serve_forever()

if __name__ == "__main__":
    main()
