#!/usr/bin/env bash
# Read-only: match the Sepolia creation transactions to bytecode compiled from
# this repository. Two deployments are covered:
#   * deployments/11155111.json       - the current (browser-driven) deployment,
#     all seven contracts compiled with the default via-IR profile;
#   * deployments/11155111-run1.json - the first deployment, whose six simulator
#     contracts were compiled with the pinned sepolia_simulator_20261021 profile.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.foundry/bin:$PATH"
RPC_URL="${RPC_URL:-https://sepolia.drpc.org}"

for command in cast forge jq; do command -v "$command" >/dev/null || { echo "missing $command" >&2; exit 1; }; done
[ "$(cast chain-id --rpc-url "$RPC_URL")" = 11155111 ] || { echo 'RPC is not Ethereum Sepolia' >&2; exit 1; }

creation_code() { (cd "$ROOT/contracts" && FOUNDRY_PROFILE="$1" forge inspect "$2" bytecode) | tr -d '\n'; }

# verify_deployment <deployment> <simulator profile> <evidence> <tag> <7 receipt labels>
verify_deployment() {
  local deployment="$1" simulator_profile="$2" evidence="$3" tag="$4"
  shift 4
  local labels=("$@")
  [ -f "$deployment" ] || { echo "missing $deployment" >&2; exit 1; }
  [ -f "$evidence" ] || { echo "missing $evidence" >&2; exit 1; }

  local contract_address creation_hash
  contract_address() { jq -r --arg name "$1" '.contracts[$name]' "$deployment"; }
  creation_hash() { jq -r --arg label "$1" '.receipts[] | select(.label == $label) | .txHash' "$evidence"; }

  local token_code oracle_code lending_code swap_code vault_code
  token_code="$(creation_code "$simulator_profile" MockERC20)"
  oracle_code="$(creation_code "$simulator_profile" MockOracle)"
  lending_code="$(creation_code "$simulator_profile" LendingSim)"
  swap_code="$(creation_code "$simulator_profile" MockSwap)"
  vault_code="$(creation_code default MandateVault)"

  local usdc weth wsteth oracle owner executor
  usdc="$(contract_address mUSDC)"
  weth="$(contract_address mWETH)"
  wsteth="$(contract_address mWSTETH)"
  oracle="$(contract_address oracle)"
  owner="$(jq -r '.owner' "$deployment")"
  executor="$(jq -r '.executor' "$deployment")"

  local verify_creation
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
    echo "$tag $label: exact creation input and successful on-chain receipt ($hash)"
  }

  verify_creation "${labels[0]}" "$usdc" "$token_code" "$(cast abi-encode 'constructor(string,string,uint8)' 'Mock USD Coin' 'mUSDC' 6)"
  verify_creation "${labels[1]}" "$weth" "$token_code" "$(cast abi-encode 'constructor(string,string,uint8)' 'Mock Wrapped Ether' 'mWETH' 18)"
  verify_creation "${labels[2]}" "$wsteth" "$token_code" "$(cast abi-encode 'constructor(string,string,uint8)' 'Mock Wrapped stETH' 'mWSTETH' 18)"
  verify_creation "${labels[3]}" "$oracle" "$oracle_code" '0x'
  verify_creation "${labels[4]}" "$(contract_address lending)" "$lending_code" "$(cast abi-encode 'constructor(address)' "$oracle")"
  verify_creation "${labels[5]}" "$(contract_address swap)" "$swap_code" "$(cast abi-encode 'constructor(address)' "$oracle")"
  verify_creation "${labels[6]}" "$(contract_address vault)" "$vault_code" "$(cast abi-encode 'constructor(address,address,address,address)' "$owner" "$executor" "$oracle" "$usdc")"
}

verify_deployment "$ROOT/deployments/11155111.json" default \
  "$ROOT/evidence/sepolia-ui-e2e-20261021.json" '[current]' \
  deploy_mUSDC deploy_mWETH deploy_mWSTETH deploy_oracle deploy_lending deploy_swap deploy_vault

verify_deployment "$ROOT/deployments/11155111-run1.json" sepolia_simulator_20261021 \
  "$ROOT/evidence/sepolia-e2e-20261021.json" '[run1]' \
  token_usdc_deploy token_weth_deploy token_wsteth_deploy oracle_deploy lending_deploy swap_deploy vault_deploy

echo 'Sepolia bytecode and creation receipts for both deployments: VERIFIED'
