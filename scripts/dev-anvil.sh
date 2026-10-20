#!/usr/bin/env bash
# Local chain for development and evaluation. chain id 31337, 1s blocks off (instant mining).
# Uses anvil's public default accounts: LOCAL ONLY, never fund them on a real network.
set -eu
command -v anvil >/dev/null 2>&1 || { echo "anvil not found: install Foundry (foundryup)"; exit 1; }
exec anvil --host 127.0.0.1 --port 8545 --chain-id 31337 --accounts 10 --balance 10000
