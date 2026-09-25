"""Push templates (both locales) and notify()'s preference filtering."""

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import User
from app.notifications import sender
from app.notifications.sender import PREFERENCES, build_payload, notify, wants
from app.notifications.templates import en as en_templates
from app.notifications.templates import es as es_templates
from app.notifications.templates import format_crc, preview, render, sender_label
from tests.push import PushSpy, subscribe

KINDS = ("test", "reveal", "message", "wishlist_updated", "exchange_reminder")
PARAMS = {
    "event": "Oficina 2026",
    "sender": "Ana",
    "preview": "¡Hola!",
    "days": 7,
    "budget_crc": 25000,
}


# ── Templates ────────────────────────────────────────────────────────────────


def test_every_kind_exists_in_both_locales_and_has_a_preference_rule() -> None:
    assert set(es_templates.TEMPLATES) == set(en_templates.TEMPLATES) == set(KINDS)
    assert set(PREFERENCES) == set(KINDS)
    for kind in KINDS:
        for locale in ("es", "en"):
            text = render(kind, locale, **PARAMS)
            assert text.title.strip()
            assert text.body.strip()
            assert "{" not in text.title + text.body  # nothing left unformatted


@pytest.mark.parametrize(
    ("kind", "locale", "params", "title", "body"),
    [
        (
            "reveal",
            "es",
            {"event": "Oficina 2026"},
            "Secret Santa",
            "Ya se hizo el sorteo de «Oficina 2026»: ¡descubre a quién le regalas!",
        ),
        (
            "reveal",
            "en",
            {"event": "Office Party"},
            "Secret Santa",
            "The draw for Office Party is done — see who you're giving to!",
        ),
        (
            "message",
            "en",
            {"event": "Office Party", "sender": "Secret Elf #3", "preview": "Does she prefer…"},
            "Office Party",
            "Secret Elf #3: Does she prefer…",
        ),
        (
            "wishlist_updated",
            "es",
            {"event": "Familia"},
            "Familia",
            "La persona a quien le regalas actualizó su lista de deseos.",
        ),
        (
            "wishlist_updated",
            "en",
            {"event": "Familia"},
            "Familia",
            "The person you're giving to updated their wishlist",
        ),
        (
            "exchange_reminder",
            "en",
            {"event": "Office Party", "days": 1, "budget_crc": 25000},
            "Office Party",
            "1 day until Office Party — budget ₡25\u00a0000",
        ),
        (
            "exchange_reminder",
            "en",
            {"event": "Office Party", "days": 7, "budget_crc": 25000},
            "Office Party",
            "7 days until Office Party — budget ₡25\u00a0000",
        ),
        (
            "exchange_reminder",
            "es",
            {"event": "Oficina", "days": 1, "budget_crc": 1500000},
            "Oficina",
            "Falta 1 día para «Oficina» — presupuesto ₡1\u00a0500\u00a0000",
        ),
        (
            "exchange_reminder",
            "es",
            {"event": "Oficina", "days": 7, "budget_crc": 0},
            "Oficina",
            "Faltan 7 días para «Oficina» — presupuesto ₡0",
        ),
    ],
)
def test_template_texts(
    kind: str, locale: str, params: dict[str, object], title: str, body: str
) -> None:
    text = render(kind, locale, **params)
    assert (text.title, text.body) == (title, body)


def test_an_unknown_locale_falls_back_to_spanish() -> None:
    assert render("reveal", "fr", event="X") == render("reveal", "es", event="X")


def test_the_wishlist_template_takes_no_owner_at_all() -> None:
    # Extra params are ignored: even a caller that passed the owner couldn't print it.
    for locale in ("es", "en"):
        text = render("wishlist_updated", locale, event="E", owner="Beto", sender="Beto")
        assert "Beto" not in text.title + text.body


def test_sender_labels_are_localized() -> None:
    assert sender_label("es", anon_number=3) == "Elfo secreto #3"
    assert sender_label("en", anon_number=3) == "Secret Elf #3"
    # An anonymous sender is the alias even if a name were passed along.
    assert sender_label("es", sender="Beto", anon_number=3) == "Elfo secreto #3"
    assert sender_label("es", sender="Ana") == "Ana"
    assert sender_label("es", former=True, sender="Ana") == "Ex participante"
    assert sender_label("en", sender=None) == "Former participant"


def test_format_crc_and_preview() -> None:
    assert format_crc(25000) == "₡25\u00a0000"
    assert format_crc(999) == "₡999"
    assert preview("hola") == "hola"
    assert preview("a  b\n\nc") == "a b c"
    assert preview("x" * 80) == "x" * 80
    assert preview("x" * 81) == "x" * 79 + "…"
    assert len(preview("y" * 500)) == 80


def test_the_payload_shape() -> None:
    user = User(locale="en")
    payload = build_payload("reveal", user, {"event": "E", "url": "/events/1", "tag": "t"})
    assert payload == {
        "title": "Secret Santa",
        "body": "The draw for E is done — see who you're giving to!",
        "url": "/events/1",
        "tag": "t",
    }
    assert "tag" not in build_payload("reveal", user, {"event": "E", "url": "/"})


# ── Preferences ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("kind", "field"),
    [
        ("message", "notify_message"),
        ("wishlist_updated", "notify_wishlist"),
        ("exchange_reminder", "notify_reminder"),
    ],
)
def test_each_kind_follows_its_toggle(kind: str, field: str) -> None:
    on = User(notify_message=True, notify_wishlist=True, notify_reminder=True)
    off = User(notify_message=True, notify_wishlist=True, notify_reminder=True)
    setattr(off, field, False)
    assert wants(on, kind)
    assert not wants(off, kind)


def test_reveal_and_test_are_always_on() -> None:
    muted = User(notify_message=False, notify_wishlist=False, notify_reminder=False)
    assert wants(muted, "reveal")
    assert wants(muted, "test")


async def test_notify_filters_by_preference_and_renders_per_recipient(
    db: async_sessionmaker[AsyncSession], clean_tables: None, push_spy: PushSpy
) -> None:
    async with db() as session:
        people = [
            User(google_sub="a", email="a@t.local", name="A", locale="es"),
            User(google_sub="b", email="b@t.local", name="B", locale="en"),
            User(google_sub="c", email="c@t.local", name="C", notify_message=False),
        ]
        session.add_all(people)
        await session.commit()
    ids = [p.id for p in people]
    await subscribe(db, *ids)

    async with db() as session:
        result = await notify(
            session,
            [*ids, uuid.uuid4()],  # an unknown id is ignored
            "message",
            lambda user: {"event": "E", "sender": f"to {user.name}", "preview": "p", "url": "/"},
        )

    assert result == sender.NotifyResult(recipients=2, opted_out=1, sent=2, failed=0)
    assert push_spy.to(ids[0])[0]["body"] == "to A: p"
    assert push_spy.to(ids[1])[0]["body"] == "to B: p"
    assert push_spy.to(ids[2]) == []


async def test_notify_with_nobody(db: async_sessionmaker[AsyncSession], clean_tables: None) -> None:
    async with db() as session:
        assert await notify(session, [], "reveal", {"url": "/"}) == sender.NotifyResult()
