"""Bang Bang Private — HTTP + login + static + start policy/socket threads."""
from __future__ import annotations

import argparse
import os
import json
import logging
import posixpath
import ssl
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (OSError, ValueError):
        pass
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    try:
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except (OSError, ValueError):
        pass

ROOT = Path(__file__).resolve().parents[1]
WWW = ROOT / "www"
_WWW_ROOT = WWW.resolve()
DATA = ROOT / "data"

sys.path.insert(0, str(Path(__file__).resolve().parent))


from auth_store import Store
from storage_import import initialize
from storage import connection, SCHEMA_VERSION
from server_logging import configure, get_logger, LEVELS
import admin_buff
import bot_setup
import capi
import characters
from character_info import HTTP_ROUTES as CHARACTER_ROUTES
from cpp_backend import initialize as initialize_acceleration, status as acceleration_status
from guild_protocol import HTTP_ROUTES as GUILD_ROUTES
import html5_bridge
import offline_mail
import sandbox

log = get_logger('http')

STORE = Store()
CAPI_ROUTES = GUILD_ROUTES | CHARACTER_ROUTES
_EMPTY_XML = b'<?xml version="1.0" encoding="utf-8"?><config><localDatas></localDatas></config>'
_ADMIN_CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; "
    "connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'"
)
_MIRROR_SSL = ssl.create_default_context()
_MAX_JSON_BODY = 1024 * 1024


