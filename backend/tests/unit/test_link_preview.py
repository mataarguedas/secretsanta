"""Link previews: finding the URL, reading pages, and fetching only from the public web."""

import httpx
import pytest

from app.services.link_preview import (
    MAX_REDIRECTS,
    FetchError,
    SafeFetcher,
    fetch_preview,
    first_url,
    is_public_address,
    parse_html,
    youtube_id,
)
from app.storage.images import PREVIEW_EDGE, process_preview_image
from tests.images import jpeg_with_gps, small_png
from tests.links import FakeLinks, og_page

# ── first_url: the same links the chat UI shows (frontend/src/lib/linkify.ts) ──


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        ("Hola, ¿qué talla usás?", None),
        ("Mirá https://tienda.cr/libro?id=3#a este", "https://tienda.cr/libro?id=3#a"),
        ("en www.amazon.com/dp/123", "https://www.amazon.com/dp/123"),
        ("¿Viste https://a.com/x?", "https://a.com/x"),
        ("(ver https://a.com/x)", "https://a.com/x"),
        (
            "https://es.wikipedia.org/wiki/Lego_(juguete)",
            "https://es.wikipedia.org/wiki/Lego_(juguete)",
        ),
        ("primero https://uno.com luego https://dos.com", "https://uno.com"),
        ("javascript:alert(1) ftp://a.com https:// www.", None),
        ("ana@www.example.com", None),
        ("xhttps://a.com", None),
    ],
)
def test_first_url(body: str, expected: str | None) -> None:
    assert first_url(body) == expected


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        (
            "https://www.youtube.com/watch?v=9h30Bx4Klxg&list=RD9h30Bx4Klxg&start_radio=1",
            "9h30Bx4Klxg",
        ),
        ("https://youtu.be/9h30Bx4Klxg?t=42", "9h30Bx4Klxg"),
        ("https://m.youtube.com/shorts/9h30Bx4Klxg", "9h30Bx4Klxg"),
        ("https://music.youtube.com/watch?v=9h30Bx4Klxg", "9h30Bx4Klxg"),
        ("https://www.youtube.com/@canal", None),
        ("https://www.youtube.com/watch?v=short", None),
        ("https://notyoutube.com/watch?v=9h30Bx4Klxg", None),
    ],
)
def test_youtube_id(url: str, expected: str | None) -> None:
    assert youtube_id(url) == expected


# ── Reading pages ────────────────────────────────────────────────────────────


def test_parse_html_prefers_open_graph_and_resolves_the_image() -> None:
    html = """<!doctype html><html><head>
      <meta charset="utf-8"><title>Fallback</title>
      <meta property="og:title" content="Lego &amp; más">
      <meta property="og:description" content="  Un   set
        grande ">
      <meta property="og:image" content="/img/lego.jpg">
      <meta property="og:site_name" content="Juguetería">
      <meta property="og:type" content="product">
    </head><body><meta property="og:title" content="ignored"></body></html>"""
    preview = parse_html(html, "https://tienda.cr/lego")
    assert preview is not None
    assert preview.title == "Lego & más"
    assert preview.description == "Un set grande"
    assert preview.image_url == "https://tienda.cr/img/lego.jpg"
    assert preview.site_name == "Juguetería"
    assert preview.is_video is False


def test_parse_html_falls_back_to_title_and_host() -> None:
    preview = parse_html("<title> Mi página </title>", "https://www.ejemplo.cr/x")
    assert preview is not None
    assert (preview.title, preview.site_name, preview.image_url) == (
        "Mi página",
        "ejemplo.cr",
        None,
    )


def test_parse_html_without_anything_useful_is_no_preview() -> None:
    assert parse_html("<html><body>hola</body></html>", "https://a.com") is None
    bad_image = '<meta property="og:image" content="javascript:alert(1)">'
    assert parse_html(bad_image, "https://a.com") is None


