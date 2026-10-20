#!/usr/bin/env bash
# A-10: testnet execution evidence. Chain-agnostic via RPC_URL / EXPLORER_BASE.
# Local dry-run (chain 31337) uses anvil's unlocked accounts from the deployment record.
# Testnet uses Foundry keystore accounts by NAME; no key value is read or printed.
# Outputs: evidence/testnet-<chainId>.json and evidence/TESTNET-EVIDENCE.md
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
GAS_LIMIT=1000000
EVIDENCE_DIR="$ROOT/evidence"
mkdir -p "$EVIDENCE_DIR"

fail() { echo "testnet-evidence: $*" >&2; exit 1; }
command -v cast >/dev/null || fail "cast not found"
command -v jq >/dev/null || fail "jq not found"

CHAIN_ID="$(cast chain-id --rpc-url "$RPC_URL" 2>/dev/null)" || fail "no chain at RPC_URL (local: run scripts/dev-anvil.sh)"
DEPLOYMENT="$ROOT/deployments/$CHAIN_ID.json"
[ -s "$DEPLOYMENT" ] || fail "missing deployments/$CHAIN_ID.json (run scripts/deploy.sh first)"
jq -e . "$DEPLOYMENT" >/dev/null || fail "invalid deployments/$CHAIN_ID.json"

VAULT="$(jq -r .contracts.vault "$DEPLOYMENT")"
ORACLE="$(jq -r .contracts.oracle "$DEPLOYMENT")"
LENDING="$(jq -r .contracts.lending "$DEPLOYMENT")"
SWAP="$(jq -r .contracts.swap "$DEPLOYMENT")"
USDC="$(jq -r .contracts.mUSDC "$DEPLOYMENT")"
WETH="$(jq -r .contracts.mWETH "$DEPLOYMENT")"
WSTETH="$(jq -r .contracts.mWSTETH "$DEPLOYMENT")"
OWNER="$(jq -r .owner "$DEPLOYMENT")"
EXECUTOR="$(jq -r .executor "$DEPLOYMENT")"
ZERO=0x0000000000000000000000000000000000000000
for v in VAULT ORACLE LENDING SWAP USDC WETH WSTETH OWNER EXECUTOR; do
  val="${!v}"
  [ -n "$val" ] && [ "$val" != "$ZERO" ] || fail "deployment is missing $v"
done

EXPLORER_BASE="${EXPLORER_BASE:-${EXPLORER_BASE_URL:-$(jq -r '.explorerBase // empty' "$DEPLOYMENT")}}"
EXPLORER_BASE="${EXPLORER_BASE%/}"

if [ "$CHAIN_ID" = "31337" ]; then
  ACCOUNTS="$(cast rpc eth_accounts --rpc-url "$RPC_URL")"
  printf '%s' "$ACCOUNTS" | jq -e --arg a "$OWNER" 'map(ascii_downcase) | index($a | ascii_downcase)' >/dev/null \
    || fail "owner $OWNER is not an unlocked anvil account"
  printf '%s' "$ACCOUNTS" | jq -e --arg a "$EXECUTOR" 'map(ascii_downcase) | index($a | ascii_downcase)' >/dev/null \
    || fail "executor $EXECUTOR is not an unlocked anvil account"
  OWNER_FLAGS=(--unlocked --from "$OWNER")
  EXECUTOR_FLAGS=(--unlocked --from "$EXECUTOR")
  LABEL="LOCAL ANVIL (SIMULATED)"
else
  : "${OWNER_ACCOUNT:?set OWNER_ACCOUNT to a Foundry keystore account name}"
  : "${EXECUTOR_ACCOUNT:?set EXECUTOR_ACCOUNT to a Foundry keystore account name}"
  OWNER_SIGNER="$(cast wallet address --account "$OWNER_ACCOUNT")"
  EXECUTOR_SIGNER="$(cast wallet address --account "$EXECUTOR_ACCOUNT")"
  [ "${OWNER_SIGNER,,}" = "${OWNER,,}" ] || fail "OWNER_ACCOUNT address $OWNER_SIGNER != deployment owner $OWNER"
  [ "${EXECUTOR_SIGNER,,}" = "${EXECUTOR,,}" ] || fail "EXECUTOR_ACCOUNT address $EXECUTOR_SIGNER != deployment executor $EXECUTOR"
  OWNER_FLAGS=(--account "$OWNER_ACCOUNT")
  EXECUTOR_FLAGS=(--account "$EXECUTOR_ACCOUNT")
  LABEL="PUBLIC TESTNET"
