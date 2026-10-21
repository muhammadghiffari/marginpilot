#!/usr/bin/env bash
# Real adapter end-to-end on a fresh local anvil (chain 31338, so the committed
# 31337 deployment record is left untouched). Uses only anvil's public test
# keys. Prints hashes and writes evidence/anvil-e2e-<timestamp>.json.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.foundry/bin:$PATH"
command -v anvil >/dev/null || { echo "e2e: anvil not found" >&2; exit 1; }
command -v cast >/dev/null || { echo "e2e: cast not found" >&2; exit 1; }
command -v jq >/dev/null || { echo "e2e: jq not found" >&2; exit 1; }
command -v curl >/dev/null || { echo "e2e: curl not found" >&2; exit 1; }

CHAIN_ID=31338
ANVIL_PORT="${ANVIL_PORT:-8547}"
AGENT_PORT="${AGENT_PORT:-8799}"
RPC_URL="http://127.0.0.1:${ANVIL_PORT}"
TMP="$(mktemp -d)"
ANVIL_PID=""
AGENT_PID=""
DEPLOYMENT="$ROOT/deployments/${CHAIN_ID}.json"
DEPLOYMENT_BACKUP=""
if [ -f "$DEPLOYMENT" ]; then
  DEPLOYMENT_BACKUP="$TMP/deployment-backup.json"
  cp "$DEPLOYMENT" "$DEPLOYMENT_BACKUP"
fi

# Anvil accounts 0 and 1. Public, well-known local test keys only.
OWNER_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
EXECUTOR_KEY="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
OWNER="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
EXECUTOR="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"

cleanup() {
  status=$?
  [ -n "$AGENT_PID" ] && kill "$AGENT_PID" 2>/dev/null || true
  [ -n "$ANVIL_PID" ] && kill "$ANVIL_PID" 2>/dev/null || true
  # chain 31338 is a throwaway E2E chain: leave no generated deployment record.
  if [ -n "$DEPLOYMENT_BACKUP" ] && [ -f "$DEPLOYMENT_BACKUP" ]; then
    cp "$DEPLOYMENT_BACKUP" "$DEPLOYMENT"
  else
    rm -f "$DEPLOYMENT"
  fi
  if [ "$status" -ne 0 ]; then
    echo "e2e: FAILED (exit ${status}); logs kept in ${TMP}" >&2
    [ -f "$TMP/deploy.log" ] && tail -30 "$TMP/deploy.log" >&2 || true
    [ -f "$TMP/agent.log" ] && tail -30 "$TMP/agent.log" >&2 || true
  else
    rm -rf "$TMP"
  fi
}
trap cleanup EXIT

json() { jq -r "$1" "$2"; }
api() { curl -fsS "http://127.0.0.1:${AGENT_PORT}$1"; }

echo "e2e: starting anvil on ${RPC_URL} (chain ${CHAIN_ID})"
anvil --chain-id "$CHAIN_ID" --port "$ANVIL_PORT" --silent >"$TMP/anvil.log" 2>&1 &
ANVIL_PID=$!
for _ in $(seq 1 50); do
  cast chain-id --rpc-url "$RPC_URL" >/dev/null 2>&1 && break
  sleep 0.2
done
[ "$(cast chain-id --rpc-url "$RPC_URL")" = "$CHAIN_ID" ] || { echo "e2e: anvil did not start" >&2; exit 1; }

echo "e2e: deploying and seeding the simulator"
(
  cd "$ROOT"
  CHAIN_ID="$CHAIN_ID" RPC_URL="$RPC_URL" SENDER="$OWNER" \
    OWNER_ADDRESS="$OWNER" EXECUTOR_ADDRESS="$EXECUTOR" \
    EXTRA_FORGE_ARGS="--unlocked" bash scripts/deploy.sh
) >"$TMP/deploy.log" 2>&1
[ -s "$DEPLOYMENT" ] || { echo "e2e: deployment record missing" >&2; exit 1; }
VAULT="$(json '.contracts.vault' "$DEPLOYMENT")"
echo "e2e: vault ${VAULT}"

echo "e2e: starting the agent in chain mode"
(
  cd "$ROOT/apps/agent"
  CHAIN_MODE=anvil CHAIN_ID="$CHAIN_ID" RPC_URL="$RPC_URL" PORT="$AGENT_PORT" \
  DEMO_MODE=true ALLOW_DEMO_CONTROLS=true \
  DEMO_OWNER_PRIVATE_KEY="$OWNER_KEY" EXECUTOR_PRIVATE_KEY="$EXECUTOR_KEY" \
  pnpm start
) >"$TMP/agent.log" 2>&1 &
AGENT_PID=$!
for _ in $(seq 1 100); do
  api /api/state >"$TMP/state.json" 2>/dev/null && break
  sleep 0.2
done
[ -s "$TMP/state.json" ] || { cat "$TMP/agent.log" >&2; echo "e2e: agent did not start" >&2; exit 1; }
[ "$(json '.simulated' "$TMP/state.json")" = "false" ] || { echo "e2e: agent is not in chain mode" >&2; exit 1; }
cp "$TMP/state.json" "$TMP/state-before-shock.json"

echo "e2e: shocking the test oracle through the agent owner path"
curl -fsS -X POST "http://127.0.0.1:${AGENT_PORT}/api/demo/shock" \
  -H 'content-type: application/json' \
  -d "{\"token\":\"$(json '.contracts.mWETH' "$DEPLOYMENT")\",\"priceUsd8\":\"160000000000\"}" >"$TMP/shock-weth.json"
