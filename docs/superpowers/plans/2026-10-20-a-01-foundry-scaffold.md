# A-01 Foundry Scaffold + Mock Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working Foundry project in `contracts/` with `MockERC20` and `MockOracle` plus tests for decimals, `setPriceAt`, and unknown-token reverts.

**Architecture:** `forge init --force --no-git` inside the existing `contracts/` tree, keeping the committed `foundry.toml` and removing template files. `forge install foundry-rs/forge-std` supplies the test library. Two small mock contracts, written after their tests.

**Tech Stack:** Solidity 0.8.24, Foundry (`forge` 1.8.5), forge-std (latest at install, pinned in `STATUS.md`).

**Spec:** `docs/spec/CONTRACTS.md` §2.1, §2.2, §4; `docs/spec/REPO-MAP.md` A-01; `tasks/DEV-A.md` A-01.

## Global Constraints

- Solidity `^0.8.24`; `contracts/foundry.toml` is already committed and must not change (restore after init if it does).
- `MockERC20` admin-only `mint`; `MockOracle` admin-only setters and `UnknownToken(token)` on unset tokens.
- Test file is `contracts/test/MockTokens.t.sol` (REPO-MAP name).
- Exact error names from `CONTRACTS.md` §4 are reserved for `MandateVault`; A-01 mock errors are local and must not collide (`NotAdmin`, `UnknownToken` is spec'd).
- Never read `.env`; no secret values in tests or commits.
- Do not commit the owner's pending changes in `docs/` or `scripts/`.

## Review Focus

- `MockERC20.mint` called by a non-admin must revert, not mint (trust boundary).
- `MockOracle.getPrice` on a token never set must revert `UnknownToken(token)`; `setPriceAt` must preserve the caller's timestamp verbatim.
- 6-decimal and 18-decimal tokens must report their decimals unchanged (the A-04 valuation test depends on this).
- `transferFrom` must decrement allowance and reject over-allowance (the vault's approve/reset path depends on it).

---

### Task 1: Scaffold Foundry + `MockERC20`

**Files:**
- Create: `contracts/src/MockERC20.sol`
- Create: `contracts/test/MockTokens.t.sol`
- Modify: `contracts/foundry.toml` only if init changes it, then restore
- Remove: `contracts/src/Counter.sol`, `contracts/test/Counter.t.sol`, `contracts/script/Counter.s.sol` (if created)
- Dependency: `contracts/lib/forge-std`

**Interfaces:**
- Produces: `MockERC20(string name_, string symbol_, uint8 decimals_)`, `mint(address to, uint256 amount)` (admin only), standard `transfer`, `approve`, `transferFrom`, `balanceOf`, `allowance`, `totalSupply`, `decimals`, `name`, `symbol`, `admin`, `error NotAdmin()`, `error InsufficientBalance()`, `error InsufficientAllowance()`.

- [ ] **Step 1: Init Foundry, keep committed config, remove templates**

Run in `contracts/`: `forge init --force --no-git`, then `git diff contracts/foundry.toml` and `git checkout -- contracts/foundry.toml` if it changed; delete the three Counter files. Run `forge install foundry-rs/forge-std`. If it reports a dirty git state, read the message and fix the stated cause; do not add `--no-git` to the install to bypass it.

- [ ] **Step 2: Write the failing tests** in `contracts/test/MockTokens.t.sol`

```solidity
function test_MockERC20_Decimals() public {
    assertEq(usdc.decimals(), 6);
    assertEq(weth.decimals(), 18);
}
function test_MockERC20_MintAdminOnly() public {
    usdc.mint(alice, 100e6);
    assertEq(usdc.balanceOf(alice), 100e6);
    assertEq(usdc.totalSupply(), 100e6);
    vm.prank(alice);
    vm.expectRevert(MockERC20.NotAdmin.selector);
    usdc.mint(alice, 1);
}
function test_MockERC20_TransferFromSpendsAllowance() public {
    usdc.mint(alice, 10e6);
    vm.prank(alice); usdc.approve(bob, 4e6);
    vm.prank(bob); usdc.transferFrom(alice, bob, 4e6);
    assertEq(usdc.balanceOf(bob), 4e6);
    assertEq(usdc.allowance(alice, bob), 0);
    vm.prank(bob);
    vm.expectRevert(MockERC20.InsufficientAllowance.selector);
    usdc.transferFrom(alice, bob, 1);
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd contracts && forge test --match-contract MockTokens -vv`
Expected: build failure — `MockERC20` / `MockTokens` not found (or Counter test only if the file is not yet compiling).

- [ ] **Step 4: Implement `contracts/src/MockERC20.sol`**

Constructor sets `name`, `symbol`, `decimals`, `admin = msg.sender`. `mint` reverts `NotAdmin` unless `msg.sender == admin`. `transfer` reverts `InsufficientBalance`; `approve` sets allowance; `transferFrom` reverts `InsufficientAllowance` when allowance is short, decrements it, then moves funds. Emit `Transfer` / `Approval`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd contracts && forge test --match-contract MockTokens -vv`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add contracts docs/superpowers/plans/2026-10-20-a-01-foundry-scaffold.md
git commit -m "feat(contracts): scaffold foundry and add MockERC20"
```

### Task 2: `MockOracle`

**Files:**
- Create: `contracts/src/MockOracle.sol`
- Modify: `contracts/test/MockTokens.t.sol`

**Interfaces:**
- Consumes: `MockERC20` from Task 1 (test tokens only).
- Produces: `MockOracle()`, `setPrice(address token, uint256 priceUsd8)`, `setPriceAt(address token, uint256 priceUsd8, uint256 updatedAt)`, `getPrice(address token) returns (uint256 priceUsd8, uint256 updatedAt)`, `error UnknownToken(address token)`, `error NotAdmin()`, `admin`.

- [ ] **Step 1: Write the failing tests** in `contracts/test/MockTokens.t.sol`

```solidity
function test_MockOracle_SetPriceUsesNow() public {
    vm.warp(1_700_000_000);
    oracle.setPrice(address(weth), 2000e8);
    (uint256 price, uint256 updatedAt) = oracle.getPrice(address(weth));
    assertEq(price, 2000e8);
    assertEq(updatedAt, 1_700_000_000);
}
function test_MockOracle_SetPriceAtKeepsTimestamp() public {
    oracle.setPriceAt(address(weth), 2300e8, 1_600_000_000);
    (uint256 price, uint256 updatedAt) = oracle.getPrice(address(weth));
    assertEq(price, 2300e8);
    assertEq(updatedAt, 1_600_000_000);
}
function test_MockOracle_UnknownToken() public {
    vm.expectRevert(abi.encodeWithSelector(MockOracle.UnknownToken.selector, address(wsteth)));
    oracle.getPrice(address(wsteth));
}
function test_MockOracle_AdminOnly() public {
    vm.prank(alice);
    vm.expectRevert(MockOracle.NotAdmin.selector);
    oracle.setPrice(address(weth), 1e8);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd contracts && forge test --match-contract MockTokens -vv`
Expected: build failure — `MockOracle` not found.

- [ ] **Step 3: Implement `contracts/src/MockOracle.sol`**

`admin = msg.sender` in the constructor. Store `{priceUsd8, updatedAt, exists}` per token. `setPrice` delegates to `setPriceAt(token, priceUsd8, block.timestamp)`. Both revert `NotAdmin` for non-admin. `getPrice` reverts `UnknownToken(token)` when `!exists`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd contracts && forge test --match-contract MockTokens -vv`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add contracts/src/MockOracle.sol contracts/test/MockTokens.t.sol
git commit -m "feat(contracts): add MockOracle with settable timestamps"
```

### Task 3: A-01 verification, status, commit

**Files:**
- Modify: `STATUS.md` (task state, pinned versions)
- Modify: `contracts/test/README.md` only if it claims the directory is empty

- [ ] **Step 1: Run full verification**

Run: `bash scripts/verify-all.sh`
Expected: `VERIFY-ALL: GREEN`; the contracts step now runs because `MandateVault.sol` is absent — it still skips `forge build/test`. Therefore also run `cd contracts && forge build && forge test -vv` and show it green.

- [ ] **Step 2: Update `STATUS.md`** — A-01 `done` with commit hash, pinned `forge-std` version and `solc 0.8.24`.

- [ ] **Step 3: Commit**

```bash
git add STATUS.md contracts
git commit -m "chore(contracts): complete A-01 scaffold verification"
```
