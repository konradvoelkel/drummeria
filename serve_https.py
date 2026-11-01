#!/usr/bin/env python3
"""
HTTPS static server for playing from another device on the LAN (e.g. a tablet).

Web MIDI only exists in a secure context, and http://<lan-ip> is not one, so
this serves over HTTPS with a self-signed certificate (created on first run in
.cert/, valid for this machine's hostname and LAN IPs). Accept the browser
warning once. Plain http:// requests to the same port are redirected to https://.

    python3 serve_https.py           # -> https://<lan-ip>:8443
    python3 serve_https.py 9443      # custom port
"""
import http.server
import os
import socket
import ssl
import subprocess
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8443
ROOT = os.path.dirname(os.path.abspath(__file__))
CERT_DIR = os.path.join(ROOT, '.cert')
CERT, KEY = os.path.join(CERT_DIR, 'cert.pem'), os.path.join(CERT_DIR, 'key.pem')


def lan_ips():
    out = subprocess.run(['hostname', '-I'], capture_output=True, text=True).stdout.split()
    return [ip for ip in out if '.' in ip and not ip.startswith('172.17.')] or ['127.0.0.1']


def ensure_cert(ips):
    if os.path.exists(CERT) and os.path.exists(KEY):
        return
    os.makedirs(CERT_DIR, exist_ok=True)
    host = socket.gethostname()
    san = ','.join(['DNS:localhost', 'DNS:' + host, 'DNS:' + host + '.local', 'IP:127.0.0.1']
                   + ['IP:' + ip for ip in ips])
    subprocess.run([
        'openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825',
        '-keyout', KEY, '-out', CERT, '-subj', '/CN=drummeria-' + socket.gethostname(),
        '-addext', 'subjectAltName=' + san,
    ], check=True, capture_output=True)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


class Server(http.server.ThreadingHTTPServer):
    """TLS and plain HTTP on one port, with the handshake in the worker thread
    so a stalled client can't block the accept loop."""
    daemon_threads = True

    def finish_request(self, request, client_address):
        request.settimeout(10)
        try:
            first = request.recv(1, socket.MSG_PEEK)
            if first == b'\x16':                     # TLS ClientHello
                request = self.ssl_context.wrap_socket(request, server_side=True)
                super().finish_request(request, client_address)
            elif first:
                redirect_to_https(request)
        except (OSError, ssl.SSLError):
            pass


def redirect_to_https(sock):
    head = sock.recv(4096).decode('latin-1', 'replace')
    lines = head.split('\r\n')
    path = lines[0].split(' ')[1] if len(lines[0].split(' ')) > 1 else '/'
    host = next((l.split(':', 1)[1].strip() for l in lines[1:] if l.lower().startswith('host:')),
                f'{lan_ips()[0]}:{PORT}')
    sock.sendall((f'HTTP/1.1 301 Moved Permanently\r\nLocation: https://{host}{path}\r\n'
                  'Content-Length: 0\r\nConnection: close\r\n\r\n').encode())


Handler.extensions_map.update({'.js': 'text/javascript', '.json': 'application/json', '.wav': 'audio/wav'})

if __name__ == '__main__':
    ips = lan_ips()
    ensure_cert(ips)
    httpd = Server(('0.0.0.0', PORT), Handler)
    httpd.ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    httpd.ssl_context.load_cert_chain(CERT, KEY)
    print(f'Drummeria on https://{socket.gethostname()}:{PORT}', flush=True)
    for ip in ips:
        print(f'Drummeria on https://{ip}:{PORT}', flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nbye')
