"""Object storage: Cloudflare R2 through the S3 API (MinIO in development).

The bucket is private. Browsers only ever get presigned GET URLs (1 h, PRD §8). boto3 is
synchronous: call the network methods through ``asyncio.to_thread`` from async code.
Presigning is local (no network) and can be called directly.
"""

from collections.abc import Iterable
from functools import lru_cache
from typing import Any, BinaryIO, Final

import boto3
from botocore.config import Config

from app.core.config import Settings, get_settings

PRESIGN_SECONDS: Final = 3600
_DELETE_BATCH: Final = 1000  # S3 DeleteObjects limit


class ObjectStorage:
    def __init__(self, settings: Settings) -> None:
        self.bucket = settings.r2_bucket
        # R2 wants region "auto"; MinIO (and moto) validate against us-east-1.
        region = "us-east-1" if settings.s3_endpoint_url else "auto"
        config = Config(
            signature_version="s3v4",
            s3={"addressing_style": "path"},
            retries={"max_attempts": 3, "mode": "standard"},
        )
        common: dict[str, Any] = {
            "aws_access_key_id": settings.r2_access_key_id or None,
            "aws_secret_access_key": settings.r2_secret_access_key or None,
            "region_name": region,
            "config": config,
        }
        self._client = boto3.client("s3", endpoint_url=settings.s3_endpoint, **common)
        public = settings.s3_public_endpoint_url
        # The API may reach storage at an address the browser can't (e.g. a compose
        # hostname); presigned URLs are signed for the public address instead.
        self._presigner = (
            boto3.client("s3", endpoint_url=public, **common) if public else self._client
        )

    def put(self, key: str, data: bytes, content_type: str = "image/webp") -> None:
        self._client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
            # Keys are unique per upload (a new uuid each time), so they never change.
            CacheControl="private, max-age=31536000, immutable",
        )

    def upload_file(self, path: str, key: str, content_type: str) -> None:
        """Stream a local file up (multipart for large files, e.g. database backups)."""
        self._client.upload_file(path, self.bucket, key, ExtraArgs={"ContentType": content_type})

    def download_fileobj(self, key: str, fileobj: BinaryIO) -> None:
        self._client.download_fileobj(self.bucket, key, fileobj)

    def copy(self, source_key: str, dest_key: str) -> None:
        self._client.copy_object(
            Bucket=self.bucket,
            Key=dest_key,
            CopySource={"Bucket": self.bucket, "Key": source_key},
        )

    def delete_many(self, keys: Iterable[str]) -> int:
        """Delete keys (missing ones are fine). Returns how many were requested."""
        unique = sorted(set(keys))
        for start in range(0, len(unique), _DELETE_BATCH):
            batch = unique[start : start + _DELETE_BATCH]
            self._client.delete_objects(
                Bucket=self.bucket,
                Delete={"Objects": [{"Key": key} for key in batch], "Quiet": True},
            )
        return len(unique)

    def list_keys(self, prefix: str) -> list[str]:
        keys: list[str] = []
        paginator = self._client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
            keys.extend(item["Key"] for item in page.get("Contents", []))
        return keys

    def delete_prefix(self, prefix: str) -> int:
        if not prefix.endswith("/"):
            raise ValueError("prefix must end with '/' so it can't match a sibling folder")
        return self.delete_many(self.list_keys(prefix))

    def presign_get(self, key: str, expires: int = PRESIGN_SECONDS) -> str:
        url: str = self._presigner.generate_presigned_url(
            "get_object", Params={"Bucket": self.bucket, "Key": key}, ExpiresIn=expires
        )
        return url


@lru_cache
def get_storage() -> ObjectStorage:
    """One client per process (boto3 clients are thread-safe)."""
    return ObjectStorage(get_settings())