fi

read_call() {
  local to="$1" sig="$2"; shift 2
  cast call "$to" "$sig" "$@" --json --rpc-url "$RPC_URL" | jq -r '.[0]'
}
read_call2() {
  local to="$1" sig="$2"; shift 2
  cast call "$to" "$sig" "$@" --json --rpc-url "$RPC_URL" | jq -r '.[0], .[1]'
}

ORACLE_ADMIN="$(read_call "$ORACLE" "admin()(address)")"
[ "${ORACLE_ADMIN,,}" = "${OWNER,,}" ] || fail "deployment owner is not the oracle admin ($ORACLE_ADMIN)"

NOW="$(cast block latest --field timestamp --rpc-url "$RPC_URL")"
case "$NOW" in 0x*) NOW="$(cast to-dec "$NOW")" ;; esac
[ -n "$NOW" ] && [ "$NOW" -gt 0 ] || fail "cannot read chain time"
VALID_FROM=$((NOW - 60))
VALID_UNTIL=$((NOW + 86400))
DEADLINE=$((NOW + 7200))
if [ "$NOW" -gt 86401 ]; then STALE_AT=$((NOW - 86401)); else STALE_AT=1; fi

MAX_TOTAL=30000000000
MAX_PER_ACTION=15000000000
MIN_RESERVE=10000000000
MAX_SLIPPAGE=300
MAX_PRICE_AGE=86400
MAX_DEVIATION=500
ALLOWED_ACTIONS=7
ALLOW_BORROW=false

MANDATE_ID="$(read_call "$VAULT" "nextMandateId()(uint64)")"
[ -n "$MANDATE_ID" ] || fail "cannot read nextMandateId"
NONCE_BASE="$(read_call "$VAULT" "actionNonce()(uint64)")"
NONCE="$NONCE_BASE"

nonce_now() { read_call "$VAULT" "actionNonce()(uint64)"; }
spent_now() { read_call "$VAULT" "spentUsd(uint64)(uint128)" "$MANDATE_ID"; }
reserve_usd() { read_call "$VAULT" "liquidReserveUsd8()(uint256)"; }
balance_usdc() { read_call "$USDC" "balanceOf(address)(uint256)" "$VAULT"; }
allowance_to() { read_call "$USDC" "allowance(address,address)(uint256)" "$VAULT" "$1"; }
hf() { read_call "$LENDING" "healthFactor(uint8,address)(uint256)" "$1" "$VAULT"; }
active_id() { read_call "$VAULT" "activeMandateId()(uint64)"; }
is_paused() { read_call "$VAULT" "paused()(bool)"; }
position_of() { read_call2 "$LENDING" "positionOf(uint8,address)(uint256,uint256)" "$1" "$VAULT" | tr '\n' ' '; }
price_of() { read_call2 "$ORACLE" "getPrice(address)(uint256,uint256)" "$1" | tr '\n' ' '; }

snapshot() {
  local p0 p1
  p0="$(position_of 0)"
  p1="$(position_of 1)"
  jq -n \
    --arg actionNonce "$(nonce_now)" \
    --arg spentUsd8 "$(spent_now)" \
    --arg liquidReserveUsd8 "$(reserve_usd)" \
    --arg vaultUsdc "$(balance_usdc)" \
    --arg hf0 "$(hf 0)" --arg hf1 "$(hf 1)" \
    --arg activeMandateId "$(active_id)" \
    --arg paused "$(is_paused)" \
    --arg collateral0 "$(printf '%s' "$p0" | awk '{print $1}')" \
    --arg debt0 "$(printf '%s' "$p0" | awk '{print $2}')" \
    --arg collateral1 "$(printf '%s' "$p1" | awk '{print $1}')" \
    --arg debt1 "$(printf '%s' "$p1" | awk '{print $2}')" \
    '{actionNonce:$actionNonce,spentUsd8:$spentUsd8,liquidReserveUsd8:$liquidReserveUsd8,vaultUsdc:$vaultUsdc,healthFactor0:$hf0,healthFactor1:$hf1,activeMandateId:$activeMandateId,paused:$paused,pool0:{collateral:$collateral0,debt:$debt0},pool1:{collateral:$collateral1,debt:$debt1}}'
}

