#!/usr/bin/env bash
# Preflight: checks tools and env shape. NEVER prints secret values. Does not execute .env (it is parsed, not sourced).
# Usage: scripts/preflight.sh [--chain] [--role dev-a|dev-b]
#   --chain       also pings RPC_URL
#   --role dev-b  forge/anvil/cast are warnings, not required (Dev B has no contracts work)
set -u
cd "$(dirname "$0")/.."
fail=0; chain=0; role=""
while [ $# -gt 0 ]; do
  case "$1" in
    --chain) chain=1 ;;
    --role)  shift; role="${1:-}" ;;
    --role=*) role="${1#--role=}" ;;
    *) echo "unknown arg: $1"; exit 2 ;;
  esac
  shift
done
case "$role" in ""|dev-a|dev-b) ;; *) echo "unknown --role '$role' (use dev-a or dev-b)"; exit 2 ;; esac
ok()   { printf '  [ok]   %s\n' "$1"; }
bad()  { printf '  [FAIL] %s\n' "$1"; fail=1; }
warn() { printf '  [warn] %s\n' "$1"; }

echo "Tools"
for t in git node pnpm forge anvil cast jq python3 zip unzip; do
  if command -v "$t" >/dev/null 2>&1; then
    case "$t" in
      zip|unzip) ok "$t present" ;;
      *) ok "$t: $("$t" --version 2>&1 | head -n1)" ;;
    esac
  elif [ "$role" = "dev-b" ] && case "$t" in forge|anvil|cast) true;; *) false;; esac; then warn "$t not found (optional for dev-b)"
  else bad "$t not found"; fi
done
command -v opencode >/dev/null 2>&1 && ok "opencode present" || warn "opencode not on PATH (ok if launched differently)"
if command -v node >/dev/null 2>&1; then
  major=$(node -p 'process.versions.node.split(".")[0]')
  [ "$major" -ge 22 ] && ok "node major >= 22" || bad "node major is $major, need >= 22"
fi

echo "Repo"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 && ok "git repo" || bad "not a git repo (run git init / clone)"
[ -f opencode.json ] && jq -e . opencode.json >/dev/null 2>&1 && ok "opencode.json is valid JSON" || bad "opencode.json missing or invalid"
if ls scripts/*.sh >/dev/null 2>&1; then
  nonexec=$(for s in scripts/*.sh; do [ -x "$s" ] || echo "$s"; done)
  [ -z "$nonexec" ] && ok "scripts/*.sh are executable" || bad "not executable: $(echo $nonexec) (fix: chmod +x scripts/*.sh; git update-index --chmod=+x scripts/*.sh)"
fi

echo "Env (.env shape only)"
if [ -f .env ]; then
  # parse KEY=VALUE lines; tolerate CRLF and surrounding quotes; never execute the file
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%$'\r'}
    case "$line" in ''|'#'*) continue;; esac
    k=${line%%=*}; v=${line#*=}
    [[ "$k" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    v=${v%\"}; v=${v#\"}; v=${v%\'}; v=${v#\'}
    export "$k=$v"
  done < .env
  for v in CHAIN_ID RPC_URL; do [ -n "${!v:-}" ] && ok "$v set" || bad "$v missing"; done
  for v in DEPLOYER_PRIVATE_KEY EXECUTOR_PRIVATE_KEY DEMO_OWNER_PRIVATE_KEY; do
    val="${!v:-}"
    if [ -z "$val" ]; then warn "$v empty"
    elif printf '%s' "$val" | grep -Eq '^0x[0-9a-fA-F]{64}$'; then ok "$v set (valid shape)"
    else bad "$v set but not 0x + 64 hex"; fi
  done
  [ -n "${LLM_API_KEY:-}" ] && ok "LLM_API_KEY set" || warn "LLM_API_KEY empty (ok until live agent work)"
  [ -n "${LLM_MODEL:-}" ] && ok "LLM_MODEL set" || warn "LLM_MODEL empty"
  if [ "$chain" = 1 ] && [ -n "${RPC_URL:-}" ] && command -v cast >/dev/null 2>&1; then
    cid=$(cast chain-id --rpc-url "$RPC_URL" 2>/dev/null || true)
    if [ -z "$cid" ]; then bad "RPC unreachable"; elif [ "$cid" = "${CHAIN_ID:-}" ]; then ok "RPC chain id matches ($cid)"; else bad "RPC chain id $cid != CHAIN_ID"; fi
  fi
else
  warn ".env not found (copy .env.example to .env)"
fi

echo
[ "$fail" -eq 0 ] && echo "PREFLIGHT OK" || { echo "PREFLIGHT FAILED"; exit 1; }
