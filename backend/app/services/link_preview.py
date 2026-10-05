"""Link previews for chat messages: title, description, site and a picture for the first URL
in a message, YouTube included (its oEmbed API, since the watch page is behind a cookie
wall for servers in the EU).

Privacy (CLAUDE.md §2.2, PRD FR-CHT-3): the browser never talks to the linked site. The
worker fetches the page once, right after the message is sent, re-encodes the picture and
stores it in R2 with the event's other objects; readers get it through a presigned URL like
any photo. So the linked site never sees a reader's IP, nor *when* anyone read the message
(which in an anonymous thread would be a read receipt for the initiator).

Server-side fetching of user-supplied URLs is an SSRF risk, so ``SafeFetcher`` only
connects to public addresses: every hop of a redirect is resolved and checked, and the
connection goes to the checked address itself (no second DNS lookup to rebind).

Never log the URL or anything fetched: they come from a message body.
"""

import asyncio
import ipaddress
import json
import re
import socket
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Any, Final, Protocol
from urllib.parse import parse_qs, quote, urljoin, urlsplit

import httpx
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.logging import get_logger
from app.models.chat import Conversation, Message
from app.models.event import Event, EventState
from app.realtime.channels import publish_to_conversation
from app.realtime.frames import message_updated_frame
from app.schemas.chat import build_message_public
from app.storage.images import ImageRejectedError, Rendition, process_preview_image
from app.storage.r2 import ObjectStorage, get_storage

log = get_logger(__name__)

TIMEOUT_SECONDS: Final = 5.0
MAX_REDIRECTS: Final = 4
MAX_HTML_BYTES: Final = 768 * 1024  # the <head> is near the top; never read whole pages
MAX_IMAGE_BYTES: Final = 5 * 1024 * 1024
MAX_URL_CHARS: Final = 2048
TITLE_MAX: Final = 200
DESCRIPTION_MAX: Final = 300
SITE_MAX: Final = 80

# ── Finding the URL (mirrors frontend/src/lib/linkify.ts) ────────────────────

_URL_PATTERN = re.compile(r"(?<![A-Za-z0-9_@./-])(?:https?://|www\.)[^\s<>\"]+", re.IGNORECASE)
_TRAILING_PUNCTUATION = re.compile(r"[.,;:!?'*_~]+$")
_BRACKETS: Final = (("(", ")"), ("[", "]"), ("{", "}"))


def _trim(url: str) -> str:
    while True:
        before = url
        url = _TRAILING_PUNCTUATION.sub("", url)
        for opener, closer in _BRACKETS:
            while url.endswith(closer) and url.count(closer) > url.count(opener):
                url = url[:-1]
        if url == before:
            return url


def _href(text: str) -> str | None:
    candidate = text if re.match(r"https?://", text, re.IGNORECASE) else f"https://{text}"
    try:
        parts = urlsplit(candidate)
        hostname = parts.hostname
    except ValueError:
        return None
    if parts.scheme.lower() not in ("http", "https") or not hostname or "." not in hostname:
        return None
    return candidate


def first_url(body: str) -> str | None:
    """The first link the chat UI shows in ``body``, as its href; None if there's none."""
    for match in _URL_PATTERN.finditer(body):
        href = _href(_trim(match.group(0)))
        if href is not None and len(href) <= MAX_URL_CHARS:
            return href
    return None


# ── Fetching safely ──────────────────────────────────────────────────────────


class FetchError(Exception):
    """The page or picture can't be used (blocked address, HTTP error, too big, …)."""


@dataclass(frozen=True, slots=True)
class Fetched:
    url: str  # after redirects
    content_type: str  # lower-case, without parameters
    charset: str | None
    body: bytes


class LinkFetcher(Protocol):
    async def get(self, url: str, *, accept: str, max_bytes: int) -> Fetched: ...


Resolver = Callable[[str, int], Awaitable[list[str]]]


async def resolve_host(host: str, port: int) -> list[str]:
    infos = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return [str(info[4][0]) for info in infos]


