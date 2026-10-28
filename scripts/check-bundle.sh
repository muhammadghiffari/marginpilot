#!/usr/bin/env bash
# Fail if the built web bundle contains key-shaped values or secret variable names.
set -euo pipefail
DIR="${1:-$(cd "$(dirname "$0")/.." && pwd)/apps/web/dist}"
[ -d "$DIR" ] || { echo "check-bundle: $DIR does not exist (build the web app first)" >&2; exit 1; }
status=0
if grep -rEl '0x[0-9a-fA-F]{64}' "$DIR" >/dev/null 2>&1; then
  echo "check-bundle: 64-hex value found in: $(grep -rEl '0x[0-9a-fA-F]{64}' "$DIR" | tr '\n' ' ')" >&2; status=1
fi
if grep -rEl 'PRIVATE_KEY|LLM_API_KEY|OWNER_PRIVATE|EXECUTOR_PRIVATE|BEGIN [A-Z ]*PRIVATE KEY|sk-[A-Za-z0-9]{20,}' "$DIR" >/dev/null 2>&1; then
  echo "check-bundle: secret-like name found in: $(grep -rEl 'PRIVATE_KEY|LLM_API_KEY|OWNER_PRIVATE|EXECUTOR_PRIVATE|BEGIN [A-Z ]*PRIVATE KEY|sk-[A-Za-z0-9]{20,}' "$DIR" | tr '\n' ' ')" >&2; status=1
fi
[ "$status" -eq 0 ] && echo "check-bundle: clean ($DIR)"
exit "$status"