SET_SIG="setMandate((uint64,uint64,uint64,uint128,uint128,uint128,uint32,uint32,uint32,uint8,bool,address[],address[]))"
EXEC_SIG="execute((uint64,uint64,uint8,address,uint8,address,address,uint256,uint256,uint256,uint64))"
MANDATE_TUPLE="($MANDATE_ID,$VALID_FROM,$VALID_UNTIL,$MAX_TOTAL,$MAX_PER_ACTION,$MIN_RESERVE,$MAX_SLIPPAGE,$MAX_PRICE_AGE,$MAX_DEVIATION,$ALLOWED_ACTIONS,$ALLOW_BORROW,[$LENDING,$SWAP],[$WETH])"

RESERVE_BAL="$(balance_usdc)"
[ "$RESERVE_BAL" -ge 100000000 ] || fail "vault mUSDC balance $RESERVE_BAL < 100 mUSDC; redeploy"
P0_DEBT="$(position_of 0 | awk '{print $2}')"
[ "$P0_DEBT" -ge 100000000 ] || fail "pool 0 debt $P0_DEBT < 100 mUSDC; redeploy"
[ "$(allowance_to "$LENDING")" = "0" ] || fail "vault already has an mUSDC allowance to lending"
[ "$(allowance_to "$SWAP")" = "0" ] || fail "vault already has an mUSDC allowance to swap"

SCENARIOS_JSONL="$(mktemp)"
JSON_TMP="$(mktemp)"
MD_TMP="$(mktemp)"
cleanup() { rm -f "$SCENARIOS_JSONL" "$JSON_TMP" "$MD_TMP"; }
trap cleanup EXIT

SIM_RESULT=""
simulate_expect() {
  local id="$1" expected="$2"; shift 2
  local out rc selector expected_sel value
  set +e
  out="$(cast call "$VAULT" "$@" --from "$EXECUTOR" --rpc-url "$RPC_URL" 2>&1)"
  rc=$?
  set -e
  if [ "$expected" = "accepted" ]; then
    [ "$rc" -eq 0 ] || fail "simulation $id: expected accepted, got: $out"
    value="$(printf '%s' "$out" | awk '{print $1}')"
    case "$value" in 0x*) value="$(cast to-dec "$value")" ;; esac
    SIM_RESULT="accepted (valueUsd8=$value)"
    return 0
  fi
  [ "$rc" -ne 0 ] || fail "simulation $id: expected $expected, but the call succeeded"
  selector="$(printf '%s' "$out" | grep -oE '0x[0-9a-fA-F]{8}' | tail -1 | cut -c1-10 | tr 'A-F' 'a-f' || true)"
  expected_sel="$(cast sig "$expected()" | tr 'A-F' 'a-f')"
  [ "$selector" = "$expected_sel" ] \
    || fail "simulation $id: expected $expected ($expected_sel), got '${selector:-no selector}' from: $out"
  SIM_RESULT="$expected ($selector)"
}

record_tx() {
  local kind="$1" id="$2" action="$3" expected="$4" sim="$5"; shift 5
  local hash receipt status block explorer
  hash="$("$@" | grep -oE '0x[0-9a-fA-F]{64}' | tail -1)"
  case "$hash" in 0x[0-9a-fA-F]*) ;; *) fail "$id: no tx hash (got '$hash')" ;; esac
  receipt="$(cast receipt "$hash" --rpc-url "$RPC_URL" --json)"
  status="$(printf '%s' "$receipt" | jq -r '.status')"
  block="$(printf '%s' "$receipt" | jq -r '.blockNumber')"
  if [ "$expected" = "accepted" ]; then
    [ "$status" = "0x1" ] || fail "$id: expected success, receipt status $status"
  else
    [ "$status" = "0x0" ] || fail "$id: expected revert, receipt status $status"
  fi
  explorer="-"
  [ -n "$EXPLORER_BASE" ] && explorer="$EXPLORER_BASE/tx/$hash"
  jq -nc \
    --arg kind "$kind" --arg id "$id" --arg action "$action" \
    --arg expected "$expected" --arg simulation "$sim" \
    --arg txHash "$hash" --arg receiptStatus "$status" \
    --arg blockNumber "$block" --arg explorer "$explorer" \
    '{kind:$kind,id:$id,action:$action,expected:$expected,simulation:$simulation,txHash:$txHash,receiptStatus:$receiptStatus,blockNumber:$blockNumber,explorer:$explorer}' \
    >>"$SCENARIOS_JSONL"
  printf '%-24s %-22s %s\n' "$id" "$expected" "$hash"
}

