#!/usr/bin/env bash
# Deploy the simulator + MandateVault to the configured public testnet.
#
# Safe signer handling: this wrapper refuses `--private-key` (it would leak the
# key into the process list). Import the key into a Foundry keystore once:
#
#   cast wallet import deployer --interactive
#
# then run:
#
#   SENDER=0xYourDeployer EXTRA_FORGE_ARGS="--account deployer" \
#     bash scripts/deploy-testnet.sh
#
# The account prompts for its password inside forge; this script never reads it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -f .env ]; then echo "deploy-testnet: .env is missing (copy .env.example)" >&2; exit 1; fi
set -a
# shellcheck disable=SC1091
. ./.env
set +a
export PATH="$HOME/.foundry/bin:$PATH"

fail() { echo "deploy-testnet: $*" >&2; exit 1; }
command -v forge >/dev/null || fail "forge not found"
command -v cast >/dev/null || fail "cast not found"
command -v jq >/dev/null || fail "jq not found"

CHAIN_ID="${CHAIN_ID:-}"
RPC_URL="${RPC_URL:-}"
[ -n "$CHAIN_ID" ] || fail "CHAIN_ID is required"
[ -n "$RPC_URL" ] || fail "RPC_URL is required"
[ -n "${SENDER:-}" ] || fail "set SENDER to the deployer address (the address, not the key)"
[[ "$SENDER" =~ ^0x[0-9a-fA-F]{40}$ ]] || fail "SENDER is not an address"
[ -n "${EXECUTOR_ADDRESS:-}" ] || fail "EXECUTOR_ADDRESS is required (public executor address)"
[[ "$EXECUTOR_ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]] || fail "EXECUTOR_ADDRESS is not an address"
[ "${SENDER,,}" != "${EXECUTOR_ADDRESS,,}" ] || fail "owner and executor must be different addresses"

case "$CHAIN_ID" in
  *[!0-9]*) fail "CHAIN_ID must be a positive integer" ;;
esac
[ "$CHAIN_ID" -gt 0 ] 2>/dev/null || fail "CHAIN_ID must be a positive integer"
case "$CHAIN_ID" in
  1|10|25|56|100|128|137|169|250|324|1284|1285|5000|8217|8453|9001|1101|2222|34443|42161|43114|42220|59144|81457|534352|7777777)
    fail "chain $CHAIN_ID is a mainnet; only testnets and anvil are allowed" ;;
  31337|31338) fail "chain $CHAIN_ID is local; use scripts/deploy.sh" ;;
esac

if [ -n "${EXPLORER_BASE_URL:-}" ] && [[ ! "$EXPLORER_BASE_URL" =~ ^https?:// ]]; then
  fail "EXPLORER_BASE_URL must start with http:// or https://"
fi

SIGNER_ARGS="${EXTRA_FORGE_ARGS:-}"
case "$SIGNER_ARGS" in
  *--private-key*|*--mnemonic*) fail "refusing key material on the command line; use a Foundry keystore (--account) or a hardware wallet" ;;
  *--rpc-url*|*--fork-url*|*--chain*|*--chain-id*)
    fail "EXTRA_FORGE_ARGS must not override the RPC/chain selected by .env" ;;
  *--account*|*--ledger*|*--trezor*|*--keystore*) ;;
  *) fail "EXTRA_FORGE_ARGS must select a keystore or hardware signer, e.g. --account deployer" ;;
esac

echo "deploy-testnet: checking RPC chain id"
REMOTE_CHAIN="$(cast chain-id --rpc-url "$RPC_URL" 2>/dev/null)" || fail "RPC_URL is unreachable"
[ "$REMOTE_CHAIN" = "$CHAIN_ID" ] || fail "RPC chain id $REMOTE_CHAIN does not match CHAIN_ID $CHAIN_ID"

CODE="$(cast code "$SENDER" --rpc-url "$RPC_URL")"
[ "$CODE" = "0x" ] || fail "SENDER has contract code; use a fresh EOA"
BALANCE="$(cast balance "$SENDER" --rpc-url "$RPC_URL")"
[ "$BALANCE" != "0" ] || fail "SENDER has no native balance for gas"

if [ -n "${OWNER_ADDRESS:-}" ] && [ "${OWNER_ADDRESS,,}" != "${SENDER,,}" ]; then
  echo "deploy-testnet: owner will be $OWNER_ADDRESS (not the deployer)"
else
  export OWNER_ADDRESS="$SENDER"
fi
[[ "$OWNER_ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]] || fail "OWNER_ADDRESS is not an address"
[ "${OWNER_ADDRESS,,}" != "${EXECUTOR_ADDRESS,,}" ] || fail "owner and executor must be different addresses"
[ "$(cast code "$OWNER_ADDRESS" --rpc-url "$RPC_URL")" = "0x" ] \
  || fail "OWNER_ADDRESS must be an EOA; ERC-1271 smart-account signatures are not supported"
[ "$(cast code "$EXECUTOR_ADDRESS" --rpc-url "$RPC_URL")" = "0x" ] \
  || fail "EXECUTOR_ADDRESS must be an EOA hot key"

echo "deploy-testnet: deploying chain $CHAIN_ID (owner $(echo "$OWNER_ADDRESS" | cut -c1-6)…, executor $(echo "$EXECUTOR_ADDRESS" | cut -c1-6)…)"
CHAIN_ID="$CHAIN_ID" RPC_URL="$RPC_URL" SENDER="$SENDER" \
  OWNER_ADDRESS="$OWNER_ADDRESS" EXECUTOR_ADDRESS="$EXECUTOR_ADDRESS" \
  EXTRA_FORGE_ARGS="$SIGNER_ARGS" EXPLORER_BASE_URL="${EXPLORER_BASE_URL:-}" \
  bash scripts/deploy.sh

DEPLOYMENT="$ROOT/deployments/$CHAIN_ID.json"
[ -s "$DEPLOYMENT" ] || fail "deployment record missing after deploy"
echo "deploy-testnet: deployment written to deployments/$CHAIN_ID.json"
echo "deploy-testnet: vault $(jq -r .contracts.vault "$DEPLOYMENT")"
echo "deploy-testnet: next steps:"
echo "  1. CHAIN_MODE=testnet pnpm --filter @marginpilot/agent prices:refresh   # fresh oracle timestamps"
echo "  2. bash scripts/start-testnet.sh                      # CHAIN_MODE=testnet is set by the script"
echo "  3. set ALLOW_DEMO_CONTROLS=true in .env only if the simulator demo needs shock/pause buttons"
