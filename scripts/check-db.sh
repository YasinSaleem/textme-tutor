#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "$0")/load-env.sh"
load_env_file ".env"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set."
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is not installed or not on PATH."
  exit 1
fi

echo "Checking Postgres connectivity..."
psql "${DATABASE_URL}" -c "select 1 as db_connection_ok;"
