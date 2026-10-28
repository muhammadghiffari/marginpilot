#!/usr/bin/env bash
# Drive the real web console in headless Chromium against a throwaway anvil chain (31338).
#
#   bash scripts/browser-e2e.sh
#
# Deploys the simulator to a fresh anvil, starts the agent in anvil mode with anvil's public
# test keys, builds the web bundle, then runs apps/web/test/browser_testnet.py. Requires
# `python3 -m pip install playwright` and its Chromium. Local only: uses anvil test keys.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.foundry/bin:$PATH"
for tool in anvil cast jq curl python3; do command -v "$tool" >/dev/null || { echo "browser-e2e: $tool not found" >&2; exit 1; }; done

CHAIN_ID=31338
ANVIL_PORT="${ANVIL_PORT:-8548}"
AGENT_PORT="${AGENT_PORT:-8798}"
RPC_URL="http://127.0.0.1:${ANVIL_PORT}"
EXPLORER="https://explorer.test.invalid"   # fixture only: proves links are built from explorerBase
ARTIFACTS="${ARTIFACTS:-$ROOT/.playwright-artifacts}"
TMP="$(mktemp -d)"
# One run at a time: both modes share these ports and the deployments/31338.json file.
exec 9>"${TMPDIR:-/tmp}/marginpilot-browser-e2e.lock"
flock -n 9 || { echo "browser-e2e: another run holds the lock" >&2; exit 1; }
for port in "$ANVIL_PORT" "$AGENT_PORT"; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then echo "browser-e2e: port $port is already in use" >&2; exit 1; fi
done
ABI_BACKUP="$TMP/abi"; cp -r "$ROOT/packages/core/src/abi" "$ABI_BACKUP"
DEPLOYMENT="$ROOT/deployments/${CHAIN_ID}.json"
FIXTURE="$ROOT/eval/fixtures/testnet-${CHAIN_ID}.json"
BACKUP=""; [ -f "$DEPLOYMENT" ] && { BACKUP="$TMP/deployment.json"; cp "$DEPLOYMENT" "$BACKUP"; }
ANVIL_PID=""; AGENT_PID=""

OWNER_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
EXECUTOR_KEY="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
OWNER="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
EXECUTOR="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"

cleanup() {
  status=$?
  [ -n "$AGENT_PID" ] && { kill -- "-$AGENT_PID" 2>/dev/null || kill "$AGENT_PID" 2>/dev/null || true; }
  [ -n "$ANVIL_PID" ] && kill "$ANVIL_PID" 2>/dev/null || true
  if [ -n "$BACKUP" ]; then cp "$BACKUP" "$DEPLOYMENT"; else rm -f "$DEPLOYMENT"; fi
  rm -f "$FIXTURE"
  # deploy.sh regenerates the ABI exports; never leave tracked files modified.
  rm -rf "$ROOT/packages/core/src/abi" && cp -r "$ABI_BACKUP" "$ROOT/packages/core/src/abi"
  if [ "$status" -ne 0 ]; then
    echo "browser-e2e: FAILED (exit ${status}); logs in ${TMP}" >&2
    [ -f "$TMP/agent.log" ] && tail -20 "$TMP/agent.log" >&2 || true
  else rm -rf "$TMP"; fi
}
trap cleanup EXIT

anvil --chain-id "$CHAIN_ID" --port "$ANVIL_PORT" --silent >"$TMP/anvil.log" 2>&1 &
ANVIL_PID=$!
for _ in $(seq 1 50); do cast chain-id --rpc-url "$RPC_URL" >/dev/null 2>&1 && break; sleep 0.2; done
[ "$(cast chain-id --rpc-url "$RPC_URL")" = "$CHAIN_ID" ] || { echo "browser-e2e: anvil did not start" >&2; exit 1; }

(cd "$ROOT" && CHAIN_ID="$CHAIN_ID" RPC_URL="$RPC_URL" SENDER="$OWNER" OWNER_ADDRESS="$OWNER" \
  EXECUTOR_ADDRESS="$EXECUTOR" EXPLORER_BASE_URL="$EXPLORER" EXTRA_FORGE_ARGS="--unlocked" \
  bash scripts/deploy.sh) >"$TMP/deploy.log" 2>&1 || { tail -20 "$TMP/deploy.log" >&2; exit 1; }

(cd "$ROOT/apps/web" && ./node_modules/.bin/vite build >/dev/null)

(cd "$ROOT/apps/agent" && exec setsid env CHAIN_MODE=anvil CHAIN_ID="$CHAIN_ID" RPC_URL="$RPC_URL" PORT="$AGENT_PORT" \
  DEMO_MODE=true ALLOW_DEMO_CONTROLS=true DEMO_OWNER_PRIVATE_KEY="$OWNER_KEY" \
  EXECUTOR_PRIVATE_KEY="$EXECUTOR_KEY" ./node_modules/.bin/tsx src/server.ts) >"$TMP/agent.log" 2>&1 &
AGENT_PID=$!
for _ in $(seq 1 600); do curl -fsS "http://127.0.0.1:${AGENT_PORT}/api/state" >/dev/null 2>&1 && break; sleep 0.2; done
curl -fsS "http://127.0.0.1:${AGENT_PORT}/api/state" >/dev/null || { echo "browser-e2e: agent did not start" >&2; exit 1; }

if [ "${SERVE_ONLY:-0}" = "1" ]; then
  echo "browser-e2e: serving http://127.0.0.1:${AGENT_PORT} (Ctrl-C to stop)"; wait "$AGENT_PID"; exit 0
fi
python3 "$ROOT/apps/web/test/browser_testnet.py" --base-url "http://127.0.0.1:${AGENT_PORT}" \
  --artifacts "$ARTIFACTS" --explorer "$EXPLORER" --label ANVIL

# Guarded market reset: positions return to the baseline health factors and the vault is unpaused.
BASE="http://127.0.0.1:${AGENT_PORT}"
curl -fsS -X POST "$BASE/api/demo/reset" -H 'content-type: application/json' -d '{}' | jq -e '(.txHashes | length) >= 3' >/dev/null
curl -fsS "$BASE/api/state" | jq -e '[.positions[].healthFactor | tonumber] | all(. > 1000000000000000000 * 1.04)' >/dev/null \
  || { echo "browser-e2e: reset did not restore baseline health factors" >&2; exit 1; }
# The bundle must not contain key-shaped values.
bash "$ROOT/scripts/check-bundle.sh" "$ROOT/apps/web/dist"
echo "browser-e2e: PASS (UI rescue, guarded reset, bundle scan)"
