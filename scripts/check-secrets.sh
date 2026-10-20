#!/usr/bin/env bash
# Scans for secret-shaped strings. Exit 1 if anything is found.
# Usage: scripts/check-secrets.sh [dir]
#   (no arg)  repo root. In a git repo: tracked + untracked-but-not-ignored files. Without git: every file.
#   dir       every file under dir (package-submission.sh uses this on the unpacked zip).
# Anvil's public default test keys are allowed anywhere (they are public; local use only, never fund them).
set -u
target="${1:-}"
use_git=0
if [ -n "$target" ]; then
  cd "$target" || { echo "check-secrets: cannot cd to $target"; exit 2; }
else
  cd "$(dirname "$0")/.."
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 && use_git=1
fi
if [ "$use_git" = 1 ]; then
  files=$(git ls-files -co --exclude-standard)
else
  files=$(find . -type f -not -path './node_modules/*' -not -path './.git/*' -not -path './contracts/out/*' | sed 's|^\./||')
fi
hits=0
ANVIL_KEYS='ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80|59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d|5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'
while IFS= read -r f; do
  [ -f "$f" ] || continue
  case "${f##*/}" in
    .env|.env.*) if [ "${f##*/}" != ".env.example" ]; then echo "ENV FILE present: $f (must never be committed or packaged)"; hits=1; fi ;;
  esac
  case "$f" in *.png|*.jpg|*.jpeg|*.gif|*.pdf|*.zip|*.lock|*pnpm-lock.yaml|node_modules/*) continue;; esac
  m=$(grep -InEo '(0x)?[0-9a-fA-F]{64}' "$f" 2>/dev/null | grep -Ev "$ANVIL_KEYS" || true)
  if [ -n "$m" ]; then
    # tx hashes / bytes32 are also 64 hex; only flag when the line mentions key-like names
    k=$(grep -InEi '(private|secret|mnemonic|api[_-]?key).{0,40}(0x)?[0-9a-fA-F]{64}' "$f" | grep -Ev "$ANVIL_KEYS" || true)
    if [ -n "$k" ]; then echo "POSSIBLE KEY in $f:"; echo "$k" | sed -E 's/(0x)?[0-9a-fA-F]{64}/<redacted>/g'; hits=1; fi
  fi
  a=$(grep -InE '(sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)' "$f" 2>/dev/null || true)
  if [ -n "$a" ]; then echo "POSSIBLE API KEY in $f"; hits=1; fi
done <<< "$files"
if [ "$use_git" = 1 ] && git ls-files --error-unmatch .env >/dev/null 2>&1; then
  echo ".env is tracked by git!"; hits=1
fi
[ "$hits" -eq 0 ] && echo "check-secrets: clean" || { echo "check-secrets: FOUND ISSUES"; exit 1; }
