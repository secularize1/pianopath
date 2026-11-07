#!/usr/bin/env python3
"""PianoPath local server.

A dependency-free HTTP service that serves the public app shell, provides
multi-user accounts with PBKDF2 password hashing, and stores progress in
SQLite with optimistic revision checks.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import sys
import threading
import time
import webbrowser
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("PIANOPATH_DATA_DIR", ROOT / "data")).resolve()
DB_FILE = DATA_DIR / "pianopath.db"
DATA_FILE = ROOT / "data.js"
MAX_BODY = 2 * 1024 * 1024
SESSION_DAYS = 30
PBKDF2_ITERATIONS = 310_000
LEGAL_VERSION = "2026-11-07"
LOCK = threading.Lock()
ATTEMPTS: dict[str, list[float]] = {}
ATTEMPTS_LOCK = threading.Lock()
PUBLIC_FILES = {
    "index.html", "styles.css", "legal.css", "app.js", "data.js", "manifest.webmanifest",
    "sw.js", "privacy.html", "terms.html", "琴阶PianoPath.html",
    "assets/hero-piano.jpg", "assets/icon.svg", "assets/icon-192.png",
    "assets/icon-512.png", "assets/apple-touch-icon.png", "assets/fallback.svg",
}


def load_curriculum() -> dict:
    text = DATA_FILE.read_text(encoding="utf-8")
    match = re.search(r"window\.PIANO_DATA\s*=\s*(\{.*\})\s*;\s*$", text, re.S)
    if not match:
        raise RuntimeError("data.js does not contain window.PIANO_DATA")
    return json.loads(match.group(1))


CURRICULUM = load_curriculum()
APP_VERSION = str(CURRICULUM.get("meta", {}).get("appVersion", "1.14.0"))


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def db() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_FILE, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    return connection


def init_db() -> None:
    with db() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                password_salt TEXT NOT NULL,
                consent_version TEXT,
                consent_at TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS progress (
                user_id INTEGER PRIMARY KEY,
                state_json TEXT NOT NULL,
                revision INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
            """
        )
        columns = {row["name"] for row in connection.execute("PRAGMA table_info(users)")}
        if "consent_version" not in columns:
            connection.execute("ALTER TABLE users ADD COLUMN consent_version TEXT")
        if "consent_at" not in columns:
            connection.execute("ALTER TABLE users ADD COLUMN consent_at TEXT")
        connection.commit()


def hash_password(password: str, salt: bytes | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return base64.b64encode(digest).decode("ascii"), base64.b64encode(salt).decode("ascii")


def verify_password(password: str, encoded_hash: str, encoded_salt: str) -> bool:
    try:
        salt = base64.b64decode(encoded_salt)
        expected = base64.b64decode(encoded_hash)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def validate_credentials(email: str, password: str) -> str | None:
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email or ""):
        return "请输入有效邮箱。"
    if len(password or "") < 8:
        return "密码至少需要 8 位。"
    if len(password or "") > 200:
        return "密码过长。"
    return None


def rate_limited(ip: str) -> bool:
    cutoff = time.time() - 600
    with ATTEMPTS_LOCK:
        recent = [stamp for stamp in ATTEMPTS.get(ip, []) if stamp >= cutoff]
        ATTEMPTS[ip] = recent
        return len(recent) >= 12


def record_attempt(ip: str) -> None:
    with ATTEMPTS_LOCK:
        ATTEMPTS.setdefault(ip, []).append(time.time())


def clean_expired_sessions(connection: sqlite3.Connection) -> None:
    connection.execute("DELETE FROM sessions WHERE expires_at < ?", (now_iso(),))


def public_path(path: str) -> bool:
    if path in ("/", ""):
        return True
    relative = path.lstrip("/")
    if relative.startswith("assets/covers/") and "/" not in relative[len("assets/covers/"):]:
        return relative.rsplit(".", 1)[-1].lower() in {"jpg", "jpeg", "png", "webp", "svg"}
    return relative in PUBLIC_FILES