send_owner() {
  cast send "$@" --async --rpc-url "$RPC_URL" --gas-limit "$GAS_LIMIT" "${OWNER_FLAGS[@]}"
}
send_executor() {
  cast send "$@" --async --rpc-url "$RPC_URL" --gas-limit "$GAS_LIMIT" "${EXECUTOR_FLAGS[@]}"
}

action_tuple() {
  local action_type="$1" target="$2" pool="$3" token_in="$4" token_out="$5" amount="$6" min_out="$7" quoted="$8"
  printf '(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)' \
    "$MANDATE_ID" "$NONCE" "$action_type" "$target" "$pool" "$token_in" "$token_out" "$amount" "$min_out" "$quoted" "$DEADLINE"
}

assert_clean_allowance() {
  [ "$(allowance_to "$LENDING")" = "0" ] || fail "vault mUSDC allowance to lending is not 0"
  [ "$(allowance_to "$SWAP")" = "0" ] || fail "vault mUSDC allowance to swap is not 0"
}

reject_case() {
  local id="$1" error="$2" desc="$3" action="$4"
  local nonce_before spend_before sim
  nonce_before="$(nonce_now)"
  spend_before="$(spent_now)"
  [ "$NONCE" = "$nonce_before" ] || fail "$id: action nonce $NONCE != chain $nonce_before"
  simulate_expect "$id" "$error" "$EXEC_SIG" "$action"
  sim="$SIM_RESULT"
  record_tx scenario "$id" "$desc" "$error" "$sim" send_executor "$VAULT" "$EXEC_SIG" "$action"
  [ "$(nonce_now)" = "$nonce_before" ] || fail "$id: action nonce changed on a revert"
  [ "$(spent_now)" = "$spend_before" ] || fail "$id: spend changed on a revert"
  assert_clean_allowance
}

echo "chain:      $CHAIN_ID ($LABEL)"
echo "deployment: deployments/$CHAIN_ID.json"
echo "vault:      $VAULT"
echo "owner:      $OWNER"
echo "executor:   $EXECUTOR"
echo "explorer:   ${EXPLORER_BASE:-none (local)}"
echo

BEFORE="$(snapshot)"
record_tx setup SETUP-MANDATE "setMandate(id=$MANDATE_ID)" accepted "not simulated" \
  send_owner "$VAULT" "$SET_SIG" "$MANDATE_TUPLE"
[ "$(active_id)" = "$MANDATE_ID" ] || fail "mandate $MANDATE_ID is not active"
[ "$(spent_now)" = "0" ] || fail "new mandate spend is not zero"

record_tx setup SETUP-SHOCK-WETH "setPrice(mWETH, 160000000000)" accepted "not simulated" \
  send_owner "$ORACLE" "setPrice(address,uint256)" "$WETH" 160000000000
record_tx setup SETUP-SHOCK-WSTETH "setPrice(mWSTETH, 184000000000)" accepted "not simulated" \
  send_owner "$ORACLE" "setPrice(address,uint256)" "$WSTETH" 184000000000
read -r WETH_PRICE _ <<<"$(price_of "$WETH")"
read -r WSTETH_PRICE _ <<<"$(price_of "$WSTETH")"
[ "$WETH_PRICE" = "160000000000" ] || fail "mWETH price $WETH_PRICE != 1600e8"
[ "$WSTETH_PRICE" = "184000000000" ] || fail "mWSTETH price $WSTETH_PRICE != 1840e8"
AFTER_SHOCK="$(snapshot)"
HF0_SHOCK="$(printf '%s' "$AFTER_SHOCK" | jq -r .healthFactor0)"
HF1_SHOCK="$(printf '%s' "$AFTER_SHOCK" | jq -r .healthFactor1)"
[ "$HF0_SHOCK" -lt 1000000000000000000 ] || fail "pool 0 HF $HF0_SHOCK is not below 1 after the shock"

NONCE="$(nonce_now)"
ACTION="$(action_tuple 0 "$LENDING" 0 "$USDC" "$ZERO" 100000000 0 100000000)"
simulate_expect H1-REPAY accepted "$EXEC_SIG" "$ACTION"
SIM_H1="$SIM_RESULT"
record_tx scenario H1-REPAY "REPAY pool 0 100 mUSDC (within caps)" accepted "$SIM_H1" \
  send_executor "$VAULT" "$EXEC_SIG" "$ACTION"