class Handler(SimpleHTTPRequestHandler):
    offline_assets = False
    secure_web_session = False

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WWW), **kwargs)

    def end_headers(self) -> None:
        path = urlparse(getattr(self, 'path', '')).path
        if admin_buff.page_path(path):
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('X-Frame-Options', 'DENY')
            self.send_header('Content-Security-Policy', _ADMIN_CSP)
        elif path == '/html5/' or path.endswith(('.html', '.js', '.css')):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def do_HEAD(self) -> None:
        path = urlparse(self.path).path
        if path.startswith('/api/admin/'):
            return admin_buff.handle(self)
        if admin_buff.page_path(path):
            if not admin_buff.protect_page(self):
                return
        super().do_HEAD()

    def log_message(self, fmt: str, *args) -> None:
        log.info('[http] ' + fmt, *args)

    def log_request(self, code='-', size='-') -> None:
        status = int(code) if str(code).isdigit() else 0
        level = logging.ERROR if status >= 500 else logging.WARNING if status >= 400 else logging.INFO
        if not log.isEnabledFor(level):
            return
        # Log status failures, including JSON responses that do not call send_error.
        # Avoid copying query tokens into persistent diagnostics.
        log.log(level, '[http] %s %s %s %s', self.command,
                urlparse(getattr(self, 'path', '')).path, code, size)

    def log_error(self, fmt: str, *args) -> None:
        # The status/path is recorded once by log_request().
        log.debug('[http] ' + fmt, *args)

    def _json(self, code: int, obj: dict, set_cookie: str | None = None, clear_cookie: bool = False) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=UTF-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        cookie_security = '; Secure' if self.secure_web_session else ''
        if clear_cookie:
            self.send_header(
                "Set-Cookie",
                "bb_web_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax" + cookie_security,
            )
        elif set_cookie:
            self.send_header(
                "Set-Cookie",
                f"bb_web_session={set_cookie}; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax" + cookie_security,
            )
        self.end_headers()
        self.wfile.write(body)

    def send_error(self, code, message=None, explain=None) -> None:
        self.close_connection = True
        super().send_error(code, message, explain)

    def _read_json(self) -> dict:
        raw_len = self.headers.get("Content-Length")
        if raw_len is None or not raw_len.strip():
            return {}
        try:
            n = int(raw_len)
        except ValueError as exc:
            raise ValueError("Invalid Content-Length header") from exc
        if n < 0 or n > _MAX_JSON_BODY:
            raise ValueError("Request body size out of range")
        if n == 0:
            return {}
        raw = self.rfile.read(n)
        if len(raw) != n:
            raise ValueError("Incomplete request body")
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise ValueError("Malformed JSON request body") from exc
        if not isinstance(parsed, dict):
            raise ValueError("JSON object expected")
        return parsed

    def _cookie(self) -> str | None:
        raw = self.headers.get("Cookie") or ""
        for part in raw.split(";"):
            if "=" in part:
                k, v = part.strip().split("=", 1)
                if k == "bb_web_session":
                    return v
        return None

    def _send_bytes(self, code: int, body: bytes, ctype: str, cache_control: str | None = None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        if cache_control:
            self.send_header("Cache-Control", cache_control)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path.startswith('/api/admin/'):
            return admin_buff.handle(self)
        if admin_buff.page_path(path):
            if not admin_buff.protect_page(self):
                return
        if path == "/html5/ws":
            self.close_connection = True
            session = STORE.session_from_cookie(self._cookie())
            return html5_bridge.handle_websocket(self, session=session, store=STORE)
        if path == "/health":
            with connection() as db:
                db.execute('SELECT 1 FROM worlds LIMIT 1').fetchone()
            return self._json(200, {"ok": True, "service": "bangbang-private",
                                    "storage": "sqlite", "schema": SCHEMA_VERSION, "instance": os.environ.get("BB_LAUNCH_ID", ""),
                                    "combat_acceleration": acceleration_status()})
        if path.startswith("/capi") or path == "/goodsshopquery.php" or path.lstrip('/').lower() in CAPI_ROUTES:
            hit = capi.handle(self.path)
            if hit is None:
                self.send_error(404)
                return
            body, ctype = hit
            return self._send_bytes(200, body, ctype, "no-store")
        if path in ("/", "/index.html"):
            self.path = "/index.html"
            return super().do_GET()

        rel_path = unquote(path).lstrip("/")
        try:
            file_path = (WWW / rel_path).resolve()
        except OSError:
            self.send_error(400)
            return
        if not file_path.is_relative_to(_WWW_ROOT):
            self.send_error(403)
            return
        if not file_path.exists():
            # Dynamically fetch & cache any missing asset from netzone mirror
            if not self.offline_assets and (
                path.startswith("/rez/") or path.endswith((".swf", ".png", ".jpg", ".dat", ".cub", ".xml"))
            ):
                try:
                    import urllib.request
                    upstream_url = f"https://netzone.id.vn{path}"
                    req = urllib.request.Request(upstream_url, headers={"User-Agent": "Mozilla/5.0 BB-private-mirror"})
                    with urllib.request.urlopen(req, context=_MIRROR_SSL, timeout=5) as resp:
                        if resp.status == 200:
                            data = resp.read()
                            file_path.parent.mkdir(parents=True, exist_ok=True)
                            file_path.write_bytes(data)
                            log.info(f"[http] Proxy-cached {path} ({len(data)} bytes) from netzone")
                            return self._send_bytes(200, data, self.guess_type(str(file_path)))
                except (OSError, ValueError) as exc:
                    log.debug("[http] Mirror fetch skipped for %s: %s", path, exc)

            if path.endswith(".xml"):
                log.warning(f"[http] Missing XML fallback for {path}")
                return self._send_bytes(200, _EMPTY_XML, "application/xml; charset=utf-8")

        return super().do_GET()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path.startswith('/api/admin/'):
            return admin_buff.handle(self)
        try:
            payload = self._read_json()
        except ValueError as exc:
            return self._json(400, dict(success=False, message=str(exc)))
        if path in ('/api/sandbox/info', '/api/sandbox/grant'):
            session = STORE.session_from_cookie(self._cookie())
            if not session:
                return self._json(401, dict(success=False, message='Đăng nhập lại để nhận quà sandbox.'))
            try:
                from storage import connection as profile_connection, for_profile, profile_id
                ident = characters.for_username(session['username'])
                with for_profile(ident):
                    if path.endswith('/info'):
                        with profile_connection() as db:
                            row = db.execute('SELECT state FROM worlds WHERE profile_id=?', (profile_id(),)).fetchone()
                            world_state = json.loads(row[0]) if row else {}
                            return self._json(200, sandbox.catalog_summary(db, ident, world_state))
                    with profile_connection(write=True) as wdb:
                        row = wdb.execute('SELECT state FROM worlds WHERE profile_id=?', (profile_id(),)).fetchone()
                        world_state = json.loads(row[0]) if row else {}
                        result = sandbox.grant_preset(wdb, ident, world_state, payload)
                offline_mail.notify(ident)
                return self._json(200, result)
            except ValueError as exc:
                return self._json(400, dict(success=False, message=str(exc)))
        if path in ('/api/bots/get','/api/bots/save'):
            session = STORE.session_from_cookie(self._cookie())
            if not session:
                return self._json(401,dict(success=False,message='Đăng nhập lại để thiết lập trận.'))
            try:
                from storage import connection as profile_connection, for_profile, profile_id
                with for_profile(characters.for_username(session['username'])):
                    setup = bot_setup.save_setup(payload) if path.endswith('/save') else bot_setup.load_setup()
                    with profile_connection() as db:
                        row = db.execute("SELECT json_extract(state, '$.classic') FROM worlds WHERE profile_id=?",
                                         (profile_id(),)).fetchone()
                    setup['classic'] = bool(row and row[0])
                return self._json(200,dict(success=True,setup=setup,tanks=list(bot_setup.AI_TANKS.values())))
            except ValueError as exc:
                return self._json(400,dict(success=False,message=str(exc)))
        if path == "/api/login":
            result = STORE.login(str(payload.get("username") or ""), str(payload.get("password") or ""))
            if result.get("success"):
                cookie = result.pop("cookie")
                return self._json(200, result, set_cookie=cookie)
            return self._json(200, result, clear_cookie=True)
        if path == "/api/session":
            result = STORE.refresh_from_cookie(self._cookie())
            if result is None:
                return self._json(200, {"success": False}, clear_cookie=True)
            return self._json(200, result)
        if path == "/api/logout":
            STORE.logout_cookie(self._cookie())
            return self._json(200, {"success": True}, clear_cookie=True)
        if path == "/capi":
            return self._json(200, {"ok": True})
        self.send_error(404)


class Server(ThreadingHTTPServer):
    request_queue_size = 128

    def handle_error(self, request, client_address):
        log.exception('[http] Request failed from %s', client_address)


class LanHandler(Handler):
    secure_web_session = True

    def parse_request(self):
        if not super().parse_request():
            return False
        host = self.server.authority
        if self.headers.get_all('Host') != [host]:
            self.send_error(403, 'Use the LAN URL printed on the host Mac')
            return False
        path = posixpath.normpath(unquote(urlparse(self.path).path))
        if path in ('/admin', '/api/admin') or path.startswith(('/admin/', '/api/admin/')):
            self.send_error(404)
            return False
        if self.command == 'POST' and self.headers.get_all('Origin') != ['https://' + host]:
            self.send_error(403, 'Same-origin page required')
            return False
        return True


class _TLSServer(Server):
    def __init__(self, server_address, handler_cls, cert, key):
        self.context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        self.context.load_cert_chain(str(cert), str(key))
        super().__init__(server_address, handler_cls)

    def process_request_thread(self, request, client_address):
        try:
            request.settimeout(5)
            secure = self.context.wrap_socket(request, server_side=True)
        except OSError:
            request.close()
            return
        secure.settimeout(None)
        super().process_request_thread(secure, client_address)


class LanServer(_TLSServer):
    def __init__(self, bind, port, cert, key):
        self.authority = f'{bind}:{port}'
        super().__init__((bind, port), LanHandler, cert, key)


def start_side_servers(html5_local=False, native_port=49119) -> None:
    from policy import start_policy_servers
    from sixcube_server import start_sixcube

    if html5_local:
        import sixcube_server, html5_bridge
        sixcube_server.LISTEN_PORT = native_port
        html5_bridge.TCP_DESTINATION = ("127.0.0.1", native_port)
        start_sixcube(bind="127.0.0.1")
    else:
        start_policy_servers()
        start_sixcube()


def start_https(bind: str, port: int):
    cert = DATA / "certs" / "cert.pem"
    key = DATA / "certs" / "key.pem"
    if not cert.exists() or not key.exists():
        log.warning("[https] missing certs, skip")
        return None
    httpd = _TLSServer((bind, port), Handler, cert, key)
    log.info(f"[https] https://{bind}:{port}/")
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--html5-local", action="store_true", help="HTML5 loopback only; no Flash policy or HTTPS services")
    parser.add_argument("--offline-assets", action="store_true", help="Serve bundled assets without fetching missing assets from the mirror")
    parser.add_argument("--native-port", type=int, default=49119)
    parser.add_argument("--port", type=int, default=18083)
    parser.add_argument("--https-port", type=int, default=18443)
    parser.add_argument('--lan-bind')
    parser.add_argument('--lan-port', type=int)
    parser.add_argument('--lan-cert', type=Path)
    parser.add_argument('--lan-key', type=Path)
    parser.add_argument("--bind", default="0.0.0.0")
    parser.add_argument('--enable-admin-buff', action='store_true',
                        help='Explicitly enable loopback-only gift-mail admin; never grants on startup')
    parser.add_argument('--admin-key-file', type=Path,
                        help='Private key file outside www; contents are never printed or logged')
    parser.add_argument("--log-level", choices=LEVELS, default="WARNING", type=str.upper,
                        help="WARNING by default; DEBUG also records raw TCP packets")
    args = parser.parse_args()
    Handler.offline_assets = args.offline_assets
    lan = (args.lan_bind, args.lan_port, args.lan_cert, args.lan_key)
    if any(lan):
        from lan_tls import private_address
        if not (all(lan) and args.html5_local and args.offline_assets and args.bind == '127.0.0.1'):
            parser.error('LAN HTTPS requires the local HTML5 configuration and all four LAN options')
        try:
            private_address(args.lan_bind)
        except ValueError as exc:
            parser.error(str(exc))
    if args.admin_key_file and not args.enable_admin_buff:
        parser.error('--admin-key-file requires --enable-admin-buff')
    configure(args.log_level)
    initialize_acceleration()
    DATA.mkdir(parents=True, exist_ok=True)
    WWW.mkdir(parents=True, exist_ok=True)
    initialize()
    characters.initialize()
    import guilds
    guilds.initialize()
    offline_mail.initialize()
    import world_boss_store
    world_boss_store.initialize()
    import battle_stats
    battle_stats.initialize()
    if args.enable_admin_buff:
        key_path = admin_buff.enable(args.admin_key_file)
        print('[admin] Local gift-mail admin: http://127.0.0.1:' + str(args.port) + '/admin/buff/')
        print('[admin] Operator key file (open locally, never share): ' + str(key_path))
    start_side_servers(args.html5_local, args.native_port)
    https_server = None if args.html5_local else start_https(args.bind, args.https_port)
    lan_server = None
    if all(lan):
        lan_server = LanServer(*lan)
        threading.Thread(target=lan_server.serve_forever, daemon=True).start()

    Server.allow_reuse_address = True
    for attempt in range(5):
        try:
            httpd = Server((args.bind, args.port), Handler)
            break
        except OSError as e:
            log.warning(f"[http] bind attempt {attempt+1} failed: {e}, retrying...")
            time.sleep(1)
    else:
        log.error(f"[http] ERROR: Could not bind port {args.port}!")
        for srv in (https_server, lan_server):
            if srv is not None:
                srv.server_close()
        return

    log.info(f"[http] http://{args.bind}:{args.port}/  www={WWW}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        log.info("[http] stop")
    finally:
        httpd.server_close()
        for srv in (https_server, lan_server):
            if srv is not None:
                srv.shutdown()
                srv.server_close()


if __name__ == "__main__":
    main()
