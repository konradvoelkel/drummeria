#!/usr/bin/env python3
"""
Cross-origin-isolated static server for the SCAL profiler.

`python3 -m http.server` does NOT send COOP/COEP, so SharedArrayBuffer (and thus
the profiler's SAB transport) is unavailable. This server adds the two headers
that enable cross-origin isolation, and fixes the JS/WAV MIME types.

    python3 serve.py            # -> http://localhost:8000
    python3 serve.py 8080       # custom port

The main drum machine itself does NOT need this — it runs from file:// or any
plain server. This is only required for the AudioWorklet + SAB profiler.
"""
import http.server
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


Handler.extensions_map.update({
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.wav': 'audio/wav',
    '.json': 'application/json',
})

if __name__ == '__main__':
    with socketserver.TCPServer(('', PORT), Handler) as httpd:
        print(f'SCAL dev server (cross-origin isolated) on http://localhost:{PORT}')
        print('Open the page, click Start, then in the console:  await DM.profiler.run()')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nbye')