AFTER_H1="$(snapshot)"
[ "$(printf '%s' "$AFTER_H1" | jq -r .actionNonce)" = "$((NONCE + 1))" ] || fail "nonce did not advance"
[ "$(printf '%s' "$AFTER_H1" | jq -r .spentUsd8)" = "10000000000" ] || fail "spentUsd8 != 100e8"
[ "$(printf '%s' "$AFTER_H1" | jq -r .vaultUsdc)" = "300000000" ] || fail "vault mUSDC != 300e6"
[ "$(printf '%s' "$AFTER_H1" | jq -r .pool0.debt)" = "1300000000" ] || fail "pool 0 debt != 1300e6"
[ "$(printf '%s' "$AFTER_H1" | jq -r .healthFactor0)" -gt "$HF0_SHOCK" ] || fail "pool 0 HF did not improve"
assert_clean_allowance

NONCE="$(nonce_now)"
ACTION="$(action_tuple 0 "$LENDING" 0 "$USDC" "$ZERO" 200000000 0 100000000)"
reject_case R1-PER-ACTION PerActionCapExceeded "REPAY pool 0 200 mUSDC (above per-action cap)" "$ACTION"

NONCE="$(nonce_now)"
ACTION="$(action_tuple 3 "$LENDING" 0 "$USDC" "$ZERO" 1000000 0 100000000)"
reject_case R2-BORROW BorrowForbidden "BORROW pool 0 1 mUSDC (allowBorrow=false)" "$ACTION"

NONCE="$(nonce_now)"
ACTION="$(action_tuple 0 "$SWAP" 0 "$USDC" "$ZERO" 1000000 0 100000000)"
reject_case R3-TARGET-ROLE TargetNotAllowed "REPAY at the swap target (wrong role)" "$ACTION"

record_tx setup SETUP-STALE-PRICE "setPriceAt(mUSDC, 1e8, $STALE_AT)" accepted "not simulated" \
  send_owner "$ORACLE" "setPriceAt(address,uint256,uint256)" "$USDC" 100000000 "$STALE_AT"
NONCE="$(nonce_now)"
ACTION="$(action_tuple 0 "$LENDING" 0 "$USDC" "$ZERO" 1000000 0 100000000)"
reject_case R4-STALE-PRICE StalePrice "REPAY pool 0 1 mUSDC (mUSDC price stale)" "$ACTION"
record_tx setup SETUP-FRESH-PRICE "setPrice(mUSDC, 1e8)" accepted "not simulated" \
  send_owner "$ORACLE" "setPrice(address,uint256)" "$USDC" 100000000

record_tx setup SETUP-PAUSE "pause()" accepted "not simulated" send_owner "$VAULT" "pause()"
NONCE="$(nonce_now)"
ACTION="$(action_tuple 0 "$LENDING" 0 "$USDC" "$ZERO" 1000000 0 100000000)"
reject_case R5-PAUSED Paused "REPAY pool 0 1 mUSDC (vault paused)" "$ACTION"
record_tx setup SETUP-UNPAUSE "unpause()" accepted "not simulated" send_owner "$VAULT" "unpause()"

record_tx setup SETUP-REVOKE "revokeMandate()" accepted "not simulated" send_owner "$VAULT" "revokeMandate()"
NONCE="$(nonce_now)"
ACTION="$(action_tuple 0 "$LENDING" 0 "$USDC" "$ZERO" 1000000 0 100000000)"
reject_case R6-MANDATE-INACTIVE MandateInactive "REPAY pool 0 1 mUSDC (mandate revoked)" "$ACTION"

AFTER="$(snapshot)"
[ "$(printf '%s' "$AFTER" | jq -r .activeMandateId)" = "0" ] || fail "mandate still active at the end"
[ "$(printf '%s' "$AFTER" | jq -r .paused)" = "false" ] || fail "vault still paused at the end"
[ "$(printf '%s' "$AFTER" | jq -r .spentUsd8)" = "10000000000" ] || fail "final spend != 100e8"
[ "$(printf '%s' "$AFTER" | jq -r .vaultUsdc)" = "300000000" ] || fail "final vault mUSDC != 300e6"
[ "$(printf '%s' "$AFTER" | jq -r .actionNonce)" = "$((NONCE_BASE + 1))" ] || fail "final nonce != base+1"

