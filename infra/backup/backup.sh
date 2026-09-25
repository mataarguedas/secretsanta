#!/usr/bin/env bash
# Manual database backup. Run on the server as the deploy user (the deploy workflow keeps a
# copy in /opt/santa):
#
#   bash backup.sh           same as the nightly cron: pg_dump | gzip → R2
#                            backups/santa-YYYYMMDD-HHMM.sql.gz, then prune > 14 days
#   bash backup.sh --local   pg_dump | gzip into /opt/santa/backups/ only (no R2), e.g.
#                            right before a risky migration or when R2 is unreachable
#
# Restore steps: README › "Backups and restore".

set -euo pipefail
cd "${SANTA_DIR:-/opt/santa}"

case "${1:-}" in
  "")
    docker compose run --rm -T worker python -m app.scripts.run_job backup_database
    ;;
  --local)
    mkdir -p backups
    out="backups/santa-$(date -u +%Y%m%d-%H%M).sql.gz"
    docker compose exec -T postgres pg_dump -U santa -d santa --no-owner --no-privileges \
      | gzip > "$out.partial"
    mv "$out.partial" "$out"
    chmod 600 "$out"
    echo "$out ($(du -h "$out" | cut -f1))"
    ;;
  *)
    echo "usage: $0 [--local]" >&2
    exit 2
    ;;
esac
