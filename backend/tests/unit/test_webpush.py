"""send_raw, the test-notification task, templates, the VAPID script and device names."""

import base64
import json
from typing import Any

import pytest
from py_vapid import Vapid02
from pywebpush import WebPushException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings, get_settings
from app.models import PushSubscription, User
from app.notifications import webpush
from app.notifications.templates import render
from app.scripts.gen_vapid_keys import generate_vapid_keys, main
from app.services.push import describe_user_agent
from app.worker.tasks import send_test_notification

ENDPOINT = "https://fcm.googleapis.com/fcm/send/device-1"


class FakeResponse:
    def __init__(self, status_code: int) -> None:
        self.status_code = status_code


class FakeTransport:
    """Stands in for pywebpush.webpush: records calls, or fails with a status."""

    def __init__(self, fail_with: int | Exception | None = None) -> None:
        self.calls: list[dict[str, Any]] = []
        self.fail_with = fail_with

    def __call__(self, **kwargs: Any) -> None:
        self.calls.append(kwargs)
        if isinstance(self.fail_with, int):
            raise WebPushException("push failed", response=FakeResponse(self.fail_with))
        if isinstance(self.fail_with, Exception):
            raise self.fail_with


@pytest.fixture
def settings() -> Settings:
    public, private = generate_vapid_keys()
    return get_settings().model_copy(
        update={
            "vapid_public_key": public,
            "vapid_private_key": private,
            "vapid_subject": "mailto:santa@test.local",
        }
    )


@pytest.fixture
def transport(monkeypatch: pytest.MonkeyPatch) -> FakeTransport:
    fake = FakeTransport()
    monkeypatch.setattr(webpush, "transport", fake)
    return fake


async def make_subscription(
    db: async_sessionmaker[AsyncSession], locale: str = "es", endpoint: str = ENDPOINT
) -> PushSubscription:
    async with db() as session:
        user = User(
            google_sub=f"sub-{endpoint}", email=f"{locale}@t.local", name="Ana", locale=locale
        )
        session.add(user)
        await session.flush()
        subscription = PushSubscription(
            user_id=user.id, endpoint=endpoint, p256dh="p256dh-key", auth="auth-key"
        )
        session.add(subscription)
        await session.commit()
        return subscription


async def all_subscriptions(db: async_sessionmaker[AsyncSession]) -> list[PushSubscription]:
    async with db() as session:
        return list(await session.scalars(select(PushSubscription)))


# ── send_raw ─────────────────────────────────────────────────────────────────


async def test_send_raw_encrypts_to_the_subscription_with_vapid(
    db: async_sessionmaker[AsyncSession],
    clean_tables: None,
    settings: Settings,
    transport: FakeTransport,
) -> None:
    await make_subscription(db)
    payload = {"title": "Secret Santa", "body": "¡Hola!", "tag": "t", "url": "/profile"}
    async with db() as session:
        (subscription,) = await session.scalars(select(PushSubscription))
        assert await webpush.send_raw(session, subscription, payload, settings=settings)
        await session.commit()

    (call,) = transport.calls
    assert call["subscription_info"] == {
        "endpoint": ENDPOINT,
        "keys": {"p256dh": "p256dh-key", "auth": "auth-key"},
    }
    assert json.loads(call["data"]) == payload
    assert "¡Hola!" in call["data"]  # sent as UTF-8, not \\u escapes
    assert call["vapid_private_key"] == settings.vapid_private_key
    assert call["vapid_claims"] == {"sub": "mailto:santa@test.local"}
    assert call["ttl"] > 0
    (stored,) = await all_subscriptions(db)
    assert stored.last_success_at is not None


@pytest.mark.parametrize("status", [404, 410])
async def test_a_gone_subscription_is_deleted(
    db: async_sessionmaker[AsyncSession],
    clean_tables: None,
    settings: Settings,
    transport: FakeTransport,
    status: int,
) -> None:
    await make_subscription(db)
    transport.fail_with = status
    async with db() as session:
        (subscription,) = await session.scalars(select(PushSubscription))
        assert not await webpush.send_raw(session, subscription, {}, settings=settings)
        await session.commit()
    assert await all_subscriptions(db) == []


@pytest.mark.parametrize("failure", [500, 429, ConnectionError("offline")])
async def test_other_failures_keep_the_subscription(
    db: async_sessionmaker[AsyncSession],
    clean_tables: None,
    settings: Settings,
    transport: FakeTransport,
    failure: int | Exception,
) -> None:
    await make_subscription(db)
    transport.fail_with = failure
    async with db() as session:
        (subscription,) = await session.scalars(select(PushSubscription))
        assert not await webpush.send_raw(session, subscription, {}, settings=settings)
        await session.commit()
    (stored,) = await all_subscriptions(db)
    assert stored.last_success_at is None


