"""List database backups in R2, or stream one to stdout for a restore (README, "Restore"):

    docker compose run --rm -T worker python -m app.scripts.backups list
    docker compose run --rm -T worker python -m app.scripts.backups cat \\
        backups/santa-20261224-0800.sql.gz > restore.sql.gz

Only keys under ``backups/`` are readable through this tool.
"""

import argparse
import sys
from collections.abc import Sequence
from typing import BinaryIO

from app.services.backup import BACKUP_PREFIX, backup_time
from app.storage.r2 import ObjectStorage, get_storage


def list_backups(storage: ObjectStorage) -> list[str]:
    """Backup keys, newest first."""
    keys = [k for k in storage.list_keys(BACKUP_PREFIX) if backup_time(k) is not None]
    return sorted(keys, reverse=True)


def cat_backup(storage: ObjectStorage, key: str, out: BinaryIO) -> None:
    if backup_time(key) is None:
        raise ValueError(f"not a backup key: {key!r}")
    storage.download_fileobj(key, out)


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="backups", description="Database backups in R2.")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("list", help="list backup keys, newest first")
    cat = commands.add_parser("cat", help="write one backup (gzipped SQL) to stdout")
    cat.add_argument("key")
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)

    storage = get_storage()
    if args.command == "list":
        for key in list_backups(storage):
            print(key)
        return
    try:
        cat_backup(storage, args.key, sys.stdout.buffer)
    except ValueError as exc:
        parser.error(str(exc))
    sys.stdout.buffer.flush()


if __name__ == "__main__":
    main()
