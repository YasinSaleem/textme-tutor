#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "$0")/load-env.sh"
load_env_file ".env"

if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
  echo "OPENROUTER_API_KEY is not set."
  exit 1
fi

OPENROUTER_BASE_URL="${OPENROUTER_BASE_URL:-https://openrouter.ai/api/v1}"

echo "Checking OpenRouter credentials..."
curl --fail --silent --show-error \
  -H "Authorization: Bearer ${OPENROUTER_API_KEY}" \
  -H "HTTP-Referer: ${OPENROUTER_HTTP_REFERER:-http://localhost}" \
  -H "X-Title: ${OPENROUTER_APP_TITLE:-Daily DSA Intuition Builder}" \
  "${OPENROUTER_BASE_URL}/models" >/dev/null

echo "OpenRouter credentials look valid."
