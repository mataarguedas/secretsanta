"""Shared helpers for auth API tests."""

from http.cookies import SimpleCookie

import httpx

CSRF = {"X-Requested-With": "fetch"}


def set_cookies(response: httpx.Response) -> dict[str, SimpleCookie]:
    """Parse every Set-Cookie header, keyed by cookie name (attributes preserved)."""
    parsed: dict[str, SimpleCookie] = {}
    for header in response.headers.get_list("set-cookie"):
        jar: SimpleCookie = SimpleCookie()
        jar.load(header)
        for name in jar:
            parsed[name] = jar
    return parsed


def cookie_value(response: httpx.Response, name: str) -> str:
    return set_cookies(response)[name][name].value


def cookie_attrs(response: httpx.Response, name: str) -> dict[str, str | bool]:
    morsel = set_cookies(response)[name][name]
    return {key: morsel[key] for key in morsel if morsel[key] not in ("", False)}


async def login_as(
    client: httpx.AsyncClient, email: str = "ana@test.local", name: str = "Ana"
) -> httpx.Response:
    response = await client.post(
        "/api/v1/test/login", json={"email": email, "name": name}, headers=CSRF
    )
    assert response.status_code == 200, response.text
    return response
