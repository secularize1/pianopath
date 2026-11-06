#!/usr/bin/env python3
"""PianoPath zero-dependency local server.

Serves the static app, persists a single learner profile/history to JSON,
and generates an adapted weekly plan from the embedded curriculum.
"""
from __future__ import annotations

import json
import mimetypes
import os
import re
import shutil
import sys
import threading
import webbrowser
from datetime import datetime
from http import HTTPStatus
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
STATE_FILE = DATA_DIR / "state.json"
DATA_FILE = ROOT / "data.js"
MAX_BODY = 2 * 1024 * 1024
LOCK = threading.Lock()


def load_curriculum() -> dict:
    text = DATA_FILE.read_text(encoding="utf-8")
    match = re.search(r"window\.PIANO_DATA\s*=\s*(\{.*\})\s*;\s*$", text, re.S)
    if not match:
        raise RuntimeError("data.js does not contain window.PIANO_DATA")
    return json.loads(match.group(1))


CURRICULUM = load_curriculum()


def read_state() -> dict:
    if not STATE_FILE.exists():
        return {}
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def write_state(state: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, STATE_FILE)


def clamp_int(value, low: int, high: int, fallback: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return fallback
    return max(low, min(high, number))


def make_plan(profile: dict) -> dict:
    days = clamp_int(profile.get("daysPerWeek"), 1, 7, 4)
    minutes = clamp_int(profile.get("sessionMinutes"), 10, 180, 60)
    style = profile.get("style", "mixed")
    level = profile.get("level", "zero")
    weekly = days * minutes
    focus = {
        "classical": ["读谱", "技术", "曲目", "复调", "表达"],
        "pop": ["和弦", "伴奏型", "节奏", "听辨", "即兴"],
        "mixed": ["读谱", "技术", "曲目", "和弦", "表达"],
    }.get(style, ["读谱", "技术", "曲目", "和弦", "表达"])
    priority = {
        "zero": "先稳定坐姿、键盘定位与拍感，不追求速度。",
        "basic": "用短曲校正双手协调，同时把视奏单独拆开。",
        "return": "用低难度陌生谱恢复读谱，再把旧曲作为技术素材。",
    }.get(level, "先稳定动作，再谈曲目数量。")
    total = max(1, weekly)
    allocation = {
        "身体/技术": round(total * (0.24 if minutes >= 30 else 0.16)),
        "主曲拆解": round(total * 0.38),
        "复习与表达": round(total * 0.18),
        "视奏": round(total * 0.12),
        "听觉/即兴": round(total * 0.08),
    }
    if days <= 3:
        warning = "每周少于 3 天时，间隔过长；建议把其中一次拆成 10 分钟复习。"
    elif minutes < 30:
        warning = "单次少于 30 分钟时，优先保留技术、主曲和视奏，不追求全部模块。"
    else:
        warning = "保持每周至少 3 个不同日期练琴，比周末一次练很久更有效。"
    return {
        "ok": True,
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "profile": {**profile, "daysPerWeek": days, "sessionMinutes": minutes, "weeklyMinutes": weekly},
        "summary": f"按每周 {days} 次 × {minutes} 分钟生成；总时长 {weekly // 60} 小时 {weekly % 60} 分钟。",
        "priority": priority,
        "rotation": focus,
        "allocation": allocation,
        "warning": warning,
        "totalWeeks": CURRICULUM.get("meta", {}).get("totalWeeks", 12),
    }


class Handler(SimpleHTTPRequestHandler):
    server_version = "PianoPath/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        sys.stdout.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_BODY:
            raise ValueError("invalid body size")
        payload = json.loads(self.rfile.read(length).decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("body must be an object")
        return payload

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/health":
            self.send_json({"ok": True, "app": "PianoPath", "version": "1.0", "resources": len(CURRICULUM.get("resources", {}).get("videos", [])), "weeks": len(CURRICULUM.get("weeks", []))})
            return
        if path == "/api/state":
            self.send_json(read_state())
            return
        if path == "/api/plan/default":
            self.send_json(make_plan({"daysPerWeek": 4, "sessionMinutes": 60, "level": "zero", "style": "mixed"}))
            return
        if path == "/api/curriculum":
            self.send_json(CURRICULUM)
            return
        if path.startswith("/api/"):
            self.send_json({"ok": False, "error": "not_found"}, 404)
            return
        if path in ("/", ""):
            self.path = "/index.html"
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            if path == "/api/plan":
                profile = self.read_json()
                return self.send_json(make_plan(profile))
            if path == "/api/state":
                state = self.read_json()
                state["updatedAt"] = datetime.now().isoformat(timespec="seconds")
                with LOCK:
                    write_state(state)
                return self.send_json({"ok": True, "updatedAt": state["updatedAt"]})
            if path == "/api/export":
                state = read_state()
                backup_dir = ROOT / "data" / "backups"
                backup_dir.mkdir(parents=True, exist_ok=True)
                target = backup_dir / f"pianopath-{datetime.now():%Y%m%d-%H%M%S}.json"
                target.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
                return self.send_json({"ok": True, "file": str(target.relative_to(ROOT))})
            return self.send_json({"ok": False, "error": "not_found"}, 404)
        except (ValueError, json.JSONDecodeError) as exc:
            return self.send_json({"ok": False, "error": str(exc)}, 400)
        except OSError as exc:
            return self.send_json({"ok": False, "error": f"storage error: {exc}"}, 500)


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
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not STATE_FILE.exists():
        write_state({"profile": {"daysPerWeek": 4, "sessionMinutes": 60, "level": "zero", "style": "mixed", "weeklyMinutes": 240}, "completed": {}, "history": []})
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}"
    print(f"PianoPath running at {url}", flush=True)
    print("Press Ctrl+C to stop.", flush=True)
    try:
        webbrowser.open(url)
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
