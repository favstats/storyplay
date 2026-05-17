#!/usr/bin/env python3
"""Dump sentence-fragment text for one chapter of a book.

Usage:
    python3 tools/dump-sentences.py <book-slug> <chapterId>

Prints `<fragId>\\t<text>` for every sentence span, so pack authors can
anchor scenes / key moments / speakers to exact sentences.
"""
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).parent.parent
SID_RE = re.compile(r"^[A-Za-z0-9_]+-s\d+$")


class SentenceExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.cur = None
        self.depth = 0
        self.buf = []
        self.out = {}
        self.order = []

    def handle_starttag(self, tag, attrs):
        d = dict(attrs)
        sid = d.get("id", "")
        if self.cur is None and SID_RE.match(sid or ""):
            self.cur, self.depth, self.buf = sid, 1, []
        elif self.cur is not None:
            self.depth += 1

    def handle_endtag(self, tag):
        if self.cur is not None:
            self.depth -= 1
            if self.depth <= 0:
                txt = re.sub(r"\s+", " ", "".join(self.buf)).strip()
                self.out[self.cur] = txt
                self.order.append(self.cur)
                self.cur = None

    def handle_data(self, data):
        if self.cur is not None:
            self.buf.append(data)


def main():
    if len(sys.argv) != 3:
        print("usage: dump-sentences.py <book-slug> <chapterId>", file=sys.stderr)
        sys.exit(2)
    slug, chap = sys.argv[1], sys.argv[2]
    m = json.loads((ROOT / "books" / slug / "manifest.json").read_text())
    ch = next((c for c in m["chapters"] if c["id"] == chap), None)
    if not ch:
        print(f"no chapter {chap}", file=sys.stderr)
        sys.exit(1)
    html = (ROOT / "books" / slug / ch["xhtml"]).read_text(encoding="utf-8", errors="ignore")
    ex = SentenceExtractor()
    ex.feed(html)
    for sid in ex.order:
        print(f"{sid}\t{ex.out[sid]}")


if __name__ == "__main__":
    main()
