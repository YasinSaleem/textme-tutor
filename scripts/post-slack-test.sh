#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "$0")/load-env.sh"
load_env_file ".env"

if [[ -z "${SLACK_BOT_TOKEN:-}" ]]; then
  echo "SLACK_BOT_TOKEN is not set."
  exit 1
fi

if [[ -z "${SLACK_CHANNEL_ID:-}" ]]; then
  echo "SLACK_CHANNEL_ID is not set."
  exit 1
fi

MESSAGE_TEXT="${1:-Phase 0 Slack connectivity check from Daily DSA Intuition Builder.}"

echo "Posting Slack test message..."
response="$(
  curl --fail --silent --show-error \
    -X POST "https://slack.com/api/chat.postMessage" \
    -H "Authorization: Bearer ${SLACK_BOT_TOKEN}" \
    -H "Content-Type: application/json; charset=utf-8" \
    --data "{\"channel\":\"${SLACK_CHANNEL_ID}\",\"text\":\"${MESSAGE_TEXT}\"}"
)"

echo "${response}"
