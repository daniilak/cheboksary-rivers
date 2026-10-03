"""Local preview with optional saving of browser-recorded video to ../output."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT.parent / 'output'

class Preview(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'dist'), **kwargs)

    def do_POST(self):
        if self.path != '/__recording':
            self.send_error(404)
            return
        size = int(self.headers.get('Content-Length', 0))
        if not 0 < size < 100_000_000:
            self.send_error(413)
            return
        extension = 'mp4' if 'mp4' in self.headers.get('Content-Type', '') else 'webm'
        OUTPUT.mkdir(exist_ok=True)
        (OUTPUT / ('cheboksary-river-evolution.' + extension)).write_bytes(self.rfile.read(size))
        self.send_response(201)
        self.end_headers()
        self.wfile.write(b'Saved')

ThreadingHTTPServer(('127.0.0.1', 8766), Preview).serve_forever()
