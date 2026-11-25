"""Inline the CSS, scripts and images into one self-contained HTML file (for sharing or hosting as one file)."""

import base64
import pathlib
import re

ROOT = pathlib.Path(__file__).parent
MIME = {".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon"}


def data_uri(path: pathlib.Path) -> str:
    return f"data:{MIME[path.suffix]};base64,{base64.b64encode(path.read_bytes()).decode()}"


def main() -> None:
    html = (ROOT / "index.html").read_text()
    css = (ROOT / "css/style.css").read_text()
    css = re.sub(r"url\('\.\./(images/[\w.-]+)'\)", lambda m: f"url('{data_uri(ROOT / m.group(1))}')", css)
    html = html.replace('<link rel="stylesheet" href="css/style.css">', f"<style>\n{css}</style>")
    html = html.replace('href="images/favicon.ico"', f'href="{data_uri(ROOT / "images/favicon.ico")}"')
    html = re.sub(
        r'<script src="(js/[\w.]+)"></script>',
        lambda m: f"<script>\n{(ROOT / m.group(1)).read_text()}</script>",
        html,
    )
    assert "../images/" not in html and 'src="js/' not in html
    out = ROOT / "dist/placement-garden.html"
    out.parent.mkdir(exist_ok=True)
    out.write_text(html)
    print(f"wrote {out} ({len(html):,} bytes)")


if __name__ == "__main__":
    main()
