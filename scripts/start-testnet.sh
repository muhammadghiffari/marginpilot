#!/usr/bin/env bash
# Start the agent + web console against the configured chain.
#
#   bash scripts/start-testnet.sh            # CHAIN_MODE=testnet
#   bash scripts/start-testnet.sh anvil      # local anvil deployment
#
# Reads $ENV_FILE (default .env), builds the web bundle once if needed, and never prints secrets.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="${1:-testnet}"
case "$MODE" in anvil|testnet) ;; *) echo "start-testnet: mode must be anvil or testnet" >&2; exit 1;; esac
ENV_FILE="${ENV_FILE:-.env}"
[ -f "$ENV_FILE" ] || { echo "start-testnet: $ENV_FILE is missing (copy .env.example)" >&2; exit 1; }
set -a
# shellcheck disable=SC1091
. "$ENV_FILE"
set +a

CHAIN_ID="${CHAIN_ID:-}"
RPC_URL="${RPC_URL:-}"
[ -n "$CHAIN_ID" ] || { echo "start-testnet: CHAIN_ID is required" >&2; exit 1; }
[ -n "$RPC_URL" ] || { echo "start-testnet: RPC_URL is required" >&2; exit 1; }
case "$CHAIN_ID" in
  1|10|25|56|100|128|137|169|250|324|1284|1285|5000|8217|8453|9001|1101|2222|34443|42161|43114|42220|59144|81457|534352|7777777)
    echo "start-testnet: chain $CHAIN_ID is a mainnet; refused" >&2; exit 1 ;;
  31337|31338)
    if [ "$MODE" = "testnet" ]; then echo "start-testnet: chain $CHAIN_ID is local; use 'bash scripts/start-testnet.sh anvil'" >&2; exit 1; fi ;;
  *)
    if [ "$MODE" = "anvil" ]; then echo "start-testnet: anvil mode requires chain 31337 or 31338" >&2; exit 1; fi ;;
esac
[ -s "$ROOT/deployments/$CHAIN_ID.json" ] || {
  echo "start-testnet: deployments/$CHAIN_ID.json is missing; deploy first" >&2; exit 1
}

export CHAIN_MODE="$MODE"
export CHAIN_ID RPC_URL
export PORT="${PORT:-8787}"
export HOST="${HOST:-127.0.0.1}"

if [ ! -s "$ROOT/apps/web/dist/index.html" ] || [ "${FORCE_BUILD:-0}" = "1" ]; then
  echo "start-testnet: building the web console"
  (cd "$ROOT/apps/web" && ./node_modules/.bin/vite build >/dev/null)
fi

echo "start-testnet: chain $CHAIN_ID ($MODE), listening on http://${HOST}:${PORT}"
echo "start-testnet: owner signing is browser-wallet EIP-712, or a server key from .env that must match the deployment owner"
cd "$ROOT/apps/agent"
exec ./node_modules/.bin/tsx src/server.ts
