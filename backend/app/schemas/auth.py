from pydantic import BaseModel, ConfigDict, Field


class TestLoginRequest(BaseModel):
    """Body of the ENV=test-only ``POST /test/login``."""

    __test__ = False  # not a pytest test class

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    email: str = Field(min_length=3, max_length=254, pattern=r"^[^@\s]+@[^@\s]+$")
    name: str = Field(min_length=1, max_length=120)


class RefreshResponse(BaseModel):
    status: str = "ok"
