#!/usr/bin/env bash
# Everything that must be green before a PR/merge. Skips layers that do not exist yet (and says so).
set -u
cd "$(dirname "$0")/.."
fail=0
step() { printf '\n== %s ==\n' "$1"; }
run()  { "$@" || { echo "FAILED: $*"; fail=1; }; }

step "secrets";  run bash scripts/check-secrets.sh
step "script syntax"; for s in scripts/*.sh; do run bash -n "$s"; done
step "opencode.json valid"; run jq -e . opencode.json >/dev/null
step "worked example (reference numbers)"; run python3 -I eval/worked_example.py >/dev/null

step "contracts"
if [ -f contracts/src/MandateVault.sol ] && command -v forge >/dev/null 2>&1; then
  pushd contracts >/dev/null
  run forge build
  run forge test
  popd >/dev/null
else echo "skipped (no MandateVault.sol yet or forge missing)"; fi

step "typescript"
if [ -f package.json ] && command -v pnpm >/dev/null 2>&1; then
  run pnpm -r --if-present typecheck
  run pnpm -r --if-present test
else echo "skipped (no package.json yet)"; fi

step "docs link check (relative .md links)"
python3 -I - <<'PY' || fail=1
import re, pathlib, sys
root = pathlib.Path('.')
bad = 0
for p in root.rglob('*.md'):
    if any(x in p.parts for x in ('node_modules', '.git', 'out')): continue
    for m in re.finditer(r'\]\(([^)#\s]+\.md)(#[^)]*)?\)', p.read_text(encoding='utf-8')):
        t = (p.parent / m.group(1)).resolve()
        if not t.exists():
            print(f'broken link in {p}: {m.group(1)}'); bad = 1
sys.exit(bad)
PY

echo
[ "$fail" -eq 0 ] && echo "VERIFY-ALL: GREEN" || { echo "VERIFY-ALL: RED"; exit 1; }
