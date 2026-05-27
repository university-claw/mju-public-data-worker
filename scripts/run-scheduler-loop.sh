#!/bin/sh
set -eu

interval="${PUBLIC_DATA_WORKER_TICK_INTERVAL_SECONDS:-600}"

case "$interval" in
  ''|*[!0-9]*)
    echo "PUBLIC_DATA_WORKER_TICK_INTERVAL_SECONDS must be a positive integer" >&2
    exit 2
    ;;
esac
if [ "$interval" -le 0 ]; then
  echo "PUBLIC_DATA_WORKER_TICK_INTERVAL_SECONDS must be greater than zero" >&2
  exit 2
fi

if [ "${PUBLIC_DATA_WORKER_RUN_MIGRATIONS:-1}" != "0" ]; then
  node dist/main.js migrate
fi

if [ "${PUBLIC_DATA_SEED_IMPORT_ON_START:-0}" = "1" ]; then
  node scripts/import-seeds-from-release.mjs
fi

while true; do
  if ! node dist/main.js schedule tick; then
    echo "public data scheduler tick failed; retrying after ${interval}s" >&2
  fi
  sleep "$interval"
done