def test_long_titles_are_cut() -> None:
    preview = parse_html(f"<title>{'a' * 500}</title>", "https://a.com")
    assert preview is not None
    assert preview.title is not None
    assert len(preview.title) == 200
    assert preview.title.endswith("…")


async def test_youtube_uses_oembed_and_the_video_thumbnail() -> None:
    links = FakeLinks()
    url = "https://www.youtube.com/watch?v=9h30Bx4Klxg&list=RD9h30Bx4Klxg&start_radio=1"
    links.json(
        "https://www.youtube.com/oembed?format=json&url="
        "https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D9h30Bx4Klxg",
        '{"title": "La canción", "author_name": "El canal"}',
    )
    preview = await fetch_preview(url, links)
    assert preview is not None
    assert preview.url == url  # the link as written, playlist and all
    assert (preview.title, preview.description, preview.site_name) == (
        "La canción",
        "El canal",
        "YouTube",
    )
    assert preview.is_video
    assert preview.image_url == "https://i.ytimg.com/vi/9h30Bx4Klxg/maxresdefault.jpg"
    assert links.requested == [links.requested[0]]  # never the watch page itself


async def test_an_unavailable_video_has_no_preview() -> None:
    assert await fetch_preview("https://youtu.be/9h30Bx4Klxg", FakeLinks()) is None


async def test_non_html_is_no_preview() -> None:
    links = FakeLinks()
    links.image("https://a.com/foto.png")
    assert await fetch_preview("https://a.com/foto.png", links) is None


def test_preview_pictures_are_stripped_and_capped() -> None:
    rendition = process_preview_image(jpeg_with_gps())
    assert max(rendition.width, rendition.height) == PREVIEW_EDGE
    assert rendition.data[:4] == b"RIFF"
    assert b"GPS" not in rendition.data


# ── Fetching only from the public web (SSRF) ─────────────────────────────────


@pytest.mark.parametrize(
    ("address", "public"),
    [
        ("93.184.216.34", True),
        ("2606:2800:220:1:248:1893:25c8:1946", True),
        ("127.0.0.1", False),
        ("10.0.0.5", False),
        ("172.17.0.2", False),  # a Docker network (postgres, redis, …)
        ("192.168.1.1", False),
        ("169.254.169.254", False),  # cloud metadata
        ("100.64.0.1", False),
        ("0.0.0.0", False),  # noqa: S104
        ("::1", False),
        ("fd00::1", False),
        ("::ffff:127.0.0.1", False),
        ("224.0.0.1", False),
        ("not-an-ip", False),
    ],
)
def test_is_public_address(address: str, public: bool) -> None:
    assert is_public_address(address) is public


def resolver(table: dict[str, list[str]]):  # type: ignore[no-untyped-def]
    async def resolve(host: str, _port: int) -> list[str]:
        if host not in table:
            raise OSError("NXDOMAIN")
        return table[host]

    return resolve


def recording(handler):  # type: ignore[no-untyped-def]
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        response: httpx.Response = handler(request)
        return response

    return httpx.MockTransport(handle), seen


async def test_connects_to_the_checked_address_with_the_real_host() -> None:
    transport, seen = recording(
        lambda r: httpx.Response(
            200, headers={"content-type": "text/html"}, text="<title>x</title>"
        )
    )
    fetcher = SafeFetcher(resolver=resolver({"tienda.cr": ["93.184.216.34"]}), transport=transport)
    fetched = await fetcher.get("https://tienda.cr/a?b=1", accept="text/html", max_bytes=1000)
    assert fetched.body == b"<title>x</title>"
    assert fetched.url == "https://tienda.cr/a?b=1"
    (request,) = seen
    assert request.url.host == "93.184.216.34"  # no second DNS lookup to rebind
    assert request.url.raw_path == b"/a?b=1"
    assert request.headers["host"] == "tienda.cr"
    assert request.extensions["sni_hostname"] == "tienda.cr"


