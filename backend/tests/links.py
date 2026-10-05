"""A stand-in for the web, for link previews: tests never fetch real pages.

``block_link_fetches`` (autouse, in conftest) makes every unfurl use one ``FakeLinks``; the
``fake_links`` fixture returns it so a test can publish pages and pictures on it.
"""

import pytest

from app.services import link_preview
from app.services.link_preview import Fetched, FetchError
from tests.images import small_png


class FakeLinks:
    def __init__(self) -> None:
        self.pages: dict[str, Fetched] = {}
        self.requested: list[str] = []

    def html(self, url: str, html: str) -> None:
        self.pages[url] = Fetched(
            url=url, content_type="text/html", charset="utf-8", body=html.encode()
        )

    def json(self, url: str, body: str) -> None:
        self.pages[url] = Fetched(
            url=url, content_type="application/json", charset="utf-8", body=body.encode()
        )

    def image(self, url: str, data: bytes | None = None) -> None:
        self.pages[url] = Fetched(
            url=url, content_type="image/png", charset=None, body=data or small_png((640, 360))
        )

    async def get(self, url: str, *, accept: str, max_bytes: int) -> Fetched:
        self.requested.append(url)
        if url not in self.pages:
            raise FetchError("not found")
        return self.pages[url]


def og_page(title: str, image: str | None = None, description: str = "", site: str = "") -> str:
    meta = [f'<meta property="og:title" content="{title}">']
    if image:
        meta.append(f'<meta property="og:image" content="{image}">')
    if description:
        meta.append(f'<meta property="og:description" content="{description}">')
    if site:
        meta.append(f'<meta property="og:site_name" content="{site}">')
    return f"<html><head>{''.join(meta)}</head><body>…</body></html>"


@pytest.fixture(autouse=True)
def block_link_fetches(monkeypatch: pytest.MonkeyPatch) -> FakeLinks:
    links = FakeLinks()
    monkeypatch.setattr(link_preview, "default_fetcher", lambda: links)
    return links


@pytest.fixture
def fake_links(block_link_fetches: FakeLinks) -> FakeLinks:
    return block_link_fetches
