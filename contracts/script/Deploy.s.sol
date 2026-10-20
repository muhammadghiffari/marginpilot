// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {MockOracle} from "../src/MockOracle.sol";
import {LendingSim} from "../src/LendingSim.sol";
import {MockSwap} from "../src/MockSwap.sol";
import {MandateVault} from "../src/MandateVault.sol";

/// @notice A-07: deploys the full demo market, seeds the SCENARIOS base state, writes the
/// deployment record and the base fixture. Never reads or prints a private key.
contract Deploy is Script {
    // SCENARIOS.md base state (pre-shock).
    uint256 private constant USDC_PRICE = 1e8;
    uint256 private constant WETH_PRICE = 2_000e8;
    uint256 private constant WSTETH_PRICE = 2_300e8;
    uint256 private constant SHOCK_WETH_PRICE = 1_600e8;
    uint256 private constant SHOCK_WSTETH_PRICE = 1_840e8;

    uint256 private constant POOL0_COLLATERAL = 1e18;
    uint256 private constant POOL0_DEBT = 1_400e6;
    uint256 private constant POOL1_COLLATERAL = 2e18;
    uint256 private constant POOL1_DEBT = 2_800e6;
    uint256 private constant VAULT_RESERVE = 400e6;
    uint256 private constant VAULT_LOCKED_WETH = 0.5e18;

    uint256 private constant SWAP_USDC_LIQUIDITY = 10_000e6;
    uint256 private constant SWAP_WETH_LIQUIDITY = 10e18;
    uint256 private constant SWAP_WSTETH_LIQUIDITY = 10e18;

    // Anvil account 1. Local only; any other chain must set EXECUTOR_ADDRESS.
    address private constant ANVIL_EXECUTOR = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;

    struct Deployment {
        MockERC20 usdc;
        MockERC20 weth;
        MockERC20 wsteth;
        MockOracle oracle;
        LendingSim lending;
        MockSwap swap;
        MandateVault vault;
        address deployer;
        address owner;
        address executor;
        uint256 timestamp;
    }

    function run() external {
        Deployment memory d;
        d.deployer = msg.sender;
        d.owner = vm.envOr("OWNER_ADDRESS", d.deployer);
        d.executor = _executor();
        d.timestamp = block.timestamp;

        vm.startBroadcast();
        _deploy(d);
        _seed(d);
        vm.stopBroadcast();

        _assertBaseState(d);
        _writeDeployment(d);
        _writeFixture(d);

        console2.log("chainId", block.chainid);
        console2.log("mUSDC", address(d.usdc));
        console2.log("mWETH", address(d.weth));
        console2.log("mWSTETH", address(d.wsteth));
        console2.log("oracle", address(d.oracle));
        console2.log("lending", address(d.lending));
        console2.log("swap", address(d.swap));
        console2.log("vault", address(d.vault));
    }

    function _executor() private view returns (address) {
        address configured = vm.envOr("EXECUTOR_ADDRESS", address(0));
        if (configured != address(0)) return configured;
        if (block.chainid != 31337) revert("EXECUTOR_ADDRESS required outside chain 31337");
        return ANVIL_EXECUTOR;
    }

    function _deploy(Deployment memory d) private {
        d.usdc = new MockERC20("Mock USD Coin", "mUSDC", 6);
        d.weth = new MockERC20("Mock Wrapped Ether", "mWETH", 18);
        d.wsteth = new MockERC20("Mock Wrapped stETH", "mWSTETH", 18);
        d.oracle = new MockOracle();
        d.lending = new LendingSim(address(d.oracle));
        d.swap = new MockSwap(address(d.oracle));
        d.vault = new MandateVault(d.owner, d.executor, address(d.oracle), address(d.usdc));
    }

    function _seed(Deployment memory d) private {
        d.lending.setPool(0, address(d.weth), address(d.usdc), 8_250, 500, 5_000);
        d.lending.setPool(1, address(d.wsteth), address(d.usdc), 8_000, 700, 5_000);

        d.oracle.setPrice(address(d.usdc), USDC_PRICE);
        d.oracle.setPrice(address(d.weth), WETH_PRICE);
        d.oracle.setPrice(address(d.wsteth), WSTETH_PRICE);

        d.usdc.mint(address(d.vault), VAULT_RESERVE);
        d.weth.mint(address(d.vault), VAULT_LOCKED_WETH);

        d.usdc.mint(address(d.swap), SWAP_USDC_LIQUIDITY);
        d.weth.mint(address(d.swap), SWAP_WETH_LIQUIDITY);
        d.wsteth.mint(address(d.swap), SWAP_WSTETH_LIQUIDITY);

        // The simulator needs the collateral it will pay out on liquidation.
        d.usdc.mint(address(d.lending), SWAP_USDC_LIQUIDITY);
        d.weth.mint(address(d.lending), POOL0_COLLATERAL);
        d.wsteth.mint(address(d.lending), POOL1_COLLATERAL);

        d.lending.seedPosition(0, address(d.vault), POOL0_COLLATERAL, POOL0_DEBT);
        d.lending.seedPosition(1, address(d.vault), POOL1_COLLATERAL, POOL1_DEBT);
    }

    function _assertBaseState(Deployment memory d) private view {
        (uint256 collateral0, uint256 debt0) = d.lending.positionOf(0, address(d.vault));
        (uint256 collateral1, uint256 debt1) = d.lending.positionOf(1, address(d.vault));
        require(collateral0 == POOL0_COLLATERAL && debt0 == POOL0_DEBT, "seed pool 0");
        require(collateral1 == POOL1_COLLATERAL && debt1 == POOL1_DEBT, "seed pool 1");
        require(d.usdc.balanceOf(address(d.vault)) == VAULT_RESERVE, "vault reserve");
        require(d.weth.balanceOf(address(d.vault)) == VAULT_LOCKED_WETH, "vault locked weth");
        require(d.lending.healthFactor(0, address(d.vault)) > 1e18, "pool 0 healthy pre-shock");
        require(d.lending.healthFactor(1, address(d.vault)) > 1e18, "pool 1 healthy pre-shock");

        (uint256 usdcPrice, uint256 usdcUpdatedAt) = d.oracle.getPrice(address(d.usdc));
        (uint256 wethPrice, uint256 wethUpdatedAt) = d.oracle.getPrice(address(d.weth));
        (uint256 wstethPrice, uint256 wstethUpdatedAt) = d.oracle.getPrice(address(d.wsteth));
        require(usdcPrice == USDC_PRICE && usdcUpdatedAt == block.timestamp, "usdc price");
        require(wethPrice == WETH_PRICE && wethUpdatedAt == block.timestamp, "weth price");
        require(wstethPrice == WSTETH_PRICE && wstethUpdatedAt == block.timestamp, "wsteth price");
    }

    function _writeDeployment(Deployment memory d) private {
        string memory path = string.concat("../deployments/", vm.toString(block.chainid), ".json");
        string memory identity = string.concat(
            '{"chainId":',
            vm.toString(block.chainid),
            ',"deployedAt":',
            vm.toString(d.timestamp), // deploy.sh converts to ISO-8601
            ',"deployer":"',
            vm.toString(d.deployer),
            '","owner":"',
            vm.toString(d.owner),
            '","executor":"',
            vm.toString(d.executor),
            '"'
        );
        string memory body = string.concat(
            ',"contracts":',
            _contractsJson(d),
            ',"blocks":{"vault":0},"explorerBase":"',
            vm.envOr("EXPLORER_BASE_URL", string("")),
            '"}'
        );
        string memory json = string.concat(identity, body);
        vm.writeFile(path, json);
        require(vm.parseJsonUint(vm.readFile(path), ".chainId") == block.chainid, "invalid deployment json");
    }

    function _writeFixture(Deployment memory d) private {
        string memory path = "../eval/fixtures/base.json";
        string memory prices = string.concat(
            _priceJson("mUSDC", address(d.usdc), USDC_PRICE, d.timestamp),
            ",",
            _priceJson("mWETH", address(d.weth), WETH_PRICE, d.timestamp),
            ",",
            _priceJson("mWSTETH", address(d.wsteth), WSTETH_PRICE, d.timestamp)
        );
        string memory positions = string.concat(
            '"pool0":{"collateral":"',
            vm.toString(POOL0_COLLATERAL),
            '","debt":"',
            vm.toString(POOL0_DEBT),
            '"},',
            '"pool1":{"collateral":"',
            vm.toString(POOL1_COLLATERAL),
            '","debt":"',
            vm.toString(POOL1_DEBT),
            '"}'
        );
        string memory shock = string.concat(
            '{"mWETH":"', vm.toString(SHOCK_WETH_PRICE), '","mWSTETH":"', vm.toString(SHOCK_WSTETH_PRICE), '"}'
        );
        string memory head = string.concat(
            '{"chainId":',
            vm.toString(block.chainid),
            ',"blockTimestamp":"',
            vm.toString(d.timestamp),
            '","timestampUnit":"seconds","contracts":',
            _contractsJson(d),
            ',"reserve":"',
            vm.toString(address(d.usdc)),
            '","lockedToken":"',
            vm.toString(address(d.weth)),
            '","prices":{',
            prices,
            "}"
        );
        string memory tail = string.concat(',"positions":{', positions, '},"postShockPrices":', shock, "}");
        string memory json = string.concat(head, tail);
        vm.writeFile(path, json);
        require(vm.parseJsonUint(vm.readFile(path), ".chainId") == block.chainid, "invalid base fixture");
    }

    function _contractsJson(Deployment memory d) private view returns (string memory) {
        return string.concat(
            '{"mUSDC":"',
            vm.toString(address(d.usdc)),
            '","mWETH":"',
            vm.toString(address(d.weth)),
            '","mWSTETH":"',
            vm.toString(address(d.wsteth)),
            '","oracle":"',
            vm.toString(address(d.oracle)),
            '","lending":"',
            vm.toString(address(d.lending)),
            '","swap":"',
            vm.toString(address(d.swap)),
            '","vault":"',
            vm.toString(address(d.vault)),
            '"}'
        );
    }

    function _priceJson(string memory symbol, address token, uint256 priceUsd8, uint256 updatedAt)
        private
        view
        returns (string memory)
    {
        return string.concat(
            '"',
            symbol,
            '":{"token":"',
            vm.toString(token),
            '","priceUsd8":"',
            vm.toString(priceUsd8),
            '","updatedAt":"',
            vm.toString(updatedAt),
            '"}'
        );
    }
}
