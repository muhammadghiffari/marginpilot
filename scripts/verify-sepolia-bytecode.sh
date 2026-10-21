#!/usr/bin/env bash
# Read-only: match the seven Sepolia creation transactions to compiled source.
# The simulator contracts and vault used different optimizer settings during
# the recorded deployment; both profiles are pinned in contracts/foundry.toml.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.foundry/bin:$PATH"
RPC_URL="${RPC_URL:-https://sepolia.drpc.org}"
DEPLOYMENT="$ROOT/deployments/11155111.json"
EVIDENCE="$ROOT/evidence/sepolia-e2e-20261021.json"

for command in cast forge jq; do command -v "$command" >/dev/null || { echo "missing $command" >&2; exit 1; }; done
[ "$(cast chain-id --rpc-url "$RPC_URL")" = 11155111 ] || { echo 'RPC is not Ethereum Sepolia' >&2; exit 1; }

contract_address() { jq -r --arg name "$1" '.contracts[$name]' "$DEPLOYMENT"; }
creation_hash() { jq -r --arg label "$1" '.receipts[] | select(.label == $label) | .txHash' "$EVIDENCE"; }
creation_code() { (cd "$ROOT/contracts" && FOUNDRY_PROFILE="$1" forge inspect "$2" bytecode) | tr -d '\n'; }

verify_creation() {
  local label="$1" address="$2" code="$3" args="$4"
  local hash sent receipt deployed onchain_code
  hash="$(creation_hash "$label")"
  [ -n "$hash" ] || { echo "missing receipt for $label" >&2; return 1; }
  sent="$(cast tx "$hash" --rpc-url "$RPC_URL" --json | jq -r '.data.input')"
  receipt="$(cast receipt "$hash" --rpc-url "$RPC_URL" --json)"
  deployed="$(jq -r '.contractAddress' <<< "$receipt")"
  onchain_code="$(cast code "$address" --rpc-url "$RPC_URL")"
  [ "${sent,,}" = "${code,,}${args:2}" ] &&
    [ "$(jq -r '.status' <<< "$receipt")" = '0x1' ] &&
    [ "${deployed,,}" = "${address,,}" ] &&
    [ "$onchain_code" != '0x' ] || { echo "bytecode/receipt mismatch: $label" >&2; return 1; }
  echo "$label: exact creation input and successful on-chain receipt ($hash)"
}

SIMULATOR=sepolia_simulator_20261021
TOKEN_CODE="$(creation_code "$SIMULATOR" MockERC20)"
ORACLE_CODE="$(creation_code "$SIMULATOR" MockOracle)"
LENDING_CODE="$(creation_code "$SIMULATOR" LendingSim)"
SWAP_CODE="$(creation_code "$SIMULATOR" MockSwap)"
VAULT_CODE="$(creation_code default MandateVault)"
USDC="$(contract_address mUSDC)"
WETH="$(contract_address mWETH)"
WSTETH="$(contract_address mWSTETH)"
ORACLE="$(contract_address oracle)"
OWNER="$(jq -r '.owner' "$DEPLOYMENT")"
EXECUTOR="$(jq -r '.executor' "$DEPLOYMENT")"

verify_creation token_usdc_deploy "$USDC" "$TOKEN_CODE" "$(cast abi-encode 'constructor(string,string,uint8)' 'Mock USD Coin' 'mUSDC' 6)"
verify_creation token_weth_deploy "$WETH" "$TOKEN_CODE" "$(cast abi-encode 'constructor(string,string,uint8)' 'Mock Wrapped Ether' 'mWETH' 18)"
verify_creation token_wsteth_deploy "$WSTETH" "$TOKEN_CODE" "$(cast abi-encode 'constructor(string,string,uint8)' 'Mock Wrapped stETH' 'mWSTETH' 18)"
verify_creation oracle_deploy "$ORACLE" "$ORACLE_CODE" '0x'
verify_creation lending_deploy "$(contract_address lending)" "$LENDING_CODE" "$(cast abi-encode 'constructor(address)' "$ORACLE")"
verify_creation swap_deploy "$(contract_address swap)" "$SWAP_CODE" "$(cast abi-encode 'constructor(address)' "$ORACLE")"
verify_creation vault_deploy "$(contract_address vault)" "$VAULT_CODE" "$(cast abi-encode 'constructor(address,address,address,address)' "$OWNER" "$EXECUTOR" "$ORACLE" "$USDC")"

echo 'Sepolia bytecode and seven creation receipts: VERIFIED'