def is_public_address(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address.split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


class SafeFetcher:
    """GET over http(s) to public addresses only, on ports 80/443, following at most
    ``MAX_REDIRECTS`` redirects (each one re-checked), reading at most ``max_bytes``."""

    def __init__(
        self,
        *,
        resolver: Resolver = resolve_host,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._resolver = resolver
        self._transport = transport

    async def get(self, url: str, *, accept: str, max_bytes: int) -> Fetched:
        settings = get_settings()
        headers = {
            "Accept": accept,
            "Accept-Language": "es-CR,es;q=0.9,en;q=0.8",
            "User-Agent": f"Mozilla/5.0 (compatible; SecretSantaBot/1.0; +{settings.app_base_url})",
        }
        async with httpx.AsyncClient(
            transport=self._transport,
            timeout=TIMEOUT_SECONDS,
            follow_redirects=False,
            trust_env=False,  # never through an environment proxy
        ) as client:
            async with asyncio.timeout(TIMEOUT_SECONDS * 2):
                for _hop in range(MAX_REDIRECTS + 1):
                    target = httpx.URL(url)
                    request_url, host = await self._pin(target)
                    request = client.build_request(
                        "GET",
                        request_url,
                        headers={**headers, "Host": host},
                        # TLS: SNI and the certificate check use the real host name.
                        extensions={"sni_hostname": target.host},
                    )
                    response = await client.send(request, stream=True)
                    try:
                        if response.is_redirect:
                            location = response.headers.get("location")
                            if not location:
                                raise FetchError("redirect without a location")
                            url = urljoin(str(target), location)
                            continue
                        if response.status_code != 200:
                            raise FetchError(f"status {response.status_code}")
                        return await _read(response, str(target), max_bytes)
                    finally:
                        await response.aclose()
        raise FetchError("too many redirects")

    async def _pin(self, target: httpx.URL) -> tuple[httpx.URL, str]:
        """The URL to request (host replaced by a checked public IP) and the Host header."""
        if target.scheme not in ("http", "https") or not target.host:
            raise FetchError("not http(s)")
        default_port = 443 if target.scheme == "https" else 80
        port = target.port or default_port
        if port != default_port:
            raise FetchError("non-standard port")
        if target.host.rstrip(".").lower() == get_settings().app_domain.lower():
            raise FetchError("our own site")
        try:
            addresses = await self._resolver(target.host, port)
        except OSError as exc:
            raise FetchError("unresolvable") from exc
        if not addresses or not all(is_public_address(a) for a in addresses):
            raise FetchError("not a public address")
        host_header = target.host if target.port is None else f"{target.host}:{target.port}"
        return target.copy_with(host=addresses[0]), host_header


async def _read(response: httpx.Response, url: str, max_bytes: int) -> Fetched:
    declared = response.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > max_bytes:
        raise FetchError("too large")
    chunks: list[bytes] = []
    size = 0
    async for chunk in response.aiter_bytes():  # decoded: a gzip bomb hits the cap too
        size += len(chunk)
        if size > max_bytes:
            if response.headers.get("content-type", "").startswith("text/html"):
                chunks.append(chunk[: max_bytes - (size - len(chunk))])
                break  # a long page: its <head> is in what we have
            raise FetchError("too large")
        chunks.append(chunk)
    content_type, _, params = response.headers.get("content-type", "").partition(";")
    charset_match = re.search(r"charset=([\w.-]+)", params, re.IGNORECASE)
    return Fetched(
        url=url,
        content_type=content_type.strip().lower(),
        charset=charset_match.group(1) if charset_match else None,
        body=b"".join(chunks),
    )


# ── Reading the page ─────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class PreviewData:
    url: str
    title: str | None
    description: str | None
    site_name: str | None
    image_url: str | None
    is_video: bool


class _HeadParser(HTMLParser):
    """Collects ``<meta>`` (Open Graph, Twitter, description) and ``<title>`` up to ``<body>``."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.meta: dict[str, str] = {}
        self.title = ""
        self._in_title = False
        self.done = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "body":
            self.done = True
        elif tag == "title":
            self._in_title = True
        elif tag == "meta":
            values = {k.lower(): v for k, v in attrs if v is not None}
            key = (values.get("property") or values.get("name") or "").strip().lower()
            content = values.get("content")
            if key and content and key not in self.meta:
                self.meta[key] = content

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        elif tag == "head":
            self.done = True

    def handle_data(self, data: str) -> None:
        if self._in_title and not self.done:
            self.title += data


def _clean(value: str | None, limit: int) -> str | None:
    if not value:
        return None
    text = " ".join(value.split())
    if not text:
        return None
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _decode(fetched: Fetched) -> str:
    charset = fetched.charset
    if not charset:
        sniffed = re.search(rb"<meta[^>]+charset=[\"']?([\w.-]+)", fetched.body[:4096], re.I)
        charset = sniffed.group(1).decode("ascii") if sniffed else "utf-8"
    try:
        return fetched.body.decode(charset, errors="replace")
    except LookupError:
        return fetched.body.decode("utf-8", errors="replace")


def parse_html(html: str, page_url: str) -> PreviewData | None:
    parser = _HeadParser()
    try:
        parser.feed(html)
        parser.close()
    except Exception:  # HTMLParser is forgiving; anything else means "no preview"
        return None
    meta = parser.meta

    def first(*keys: str) -> str | None:
        return next((meta[k] for k in keys if meta.get(k)), None)

    title = _clean(first("og:title", "twitter:title") or parser.title, TITLE_MAX)
    description = _clean(
        first("og:description", "twitter:description", "description"), DESCRIPTION_MAX
    )
    image = first("og:image:secure_url", "og:image", "og:image:url", "twitter:image")
    image_url = urljoin(page_url, image.strip()) if image else None
    if image_url and urlsplit(image_url).scheme not in ("http", "https"):
        image_url = None
    if not title and not image_url:
        return None
    site_name = _clean(first("og:site_name", "application-name"), SITE_MAX)
    if not site_name:
        site_name = _clean(_display_host(page_url), SITE_MAX)
    return PreviewData(
        url=page_url,
        title=title,
        description=description,
        site_name=site_name,
        image_url=image_url,
        is_video=(first("og:type") or "").lower().startswith("video"),
    )


def _display_host(url: str) -> str | None:
    host = urlsplit(url).hostname
    return host.removeprefix("www.") if host else None


# ── YouTube ──────────────────────────────────────────────────────────────────

_YOUTUBE_HOSTS: Final = frozenset(
    {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}
)
_YOUTUBE_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")


def youtube_id(url: str) -> str | None:
    """The video id of a youtube.com / youtu.be link (watch, shorts, live, embed)."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return None
    host = (parts.hostname or "").lower()
    candidate: str | None = None
    segments = [s for s in parts.path.split("/") if s]
    if host in ("youtu.be", "www.youtu.be"):
        candidate = segments[0] if segments else None
    elif host in _YOUTUBE_HOSTS:
        if segments[:1] == ["watch"]:
            values = parse_qs(parts.query).get("v")
            candidate = values[0] if values else None
        elif len(segments) >= 2 and segments[0] in ("shorts", "live", "embed", "v"):
            candidate = segments[1]
    return candidate if candidate and _YOUTUBE_ID.match(candidate) else None


async def _youtube(video_id: str, url: str, fetcher: LinkFetcher) -> PreviewData | None:
    watch = f"https://www.youtube.com/watch?v={video_id}"
    oembed = f"https://www.youtube.com/oembed?format=json&url={quote(watch, safe='')}"
    try:
        fetched = await fetcher.get(oembed, accept="application/json", max_bytes=64 * 1024)
        data: Any = json.loads(fetched.body)
    except (FetchError, httpx.HTTPError, TimeoutError, ValueError):
        return None  # private, removed or unreachable: no preview
    if not isinstance(data, dict):
        return None
    title = data.get("title")
    author = data.get("author_name")
    return PreviewData(
        url=url,
        title=_clean(title if isinstance(title, str) else None, TITLE_MAX),
        description=_clean(author if isinstance(author, str) else None, DESCRIPTION_MAX),
        site_name="YouTube",
        # 1280x720 when the uploader provided it, else 320x180: neither is letterboxed.
        image_url=f"https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg",
        is_video=True,
    )


def _youtube_fallback_image(image_url: str) -> str | None:
    if image_url.startswith("https://i.ytimg.com/vi/") and image_url.endswith("/maxresdefault.jpg"):
        return image_url.removesuffix("maxresdefault.jpg") + "mqdefault.jpg"
    return None


# ── Putting it together ──────────────────────────────────────────────────────


async def fetch_preview(url: str, fetcher: LinkFetcher) -> PreviewData | None:
    video = youtube_id(url)
    if video is not None:
        return await _youtube(video, url, fetcher)
    try:
        fetched = await fetcher.get(
            url, accept="text/html,application/xhtml+xml", max_bytes=MAX_HTML_BYTES
        )
    except (FetchError, httpx.HTTPError, TimeoutError):
        return None
    if fetched.content_type not in ("text/html", "application/xhtml+xml"):
        return None
    parsed = parse_html(_decode(fetched), fetched.url)
    if parsed is None:
        return None
    # Link to what the user wrote, even if it redirected elsewhere.
    return PreviewData(
        url=url,
        title=parsed.title,
        description=parsed.description,
        site_name=parsed.site_name,
        image_url=parsed.image_url,
        is_video=parsed.is_video,
    )


async def fetch_image(image_url: str, fetcher: LinkFetcher) -> Rendition | None:
    """The picture as WebP (≤ 800px, no metadata), or None if it can't be used."""
    for candidate in (image_url, _youtube_fallback_image(image_url)):
        if candidate is None:
            continue
        try:
            fetched = await fetcher.get(candidate, accept="image/*", max_bytes=MAX_IMAGE_BYTES)
        except (FetchError, httpx.HTTPError, TimeoutError):
            continue
        try:
            # The format is sniffed from the bytes, whatever the Content-Type says.
            return await asyncio.to_thread(process_preview_image, fetched.body)
        except ImageRejectedError:
            return None
    return None


def preview_folder(event_id: uuid.UUID, conversation_id: uuid.UUID) -> str:
    """Under the event's folder, so deleting the event (or the conversation) removes it."""
    return f"events/{event_id}/conversations/{conversation_id}/"


def image_key_of(message: Message) -> str | None:
    preview = message.link_preview
    key = preview.get("image_key") if isinstance(preview, dict) else None
    return key if isinstance(key, str) else None


def default_fetcher() -> LinkFetcher:
    return SafeFetcher()


async def unfurl_message(
    session: AsyncSession,
    redis: "Redis",
    message_id: uuid.UUID,
    fetcher: LinkFetcher,
    storage: ObjectStorage | None = None,
) -> bool:
    """Worker: attach a preview of the message's first link and tell the conversation.
    Idempotent; returns whether a preview was attached."""
    row = (
        await session.execute(
            select(Message, Conversation.event_id, Event.state)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .join(Event, Event.id == Conversation.event_id)
            .where(Message.id == message_id)
        )
    ).one_or_none()
    if row is None:
        return False
    message, event_id, state = row
    if message.body is None or message.link_preview is not None or state == EventState.ARCHIVED:
        return False
    url = first_url(message.body)
    if url is None:
        return False
    conversation_id = message.conversation_id
    await session.rollback()  # no transaction held open across the network calls

    preview = await fetch_preview(url, fetcher)
    if preview is None:
        return False
    storage = storage or get_storage()
    image: dict[str, Any] = {}
    if preview.image_url:
        rendition = await fetch_image(preview.image_url, fetcher)
        if rendition is not None:
            key = f"{preview_folder(event_id, conversation_id)}{uuid.uuid4()}.webp"
            await asyncio.to_thread(storage.put, key, rendition.data)
            image = {
                "image_key": key,
                "image_width": rendition.width,
                "image_height": rendition.height,
            }
    if not preview.title and not image:
        return False

    # The message may have been deleted (or the event archived) meanwhile.
    message = await session.get(Message, message_id, with_for_update=True, populate_existing=True)
    current_state = await session.scalar(select(Event.state).where(Event.id == event_id))
    if (
        message is None
        or message.body is None
        or message.link_preview is not None
        or current_state == EventState.ARCHIVED
    ):
        await session.commit()
        if image:  # nothing points at it
            await asyncio.to_thread(storage.delete_many, [image["image_key"]])
        return False
    message.link_preview = {
        "url": preview.url,
        "title": preview.title,
        "description": preview.description,
        "site_name": preview.site_name,
        "is_video": preview.is_video,
        **image,
    }
    await session.commit()
    public = build_message_public(message)
    await publish_to_conversation(redis, conversation_id, message_updated_frame(public))
    log.info("link_preview_attached", has_image=bool(image), is_video=preview.is_video)
    return True