class Handler(SimpleHTTPRequestHandler):
    server_version = "PianoPath/1.21"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        message = fmt % args
        if "/api/auth/me" in message or "/api/sync" in message:
            return
        sys.stdout.write("[%s] %s\n" % (self.log_date_time_string(), message))


    def send_json(self, payload: dict, status: int = 200, cookie: str | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self._pianopath_security_end_headers = False
            if cookie:
                self.send_header("Set-Cookie", cookie)
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def send_error_json(self, status: int, message: str) -> None:
        self.send_json({"ok": False, "error": message}, status)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_BODY:
            raise ValueError("invalid body size")
        payload = json.loads(self.rfile.read(length).decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("body must be an object")
        return payload

    def cookie_token(self) -> str | None:
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except Exception:
            return None
        morsel = cookie.get("pianopath_session")
        return morsel.value if morsel else None

    def current_user(self, connection: sqlite3.Connection) -> sqlite3.Row | None:
        token = self.cookie_token()
        if not token:
            return None
        clean_expired_sessions(connection)
        return connection.execute(
            "SELECT u.id, u.email, u.name, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?",
            (token_hash(token), now_iso()),
        ).fetchone()

    def auth_required(self, connection: sqlite3.Connection) -> sqlite3.Row | None:
        user = self.current_user(connection)
        if not user:
            self.send_error_json(401, "请先登录。")
        return user

    def make_session(self, connection: sqlite3.Connection, user_id: int) -> str:
        token = secrets.token_urlsafe(32)
        expires = (datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)).isoformat(timespec="seconds")
        connection.execute(
            "INSERT INTO sessions(token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (token_hash(token), user_id, now_iso(), expires),
        )
        return token

    def session_cookie(self, token: str) -> str:
        secure = "; Secure" if os.environ.get("PIANOPATH_SECURE_COOKIE") == "1" else ""
        return f"pianopath_session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SESSION_DAYS * 86400}{secure}"

    def valid_origin(self) -> bool:
        origin = self.headers.get("Origin")
        if not origin:
            return True
        try:
            return urlparse(origin).netloc == self.headers.get("Host", "")
        except Exception:
            return False

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_HEAD(self):
        path = urlparse(self.path).path
        if path.startswith("/api/") or not public_path(path):
            self.send_error_json(404, "not_found")
            return
        return super().do_HEAD()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/health":
            self.send_json({"ok": True, "app": "PianoPath", "version": APP_VERSION, "resources": len(CURRICULUM.get("resources", {}).get("videos", [])), "weeks": len(CURRICULUM.get("weeks", [])), "accounts": True, "legalVersion": LEGAL_VERSION})
            return
        if path == "/api/auth/me":
            with db() as connection:
                user = self.current_user(connection)
                if user:
                    self.send_json({"ok": True, "authenticated": True, "user": {"id": user["id"], "email": user["email"], "name": user["name"], "createdAt": user["created_at"]}})
                else:
                    self.send_json({"ok": True, "authenticated": False})
            return
        if path == "/api/sync":
            with db() as connection:
                user = self.auth_required(connection)
                if not user:
                    return
                row = connection.execute("SELECT state_json, revision, updated_at FROM progress WHERE user_id = ?", (user["id"],)).fetchone()
                if not row:
                    self.send_json({"ok": True, "state": None, "revision": 0, "updatedAt": None})
                else:
                    self.send_json({"ok": True, "state": json.loads(row["state_json"]), "revision": row["revision"], "updatedAt": row["updated_at"]})
            return
        if path in ("/api/state", "/api/export"):
            with db() as connection:
                user = self.auth_required(connection)
                if not user:
                    return
                row = connection.execute("SELECT state_json, revision, updated_at FROM progress WHERE user_id = ?", (user["id"],)).fetchone()
                if not row:
                    self.send_json({"ok": True, "state": {}, "revision": 0, "updatedAt": None})
                else:
                    self.send_json({"ok": True, "state": json.loads(row["state_json"]), "revision": row["revision"], "updatedAt": row["updated_at"]})
            return
        if path == "/api/plan/default":
            self.send_json(make_plan({"daysPerWeek": 4, "sessionMinutes": 60, "level": "zero", "style": "mixed"}))
            return
        if path == "/api/curriculum":
            self.send_json(CURRICULUM)
            return
        if path.startswith("/api/"):
            self.send_error_json(404, "not_found")
            return
        if not public_path(path):
            self.send_error_json(404, "not_found")
            return
        if path in ("/", ""):
            self.path = "/index.html"
        if path in ("/", "/index.html"):
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            body = (ROOT / "index.html").read_bytes()
            self.send_header("Content-Length", str(len(body)))
            self._pianopath_security_end_headers = False
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()

    def end_headers(self):
        if not getattr(self, "_pianopath_security_end_headers", False):
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "SAMEORIGIN")
            self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
            self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; frame-src https://player.bilibili.com https://www.youtube-nocookie.com; connect-src 'self'; font-src 'self' data:; base-uri 'self'; form-action 'self'")
            self._pianopath_security_end_headers = True
        super().end_headers()

    def do_POST(self):
        path = urlparse(self.path).path
        if not self.valid_origin():
            return self.send_error_json(403, "invalid_origin")
        ip = self.client_address[0]
        try:
            if path in ("/api/auth/register", "/api/auth/login"):
                if rate_limited(ip):
                    return self.send_error_json(429, "尝试次数过多，请稍后再试。")
                payload = self.read_json()
                email = str(payload.get("email", "")).strip().lower()
                password = str(payload.get("password", ""))
                validation = validate_credentials(email, password)
                if validation:
                    return self.send_error_json(400, validation)
                with db() as connection:
                    if path.endswith("register"):
                        consent_version = str(payload.get("consentVersion", "")).strip()[:32]
                        if payload.get("consentAccepted") is not True or consent_version != LEGAL_VERSION:
                            return self.send_error_json(400, "注册前需要同意当前版本的服务条款与隐私政策。")
                        name = str(payload.get("name", "")).strip()[:60] or "练琴人"
                        existing = connection.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
                        if existing:
                            return self.send_error_json(409, "这个邮箱已经注册。")
                        encoded_hash, encoded_salt = hash_password(password)
                        accepted_at = now_iso()
                        cursor = connection.execute(
                            "INSERT INTO users(email, name, password_hash, password_salt, consent_version, consent_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                            (email, name, encoded_hash, encoded_salt, consent_version, accepted_at, accepted_at),
                        )
                        user_id = cursor.lastrowid
                        connection.execute("INSERT INTO progress(user_id, state_json, revision, updated_at) VALUES (?, '{}', 0, ?)", (user_id, now_iso()))
                    else:
                        user = connection.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
                        if not user or not verify_password(password, user["password_hash"], user["password_salt"]):
                            record_attempt(ip)
                            return self.send_error_json(401, "邮箱或密码不正确。")
                        user_id = user["id"]
                        name = user["name"]
                    token = self.make_session(connection, user_id)
                    connection.commit()
                    self.send_json({"ok": True, "user": {"id": user_id, "email": email, "name": name}}, cookie=self.session_cookie(token))
                return
            if path == "/api/auth/logout":
                with db() as connection:
                    token = self.cookie_token()
                    if token:
                        connection.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash(token),))
                        connection.commit()
                self.send_json({"ok": True}, cookie="pianopath_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")
                return
            if path == "/api/auth/delete":
                payload = self.read_json()
                if payload.get("confirmation") != "DELETE":
                    return self.send_error_json(400, "confirmation required")
                with db() as connection:
                    user = self.auth_required(connection)
                    if not user:
                        return
                    connection.execute("DELETE FROM users WHERE id = ?", (user["id"],))
                    connection.commit()
                self.send_json({"ok": True}, cookie="pianopath_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")
                return
            if path == "/api/sync":
                payload = self.read_json()
                state = payload.get("state")
                base_revision = int(payload.get("baseRevision", 0) or 0)
                if not isinstance(state, dict):
                    return self.send_error_json(400, "state must be an object")
                with db() as connection:
                    user = self.auth_required(connection)
                    if not user:
                        return
                    row = connection.execute("SELECT state_json, revision, updated_at FROM progress WHERE user_id = ?", (user["id"],)).fetchone()
                    current_revision = row["revision"] if row else 0
                    if base_revision != current_revision:
                        remote = json.loads(row["state_json"]) if row else None
                        return self.send_json({"ok": False, "error": "conflict", "state": remote, "revision": current_revision, "updatedAt": row["updated_at"] if row else None}, 409)
                    revision = current_revision + 1
                    updated = now_iso()
                    connection.execute(
                        "INSERT INTO progress(user_id, state_json, revision, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET state_json=excluded.state_json, revision=excluded.revision, updated_at=excluded.updated_at",
                        (user["id"], json.dumps(state, ensure_ascii=False), revision, updated),
                    )
                    connection.commit()
                    self.send_json({"ok": True, "revision": revision, "updatedAt": updated})
                return
            if path == "/api/state":
                payload = self.read_json()
                with db() as connection:
                    user = self.auth_required(connection)
                    if not user:
                        return
                    revision = connection.execute("SELECT revision FROM progress WHERE user_id = ?", (user["id"],)).fetchone()
                    next_revision = (revision["revision"] if revision else 0) + 1
                    connection.execute(
                        "INSERT INTO progress(user_id, state_json, revision, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET state_json=excluded.state_json, revision=excluded.revision, updated_at=excluded.updated_at",
                        (user["id"], json.dumps(payload, ensure_ascii=False), next_revision, now_iso()),
                    )
                    connection.commit()
                self.send_json({"ok": True, "revision": next_revision})
                return
            if path == "/api/plan":
                profile = self.read_json()
                return self.send_json(make_plan(profile))
            return self.send_error_json(404, "not_found")
        except (ValueError, json.JSONDecodeError) as exc:
            return self.send_error_json(400, str(exc))
        except sqlite3.IntegrityError:
            return self.send_error_json(409, "账户数据冲突。")
        except OSError as exc:
            return self.send_error_json(500, f"storage error: {exc}")


def find_free_port(preferred: int = 8787) -> int:
    import socket
    for port in range(preferred, preferred + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError("No free port found")


def main() -> None:
    requested_port = int(os.environ.get("PORT", "8787"))
    port = find_free_port(requested_port)
    init_db()
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}"
    print(f"PianoPath running at {url}", flush=True)
    print("Press Ctrl+C to stop.", flush=True)
    try:
        if os.environ.get("PIANOPATH_NO_BROWSER") != "1":
            webbrowser.open(url)
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