async def test_without_vapid_keys_nothing_is_sent(
    db: async_sessionmaker[AsyncSession], clean_tables: None, transport: FakeTransport
) -> None:
    await make_subscription(db)
    unconfigured = get_settings().model_copy(update={"vapid_private_key": ""})
    async with db() as session:
        (subscription,) = await session.scalars(select(PushSubscription))
        assert not await webpush.send_raw(session, subscription, {}, settings=unconfigured)
    assert transport.calls == []


# ── The dev-only test notification ───────────────────────────────────────────


@pytest.mark.parametrize(
    ("locale", "body"),
    [
        ("es", "Notificación de prueba: las notificaciones funcionan."),
        ("en", "Test notification: notifications are working."),
    ],
)
async def test_send_test_notification_goes_to_every_device_in_my_language(
    db: async_sessionmaker[AsyncSession],
    clean_tables: None,
    settings: Settings,
    transport: FakeTransport,
    monkeypatch: pytest.MonkeyPatch,
    locale: str,
    body: str,
) -> None:
    monkeypatch.setattr(webpush, "get_settings", lambda: settings)
    first = await make_subscription(db, locale)
    async with db() as session:
        session.add(
            PushSubscription(user_id=first.user_id, endpoint=ENDPOINT + "-2", p256dh="k", auth="a")
        )
        await session.commit()
    await make_subscription(db, "es" if locale == "en" else "en", ENDPOINT + "-other-user")

    delivered = await send_test_notification({"sessionmaker": db}, str(first.user_id))

    assert delivered == 2
    assert {c["subscription_info"]["endpoint"] for c in transport.calls} == {
        ENDPOINT,
        ENDPOINT + "-2",
    }
    for call in transport.calls:
        assert json.loads(call["data"]) == {
            "title": "Secret Santa",
            "body": body,
            "tag": "test",
            "url": "/profile",
        }


async def test_send_test_notification_for_a_missing_user(
    db: async_sessionmaker[AsyncSession], clean_tables: None
) -> None:
    assert (
        await send_test_notification({"sessionmaker": db}, "0" * 8 + "-0000-0000-0000-" + "0" * 12)
        == 0
    )


def test_templates_fall_back_to_spanish() -> None:
    assert render("test", "fr") == render("test", "es")
    assert render("test", "en").title == "Secret Santa"


# ── VAPID keys ───────────────────────────────────────────────────────────────


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def test_generated_vapid_keys_are_a_matching_pair_pywebpush_can_read() -> None:
    public, private = generate_vapid_keys()
    assert "=" not in public + private
    raw_public = _unb64(public)
    assert len(raw_public) == 65  # an uncompressed P-256 point…
    assert raw_public[0] == 0x04
    assert len(_unb64(private)) == 32
    vapid = Vapid02.from_string(private)
    assert vapid.public_key is not None
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

    derived = vapid.public_key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
    assert derived == raw_public
    assert generate_vapid_keys() != (public, private)


def test_the_script_prints_env_lines(capsys: pytest.CaptureFixture[str]) -> None:
    main()
    lines = capsys.readouterr().out.splitlines()
    assert [line.split("=", 1)[0] for line in lines] == [
        "VAPID_PUBLIC_KEY",
        "VAPID_PRIVATE_KEY",
        "VAPID_SUBJECT",
    ]


# ── Device names ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("user_agent", "expected"),
    [
        (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/140.0.0.0 Safari/537.36",
            ("Chrome", "Windows"),
        ),
        (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
            ("Edge", "Windows"),
        ),
        (
            "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) "
            "SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
            ("Samsung Internet", "Android"),
        ),
        (
            "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0",
            ("Firefox", "Android"),
        ),
        (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
            "(KHTML, like Gecko) Version/18.0 Safari/605.1.15",
            ("Safari", "macOS"),
        ),
        (
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 "
            "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
            ("Safari", "iPhone"),
        ),
        (
            "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
            "(KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1",
            ("Chrome", "iPad"),
        ),
        ("curl/8.0", (None, None)),
        ("", (None, None)),
        (None, (None, None)),
    ],
)
def test_describe_user_agent(
    user_agent: str | None, expected: tuple[str | None, str | None]
) -> None:
    assert describe_user_agent(user_agent) == expected