@pytest.mark.parametrize(
    "url",
    [
        "http://localhost/",
        "http://interno.cr/",  # resolves to a private address
        "http://mixto.cr/",  # one of its addresses is private
        "http://93.184.216.34:6379/",  # a non-web port
        "http://no-existe.cr/",
        "ftp://tienda.cr/",
        "https://santa.test/x",  # our own site
    ],
)
async def test_refuses_anything_but_the_public_web(
    url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.core import config

    monkeypatch.setattr(config.get_settings(), "app_domain", "santa.test")
    transport, seen = recording(lambda r: httpx.Response(200))
    table = {
        "localhost": ["127.0.0.1"],
        "interno.cr": ["10.0.0.7"],
        "mixto.cr": ["93.184.216.34", "192.168.0.10"],
        "93.184.216.34": ["93.184.216.34"],
        "santa.test": ["93.184.216.34"],
        "tienda.cr": ["93.184.216.34"],
    }
    fetcher = SafeFetcher(resolver=resolver(table), transport=transport)
    with pytest.raises(FetchError):
        await fetcher.get(url, accept="*/*", max_bytes=1000)
    assert seen == []


async def test_every_redirect_is_checked_again() -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "http://metadata.internal/latest"})

    transport, seen = recording(handle)
    table = {"tienda.cr": ["93.184.216.34"], "metadata.internal": ["169.254.169.254"]}
    fetcher = SafeFetcher(resolver=resolver(table), transport=transport)
    with pytest.raises(FetchError):
        await fetcher.get("https://tienda.cr/", accept="*/*", max_bytes=1000)
    assert len(seen) == 1


async def test_redirects_are_followed_a_few_times_only() -> None:
    transport, seen = recording(lambda r: httpx.Response(301, headers={"location": "/otra"}))
    fetcher = SafeFetcher(resolver=resolver({"tienda.cr": ["93.184.216.34"]}), transport=transport)
    with pytest.raises(FetchError):
        await fetcher.get("https://tienda.cr/", accept="*/*", max_bytes=1000)
    assert len(seen) == MAX_REDIRECTS + 1


async def test_large_bodies_are_refused_but_long_pages_are_cut() -> None:
    big = b"x" * 5000
    table = {"a.cr": ["93.184.216.34"]}
    image = SafeFetcher(
        resolver=resolver(table),
        transport=httpx.MockTransport(
            lambda r: httpx.Response(200, headers={"content-type": "image/png"}, content=big)
        ),
    )
    with pytest.raises(FetchError):
        await image.get("https://a.cr/x.png", accept="image/*", max_bytes=1000)

    def page(_r: httpx.Request) -> httpx.Response:
        # Streamed, with no Content-Length to go by.
        return httpx.Response(
            200, headers={"content-type": "text/html"}, stream=httpx.ByteStream(big)
        )

    html = SafeFetcher(resolver=resolver(table), transport=httpx.MockTransport(page))
    fetched = await html.get("https://a.cr/", accept="text/html", max_bytes=1000)
    assert len(fetched.body) == 1000


async def test_http_errors_are_fetch_errors() -> None:
    transport, _ = recording(lambda r: httpx.Response(404))
    fetcher = SafeFetcher(resolver=resolver({"a.cr": ["93.184.216.34"]}), transport=transport)
    with pytest.raises(FetchError):
        await fetcher.get("https://a.cr/", accept="*/*", max_bytes=1000)


async def test_generic_page_preview_through_the_fetcher() -> None:
    links = FakeLinks()
    links.html("https://tienda.cr/lego", og_page("Lego", "https://cdn.tienda.cr/lego.png"))
    links.image("https://cdn.tienda.cr/lego.png", small_png((1600, 900)))
    preview = await fetch_preview("https://tienda.cr/lego", links)
    assert preview is not None
    assert (preview.title, preview.image_url) == ("Lego", "https://cdn.tienda.cr/lego.png")
