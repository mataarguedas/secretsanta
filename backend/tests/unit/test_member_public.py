"""``build_member_public`` is the only serializer for chat members (CLAUDE.md §2.2)."""

import uuid

from app.models import ConversationMember, User
from app.schemas.chat import (
    DELETED_USER_NAME,
    FORMER_MEMBER_NAME,
    MemberPublic,
    build_member_public,
)

ANON_USER = User(
    id=uuid.uuid4(),
    google_sub="sub-b",
    email="beto@test.local",
    name="Beto Secreto",
    avatar_url="https://lh3.googleusercontent.com/beto.png",
)
RECIPIENT = User(id=uuid.uuid4(), google_sub="sub-a", email="ana@test.local", name="Ana")
THIRD = User(id=uuid.uuid4(), google_sub="sub-c", email="carla@test.local", name="Carla")


def anonymous_member() -> ConversationMember:
    return ConversationMember(
        id=uuid.uuid4(),
        conversation_id=uuid.uuid4(),
        event_id=uuid.uuid4(),
        user_id=ANON_USER.id,
        is_anonymous=True,
        anon_number=7,
    )


def assert_hides_initiator(public: MemberPublic) -> None:
    raw = public.model_dump_json()
    for secret in (str(ANON_USER.id), ANON_USER.email, ANON_USER.name, "beto.png", "Beto"):
        assert secret not in raw, f"{secret!r} leaked: {raw}"
    assert "user_id" not in public.model_dump()
    assert "email" not in public.model_dump()


def test_anonymous_member_seen_by_the_recipient() -> None:
    member = anonymous_member()
    public = build_member_public(member, RECIPIENT)
    assert public.model_dump() == {
        "id": member.id,
        "display_name": "Secret Elf #7",
        "avatar_url": None,
        "is_self": False,
        "is_anonymous": True,
        "anon_number": 7,
        "is_former": False,
        "is_deleted": False,
    }
    assert_hides_initiator(public)


def test_anonymous_member_seen_by_the_initiator_is_still_only_the_alias() -> None:
    public = build_member_public(anonymous_member(), ANON_USER)
    assert public.is_self is True
    assert public.display_name == "Secret Elf #7"
    assert public.avatar_url is None
    assert_hides_initiator(public)


def test_anonymous_member_seen_by_a_third_party() -> None:
    public = build_member_public(anonymous_member(), THIRD)
    assert (public.is_self, public.display_name, public.avatar_url) == (
        False,
        "Secret Elf #7",
        None,
    )
    assert_hides_initiator(public)


def test_an_anonymous_member_never_touches_the_user_relationship() -> None:
    """Even if the user were loaded by mistake, nothing of it is read."""
    member = anonymous_member()
    member.user = ANON_USER
    assert_hides_initiator(build_member_public(member, RECIPIENT))


def test_named_member_in_a_group_shows_name_and_avatar_but_no_ids() -> None:
    member = ConversationMember(
        id=uuid.uuid4(),
        conversation_id=uuid.uuid4(),
        event_id=uuid.uuid4(),
        user_id=THIRD.id,
        is_anonymous=False,
        anon_number=None,
    )
    member.user = THIRD
    public = build_member_public(member, RECIPIENT)
    assert (public.display_name, public.is_self, public.is_anonymous) == ("Carla", False, False)
    raw = public.model_dump_json()
    assert str(THIRD.id) not in raw
    assert THIRD.email not in raw
    assert build_member_public(member, THIRD).is_self is True


def test_a_former_member_is_shown_as_such() -> None:
    member = ConversationMember(
        id=uuid.uuid4(), conversation_id=uuid.uuid4(), event_id=uuid.uuid4(), user_id=None
    )
    member.user = None
    public = build_member_public(member, RECIPIENT)
    assert (public.display_name, public.is_former, public.is_self, public.avatar_url) == (
        FORMER_MEMBER_NAME,
        True,
        False,
        None,
    )


def test_a_deleted_account_is_shown_as_deleted_user() -> None:
    member = ConversationMember(
        id=uuid.uuid4(),
        conversation_id=uuid.uuid4(),
        event_id=uuid.uuid4(),
        user_id=None,
        account_deleted=True,
    )
    member.user = None
    public = build_member_public(member, RECIPIENT)
    assert (public.display_name, public.is_deleted, public.is_former, public.avatar_url) == (
        DELETED_USER_NAME,
        True,
        False,
        None,
    )


def test_a_deleted_anonymous_initiator_is_still_only_the_alias() -> None:
    """Nothing tells the recipient that the elf's account is gone: that would let them
    match the alias to whoever just deleted their account."""
    member = anonymous_member()
    member.user_id = None
    member.account_deleted = True
    public = build_member_public(member, RECIPIENT)
    assert (public.display_name, public.is_deleted, public.is_former) == (
        "Secret Elf #7",
        False,
        False,
    )
    assert_hides_initiator(public)
