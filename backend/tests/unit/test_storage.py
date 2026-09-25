"""The S3/R2 client against moto's mock (CLAUDE.md §7 Uploads, PRD §8 Photo URLs)."""

from urllib.parse import parse_qs, urlsplit

import pytest

from app.core.config import get_settings
from app.storage.r2 import ObjectStorage
from app.worker.tasks import delete_objects, delete_prefix


def keys(storage: ObjectStorage, prefix: str = "") -> set[str]:
    return set(storage.list_keys(prefix))


def test_put_copy_and_delete_many(s3: ObjectStorage) -> None:
    s3.put("events/e1/cover/a.webp", b"main")
    s3.copy("events/e1/cover/a.webp", "events/e2/cover/a.webp")
    assert keys(s3) == {"events/e1/cover/a.webp", "events/e2/cover/a.webp"}
    head = s3._client.head_object(Bucket=s3.bucket, Key="events/e1/cover/a.webp")
    assert head["ContentType"] == "image/webp"

    assert s3.delete_many(["events/e1/cover/a.webp", "missing.webp"]) == 2
    assert keys(s3) == {"events/e2/cover/a.webp"}


def test_delete_prefix_stays_inside_the_folder(s3: ObjectStorage) -> None:
    for key in ("events/e1/cover/a.webp", "events/e1/items/i/b.webp", "events/e10/cover/c.webp"):
        s3.put(key, b"x")
    assert s3.delete_prefix("events/e1/") == 2
    assert keys(s3) == {"events/e10/cover/c.webp"}
    with pytest.raises(ValueError, match="must end with"):
        s3.delete_prefix("events/e1")


def test_presigned_urls_use_the_public_endpoint_and_expire_in_an_hour(s3: ObjectStorage) -> None:
    url = s3.presign_get("events/e1/cover/a.webp")
    parts = urlsplit(url)
    assert f"{parts.scheme}://{parts.netloc}" == "http://localhost:9000"
    assert parts.path == f"/{s3.bucket}/events/e1/cover/a.webp"
    query = parse_qs(parts.query)
    assert query["X-Amz-Expires"] == ["3600"]
    assert "X-Amz-Signature" in query


async def test_delete_tasks(s3: ObjectStorage) -> None:
    for key in ("events/e1/cover/a.webp", "events/e1/cover/a_thumb.webp", "events/e2/x.webp"):
        s3.put(key, b"x")
    assert await delete_objects({}, ["events/e1/cover/a.webp"]) == 1
    assert await delete_prefix({}, "events/e1/") == 1
    assert keys(s3) == {"events/e2/x.webp"}


def test_production_presigned_urls_use_the_r2_host_the_csp_allows() -> None:
    # Production: no S3_ENDPOINT_URL / S3_PUBLIC_ENDPOINT_URL, so the R2 account endpoint,
    # which Caddy's CSP allows as img-src https://*.r2.cloudflarestorage.com.
    settings = get_settings().model_copy(
        update={"r2_account_id": "abc123", "s3_endpoint_url": "", "s3_public_endpoint_url": ""}
    )
    parts = urlsplit(ObjectStorage(settings).presign_get("events/e1/cover/a.webp"))
    assert parts.scheme == "https"
    assert parts.netloc == "abc123.r2.cloudflarestorage.com"