curl -fsS -X POST "http://127.0.0.1:${AGENT_PORT}/api/demo/shock" \
  -H 'content-type: application/json' \
  -d "{\"token\":\"$(json '.contracts.mWSTETH' "$DEPLOYMENT")\",\"priceUsd8\":\"184000000000\"}" >"$TMP/shock-wsteth.json"
api /api/state >"$TMP/state-shocked.json"
jq -e '[.positions[] | select((.healthFactor | tonumber) < 1000000000000000000)] | length >= 1' \
  "$TMP/state-shocked.json" >/dev/null \
  || { echo "e2e: shock did not put a position below HF 1.0" >&2; exit 1; }

echo "e2e: refreshing oracle timestamps with the owner CLI"
(
  cd "$ROOT"
  CHAIN_MODE=anvil CHAIN_ID="$CHAIN_ID" RPC_URL="$RPC_URL" \
    DEMO_OWNER_PRIVATE_KEY="$OWNER_KEY" \
    pnpm --filter @marginpilot/agent prices:refresh
)

echo "e2e: compiling and installing the owner-signed mandate"
curl -fsS -X POST "http://127.0.0.1:${AGENT_PORT}/api/mandate/compile" \
  -H 'content-type: application/json' \
  -d '{"text":"Protect my loans. Max $260. Do not touch my ETH. Keep $100 in reserve."}' \
  >"$TMP/draft.json"
jq -n --slurpfile draft "$TMP/draft.json" '{draft:$draft[0],ownerMode:"demo"}' >"$TMP/confirm-request.json"
curl -fsS -X POST "http://127.0.0.1:${AGENT_PORT}/api/mandate/confirm" \
  -H 'content-type: application/json' --data @"$TMP/confirm-request.json" >"$TMP/confirm.json"
[ "$(json '.simulated' "$TMP/confirm.json")" = "false" ] || { echo "e2e: confirm is simulated" >&2; exit 1; }
MANDATE_TX="$(json '.txHash' "$TMP/confirm.json")"

echo "e2e: running the rescue"
curl -fsS -X POST "http://127.0.0.1:${AGENT_PORT}/api/run" \
  -H 'content-type: application/json' -d '{"autoExecute":true}' >"$TMP/run.json"
RUN_ID="$(json '.runId' "$TMP/run.json")"
for _ in $(seq 1 300); do
  api /api/state >"$TMP/state.json"
  STATE="$(json '.runState' "$TMP/state.json")"
  case "$STATE" in COMPLETED|COMPLETED_PARTIAL|HALTED_NEEDS_OWNER|ABORTED) break;; esac
  sleep 0.3
done
case "$STATE" in COMPLETED|COMPLETED_PARTIAL) ;; *) echo "e2e: run ended ${STATE}" >&2; cat "$TMP/agent.log" >&2; exit 1;; esac

jq -e '.ledger | length >= 2' "$TMP/state.json" >/dev/null || { echo "e2e: expected at least two ledger entries" >&2; exit 1; }
jq -e '[.ledger[] | select(.status != "mined")] | length == 0' "$TMP/state.json" >/dev/null \
  || { echo "e2e: a ledger entry was not mined" >&2; exit 1; }

EVENT_TOPIC="$(cast keccak 'ActionExecuted(uint64,uint64,uint8,address,address,uint256,uint256,uint256)')"
jq -r '.ledger[].txHash' "$TMP/state.json" >"$TMP/hashes.txt"
while read -r TX; do
  [ -n "$TX" ] || continue
  STATUS="$(cast receipt "$TX" --rpc-url "$RPC_URL" --json | jq -r '.status')"
  [ "$STATUS" = "0x1" ] || { echo "e2e: tx ${TX} status ${STATUS}" >&2; exit 1; }
  LOGS="$(cast receipt "$TX" --rpc-url "$RPC_URL" --json | jq --arg topic "$EVENT_TOPIC" '[.logs[] | select(.topics[0] == $topic)] | length')"
  [ "$LOGS" -ge 1 ] || { echo "e2e: tx ${TX} has no ActionExecuted event" >&2; exit 1; }
done <"$TMP/hashes.txt"

mkdir -p "$ROOT/evidence"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
EVIDENCE="$ROOT/evidence/anvil-e2e-${STAMP}.json"
jq -n \
  --arg runId "$RUN_ID" \
  --arg mandateTx "$MANDATE_TX" \
  --arg vault "$VAULT" \
  --arg owner "$OWNER" \
  --arg executor "$EXECUTOR" \
  --arg recordedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson chainId "$CHAIN_ID" \
  --slurpfile state "$TMP/state.json" \
  --slurpfile before "$TMP/state-before-shock.json" \
  --slurpfile shocked "$TMP/state-shocked.json" \
  --slurpfile shockWeth "$TMP/shock-weth.json" \
  --slurpfile shockWsteth "$TMP/shock-wsteth.json" \
  '{chainId:$chainId, market:"SIMULATED lending protocol on local anvil", runId:$runId,
    mandateTx:$mandateTx, shockTxs:[$shockWeth[0].txHash, $shockWsteth[0].txHash],
    vault:$vault, owner:$owner, executor:$executor, recordedAt:$recordedAt,
    positionsBeforeShock:$before[0].positions, positionsShocked:$shocked[0].positions,
    positionsAfterRun:$state[0].positions, ledger:$state[0].ledger, mode:$state[0].mode}' >"$EVIDENCE"

echo "e2e: GREEN"
echo "mandate tx: ${MANDATE_TX}"
echo "run:        ${RUN_ID} (${STATE})"
echo "evidence:   ${EVIDENCE}"
jq -r '.ledger[] | "  action \(.actionIndex): \(.status) \(.txHash)"' "$TMP/state.json"
