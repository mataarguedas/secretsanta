from typing import Any


async def ping(_ctx: dict[str, Any]) -> str:
    """No-op task used to check that the worker is wired up."""
    return "pong"