SHOCK_JSON="$(jq -n \
  --arg weth "$WETH_PRICE" --arg wsteth "$WSTETH_PRICE" \
  --arg hf0 "$HF0_SHOCK" --arg hf1 "$HF1_SHOCK" \
  '{prices:{mWETH:$weth,mWSTETH:$wsteth},healthFactor0:$hf0,healthFactor1:$hf1}')"
MANDATE_JSON="$(jq -n \
  --arg id "$MANDATE_ID" --arg validFrom "$VALID_FROM" --arg validUntil "$VALID_UNTIL" \
  --arg maxTotal "$MAX_TOTAL" --arg maxPerAction "$MAX_PER_ACTION" --arg minReserve "$MIN_RESERVE" \
  --arg maxSlippage "$MAX_SLIPPAGE" --arg maxPriceAge "$MAX_PRICE_AGE" --arg maxDeviation "$MAX_DEVIATION" \
  --arg allowedActions "$ALLOWED_ACTIONS" --argjson allowBorrow "$ALLOW_BORROW" \
  --arg lending "$LENDING" --arg swap "$SWAP" --arg locked "$WETH" \
  '{id:$id,validFrom:$validFrom,validUntil:$validUntil,maxTotalSpendUsd:$maxTotal,maxPerActionUsd:$maxPerAction,minLiquidReserveUsd:$minReserve,maxSlippageBps:$maxSlippage,maxPriceAgeSec:$maxPriceAge,maxPriceDeviationBps:$maxDeviation,allowedActions:$allowedActions,allowBorrow:$allowBorrow,allowedTargets:[$lending,$swap],lockedTokens:[$locked]}')"
TXS="$(jq -s '.' "$SCENARIOS_JSONL")"
GENERATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

jq -n \
  --argjson chainId "$CHAIN_ID" \
  --arg label "$LABEL" \
  --arg generatedAt "$GENERATED_AT" \
  --arg deployment "deployments/$CHAIN_ID.json" \
  --arg explorerBase "$EXPLORER_BASE" \
  --arg vault "$VAULT" --arg owner "$OWNER" --arg executor "$EXECUTOR" \
  --slurpfile dep "$DEPLOYMENT" \
  --argjson mandate "$MANDATE_JSON" \
  --argjson shock "$SHOCK_JSON" \
  --argjson before "$BEFORE" \
  --argjson after "$AFTER" \
  --argjson transactions "$TXS" \
  '{chainId:$chainId,label:$label,generatedAt:$generatedAt,deployment:$deployment,explorerBase:$explorerBase,vault:$vault,owner:$owner,executor:$executor,contracts:$dep[0].contracts,mandate:$mandate,afterShock:$shock,before:$before,after:$after,transactions:$transactions}' \
  >"$JSON_TMP"
mv "$JSON_TMP" "$EVIDENCE_DIR/testnet-$CHAIN_ID.json"

{
  echo "# Testnet execution evidence"
  echo
  echo "- Chain: \`$CHAIN_ID\` ($LABEL)"
  echo "- Generated: \`$GENERATED_AT\`"
  echo "- Deployment: \`deployments/$CHAIN_ID.json\`"
  echo "- Vault: \`$VAULT\`"
  echo "- Explorer: ${EXPLORER_BASE:-none (local anvil)}"
  echo
  if [ "$CHAIN_ID" = "31337" ]; then
    echo "**This is a LOCAL ANVIL (SIMULATED) dry-run of the testnet evidence script. It is not public-testnet evidence.**"
    echo
  fi
  echo "| Scenario id | Action | Expected error / result | Tx hash | Explorer |"
  echo "|---|---|---|---|---|"
  jq -r '.transactions[] | "| \(.id) | \(.action) | \(.expected) | `\(.txHash)` | \(if .explorer == "-" then "-" else "[link](\(.explorer))" end) |"' \
    "$EVIDENCE_DIR/testnet-$CHAIN_ID.json"
  echo
  echo "Each rejected action has two artifacts: a \`cast call\` simulation that decoded to the expected custom error (with selector in the JSON), and a mined transaction with receipt status \`0x0\`. The accepted action has receipt status \`0x1\`. Setup rows have no simulation."
} >"$MD_TMP"
mv "$MD_TMP" "$EVIDENCE_DIR/TESTNET-EVIDENCE.md"

echo
echo "evidence: $EVIDENCE_DIR/testnet-$CHAIN_ID.json"
echo "table:    $EVIDENCE_DIR/TESTNET-EVIDENCE.md"
echo "local dry-run: no keys read; no RPC URL written"
