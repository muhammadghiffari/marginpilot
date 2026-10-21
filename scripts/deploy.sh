#!/usr/bin/env bash
# A-07: deploy + seed the demo market on anvil, patch deployment metadata, export ABIs.
# OWNER_ACCOUNT/EXECUTOR_ACCOUNT set -> sign with the owner Foundry keystore on any chain,
# including 31337 (no --unlocked). Otherwise chain 31337 uses anvil's unlocked account 0.
# Other chains without accounts: set SENDER and pass a signer via EXTRA_FORGE_ARGS.
# Fixture: chain 31337 -> eval/fixtures/base.json; other chains -> eval/fixtures/testnet-<chainId>.json.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
EXTRA_FORGE_ARGS="${EXTRA_FORGE_ARGS:-}"
BASE_FIXTURE="$ROOT/eval/fixtures/base.json"
FIXTURE="$BASE_FIXTURE"
FIXTURE_SNAPSHOT=""
CHAIN_ID=""
cleanup() {
  if [ -n "$FIXTURE_SNAPSHOT" ]; then
    # Restore the committed 31337 fixture on any exit, including a failed
    # non-local deploy that wrote part-way through. A 31337 deploy updates it.
    if [ "${CHAIN_ID:-}" != "31337" ]; then
      cp "$FIXTURE_SNAPSHOT" "$BASE_FIXTURE" 2>/dev/null || true
    fi
    rm -f "$FIXTURE_SNAPSHOT"
  fi
}
trap cleanup EXIT
# The committed fixture describes the canonical local chain (31337). A testnet
# or throwaway-chain deploy writes its own eval/fixtures/testnet-<chainId>.json
# and must never overwrite it.
if [ -f "$BASE_FIXTURE" ]; then
  FIXTURE_SNAPSHOT="$(mktemp)"
  cp "$BASE_FIXTURE" "$FIXTURE_SNAPSHOT"
fi

fail() { echo "deploy: $*" >&2; exit 1; }
command -v forge >/dev/null || fail "forge not found"
command -v cast >/dev/null || fail "cast not found"
command -v jq >/dev/null || fail "jq not found"

CHAIN_ID="${CHAIN_ID:-$(cast chain-id --rpc-url "$RPC_URL" 2>/dev/null)}" || fail "no chain at $RPC_URL (run scripts/dev-anvil.sh)"
[ "$(cast chain-id --rpc-url "$RPC_URL")" = "$CHAIN_ID" ] || fail "RPC chain id does not match CHAIN_ID=$CHAIN_ID"

if [ -n "${OWNER_ACCOUNT:-}" ] || [ -n "${EXECUTOR_ACCOUNT:-}" ]; then
  [ -n "${OWNER_ACCOUNT:-}" ] && [ -n "${EXECUTOR_ACCOUNT:-}" ] \
    || fail "set both OWNER_ACCOUNT and EXECUTOR_ACCOUNT (Foundry keystore names), or neither"
  case " ${EXTRA_FORGE_ARGS:-} " in
    *" --account "* | *" --account="*) fail "OWNER_ACCOUNT is set; drop --account from EXTRA_FORGE_ARGS" ;;
  esac
  OWNER_SIGNER="$(cast wallet address --account "$OWNER_ACCOUNT")"
  EXECUTOR_SIGNER="$(cast wallet address --account "$EXECUTOR_ACCOUNT")"
  if [ -n "${SENDER:-}" ] && [ "${SENDER,,}" != "${OWNER_SIGNER,,}" ]; then
    fail "SENDER $SENDER != OWNER_ACCOUNT address $OWNER_SIGNER"
  fi
  SENDER="$OWNER_SIGNER"
  export OWNER_ADDRESS="${OWNER_ADDRESS:-$SENDER}"
  export EXECUTOR_ADDRESS="${EXECUTOR_ADDRESS:-$EXECUTOR_SIGNER}"
  [ "${OWNER_ADDRESS,,}" = "${SENDER,,}" ] || fail "OWNER_ADDRESS must match OWNER_ACCOUNT"
  [ "${EXECUTOR_ADDRESS,,}" = "${EXECUTOR_SIGNER,,}" ] || fail "EXECUTOR_ADDRESS must match EXECUTOR_ACCOUNT"
  SIGNER_FLAGS=(--sender "$SENDER" --account "$OWNER_ACCOUNT")
elif [ "$CHAIN_ID" = "31337" ]; then
  SENDER="${SENDER:-$(cast rpc eth_accounts --rpc-url "$RPC_URL" | jq -r '.[0]')}"
  [ -n "$SENDER" ] || fail "no unlocked account on anvil"
  SIGNER_FLAGS=(--sender "$SENDER" --unlocked)
  export OWNER_ADDRESS="${OWNER_ADDRESS:-$SENDER}"
  export EXECUTOR_ADDRESS="${EXECUTOR_ADDRESS:-0x70997970C51812dc3A010C7d01b50e0d17dc79C8}"
