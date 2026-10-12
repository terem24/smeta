"""Локальный сервер для проверки dist-peredacha без кэширования.

    python scripts/serve_dist.py [порт]

Открывает папку dist-peredacha по адресу http://localhost:<порт>/ .
Заголовок Cache-Control: no-store — браузер всегда берёт свежие файлы.
"""
import functools
import http.server
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'dist-peredacha'))


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8090
    handler = functools.partial(Handler, directory=ROOT)
    with http.server.ThreadingHTTPServer(('127.0.0.1', port), handler) as srv:
        print(f'serving {ROOT} on http://localhost:{port}/')
        srv.serve_forever()
