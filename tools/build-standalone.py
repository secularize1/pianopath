#!/usr/bin/env python3
"""Build the double-clickable, single-file PianoPath app."""
from __future__ import annotations

import base64
import mimetypes
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "琴阶PianoPath.html"


def data_uri(relative_path: str) -> str:
    path = ROOT / relative_path
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    payload = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{payload}"


def main() -> None:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "styles.css").read_text(encoding="utf-8")
    data = (ROOT / "data.js").read_text(encoding="utf-8")
    app = (ROOT / "app.js").read_text(encoding="utf-8")

    local_assets = sorted(set(re.findall(r"assets/[A-Za-z0-9_./-]+", html + css + data + app)))
    replacements: dict[str, str] = {}
    for relative in local_assets:
        if (ROOT / relative).is_file():
            replacements[relative] = data_uri(relative)

    for relative, uri in replacements.items():
        html = html.replace(relative, uri)
        css = css.replace(relative, uri)
        data = data.replace(relative, uri)
        app = app.replace(relative, uri)

    html = re.sub(r"\s*<link rel=\"manifest\"[^>]*>", "", html)
    html = re.sub(
        r"\s*<script>\s*if \('serviceWorker' in navigator.*?</script>",
        "",
        html,
        count=1,
        flags=re.S,
    )
    html = html.replace(
        '<link rel="stylesheet" href="styles.css">',
        "<style>\n" + css + "\n</style>",
        1,
    )
    html = html.replace(
        '<script src="data.js"></script>',
        "<script>\n" + data + "\n</script>",
        1,
    )
    html = html.replace(
        '<script src="app.js"></script>',
        "<script>\n" + app + "\n</script>",
        1,
    )

    if re.search(r'(?:src|href)="assets/', html):
        raise SystemExit("Standalone build still contains local asset references.")
    if 'src="data.js"' in html or 'href="styles.css"' in html or 'src="app.js"' in html:
        raise SystemExit("Standalone build still contains external app-shell files.")

    OUTPUT.write_text(html, encoding="utf-8")
    print(f"Built {OUTPUT.name}: {OUTPUT.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
