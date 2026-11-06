#!/usr/bin/env python3
"""Integration tests for PianoPath account and sync API. No third-party deps."""
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def request(base, path, method="GET", body=None, cookie=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if cookie:
        headers["Cookie"] = cookie
    req = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.status, json.loads(response.read().decode()), response.headers.get("Set-Cookie")
    except urllib.error.HTTPError as error:
        try:
            payload = json.loads(error.read().decode())
        except Exception:
            payload = {}
        return error.code, payload, error.headers.get("Set-Cookie")


def main():
    temp = Path(tempfile.mkdtemp(prefix="pianopath-test-"))
    port = free_port()
    env = {**os.environ, "PORT": str(port), "PIANOPATH_DATA_DIR": str(temp), "PIANOPATH_NO_BROWSER": "1"}
    process = subprocess.Popen([sys.executable, "server.py"], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    base = f"http://127.0.0.1:{port}"
    try:
        for _ in range(50):
            try:
                status, health, _ = request(base, "/api/health")
                if status == 200:
                    break
            except Exception:
                pass
            time.sleep(.1)
        else:
            raise RuntimeError("server did not start")
        assert health["accounts"] is True
        email = f"test-{time.time_ns()}@example.com"
        status, created, cookie = request(base, "/api/auth/register", "POST", {"email": email, "password": "PianoPath123!", "name": "Test User"})
        assert status == 200, (status, created)
        assert created["user"]["name"] == "Test User"
        assert cookie and "HttpOnly" in cookie
        cookie = cookie.split(";", 1)[0]
        status, me, _ = request(base, "/api/auth/me", cookie=cookie)
        assert status == 200 and me["authenticated"] is True
        state = {"profile": {"weeklyMinutes": 240}, "history": [{"id": "w1d1", "date": "2026-11-06", "minutes": 60}], "completed": {"w1d1": {"id": "w1d1"}}}
        status, saved, _ = request(base, "/api/sync", "POST", {"state": state, "baseRevision": 0}, cookie)
        assert status == 200 and saved["revision"] == 1
        status, pulled, _ = request(base, "/api/sync", cookie=cookie)
        assert status == 200 and pulled["state"]["history"][0]["id"] == "w1d1"
        status, conflict, _ = request(base, "/api/sync", "POST", {"state": {"x": 1}, "baseRevision": 0}, cookie)
        assert status == 409 and conflict["error"] == "conflict"
        status, logged, cookie2 = request(base, "/api/auth/login", "POST", {"email": email, "password": "PianoPath123!"})
        assert status == 200 and cookie2
        status, pulled2, _ = request(base, "/api/sync", cookie=cookie2.split(";", 1)[0])
        assert status == 200 and pulled2["revision"] == 1
        status, logged_out, _ = request(base, "/api/auth/logout", "POST", {}, cookie)
        assert status == 200
        status, unauthenticated, _ = request(base, "/api/auth/me", cookie=cookie)
        assert status == 200 and unauthenticated["authenticated"] is False
        status, db_probe, _ = request(base, "/data/pianopath.db")
        assert status == 404
        print(json.dumps({"ok": True, "checks": ["register", "session", "sync", "revision-conflict", "login", "logout", "private-db"]}, ensure_ascii=False))
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
        shutil.rmtree(temp, ignore_errors=True)


if __name__ == "__main__":
    main()