else
  [ -n "${SENDER:-}" ] || fail "set SENDER for chain $CHAIN_ID (or OWNER_ACCOUNT/EXECUTOR_ACCOUNT)"
  SIGNER_FLAGS=(--sender "$SENDER")
fi

echo "deploy: chain $CHAIN_ID from $SENDER"
cd "$ROOT/contracts"
# shellcheck disable=SC2086
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC_URL" \
  "${SIGNER_FLAGS[@]}" \
  $EXTRA_FORGE_ARGS \
  --broadcast -vv

# Keep eval/fixtures/base.json pinned to the committed local deployment.
if [ "$CHAIN_ID" != "31337" ] && [ -n "$FIXTURE_SNAPSHOT" ]; then
  cp "$FIXTURE_SNAPSHOT" "$FIXTURE"
fi

DEPLOYMENT="$ROOT/deployments/$CHAIN_ID.json"
if [ "$CHAIN_ID" = "31337" ]; then
  FIXTURE="$BASE_FIXTURE"
else
  FIXTURE="$ROOT/eval/fixtures/testnet-$CHAIN_ID.json"
fi
BROADCAST="$ROOT/contracts/broadcast/Deploy.s.sol/$CHAIN_ID/run-latest.json"
[ -s "$DEPLOYMENT" ] || fail "missing $DEPLOYMENT"
[ -s "$FIXTURE" ] || fail "missing $FIXTURE"
jq -e . "$DEPLOYMENT" >/dev/null || fail "invalid deployment json"
jq -e . "$FIXTURE" >/dev/null || fail "invalid fixture json"

# deployedAt: unix seconds -> ISO-8601 (GNU date; WSL/Linux).
deployed_at="$(jq -r .deployedAt "$DEPLOYMENT")"
iso="$(date -u -d "@$deployed_at" +%Y-%m-%dT%H:%M:%SZ)"
vault_addr="$(jq -r .contracts.vault "$DEPLOYMENT")"
vault_tx="$(jq -r --arg addr "$(printf '%s' "$vault_addr" | tr 'A-Z' 'a-z')" \
  '.transactions[] | select((.contractAddress // "") | ascii_downcase == $addr) | .hash' \
  "$BROADCAST" | head -1)"
[ -n "$vault_tx" ] || fail "vault tx not found in $BROADCAST"
vault_block="$(cast to-dec "$(cast receipt "$vault_tx" --rpc-url "$RPC_URL" --json | jq -r .blockNumber)")"
tmp="$(mktemp)"
jq --arg iso "$iso" --argjson block "$vault_block" \
  '.deployedAt = $iso | .blocks.vault = $block' "$DEPLOYMENT" >"$tmp"
mv "$tmp" "$DEPLOYMENT"

mkdir -p "$ROOT/packages/core/src/abi"
for c in MockERC20 MockOracle LendingSim MockSwap MandateVault; do
  forge inspect "$c" abi --json >"$ROOT/packages/core/src/abi/$c.json"
done
[ "$(ls "$ROOT/packages/core/src/abi"/*.json | wc -l)" -eq 5 ] || fail "expected 5 ABI files"
jq -e . "$ROOT"/packages/core/src/abi/*.json >/dev/null || fail "invalid ABI json"

# Ready-state smoke checks (the deploy script also asserts these before broadcast).
lending="$(jq -r .contracts.lending "$DEPLOYMENT")"
usdc="$(jq -r .contracts.mUSDC "$DEPLOYMENT")"
vault="$(jq -r .contracts.vault "$DEPLOYMENT")"
reserve="$(cast call "$vault" "liquidReserveUsd8()(uint256)" --rpc-url "$RPC_URL" | awk '{print $1}')"
[ "$reserve" = "40000000000" ] || fail "liquidReserveUsd8=$reserve, expected 40000000000"

echo "deployment: $DEPLOYMENT"
echo "fixture:    $FIXTURE"
echo "vault:      $vault (block $vault_block)"
echo "pool 0:     $(cast call "$lending" "positionOf(uint8,address)(uint256,uint256)" 0 "$vault" --rpc-url "$RPC_URL" | tr '\n' ' ')"
echo "pool 1:     $(cast call "$lending" "positionOf(uint8,address)(uint256,uint256)" 1 "$vault" --rpc-url "$RPC_URL" | tr '\n' ' ')"
echo "mUSDC:      $(cast call "$usdc" "balanceOf(address)(uint256)" "$vault" --rpc-url "$RPC_URL" | awk '{print $1}') (vault)"
echo "abis:       $ROOT/packages/core/src/abi (5 files)"
