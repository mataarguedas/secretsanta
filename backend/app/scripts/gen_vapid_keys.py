"""Generate a VAPID keypair for Web Push, printed in ``.env`` format.

    uv run python -m app.scripts.gen_vapid_keys >> ../infra/.env

Both keys are base64url without padding: the public key is the uncompressed P-256 point
(what the browser's ``applicationServerKey`` wants), the private key the raw 32-byte
scalar (what pywebpush/py_vapid read). Generate once per environment; changing the keys
invalidates every existing subscription.
"""

import base64

from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def generate_vapid_keys() -> tuple[str, str]:
    """``(public_key, private_key)``."""
    private = ec.generate_private_key(ec.SECP256R1())
    public = private.public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
    scalar = private.private_numbers().private_value.to_bytes(32, "big")
    return _b64url(public), _b64url(scalar)


def main() -> None:
    public, private = generate_vapid_keys()
    print(f"VAPID_PUBLIC_KEY={public}")
    print(f"VAPID_PRIVATE_KEY={private}")
    print("VAPID_SUBJECT=mailto:admin@example.com")


if __name__ == "__main__":
    main()
