// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {MockERC20} from "./MockERC20.sol";
import {MockOracle} from "./MockOracle.sol";

/// @notice Oracle-priced swap with a fixed 30 bps fee; holds its own liquidity (D-002).
contract MockSwap {
    error NotAdmin();
    error SwapBroken();
    error SlippageExceeded();

    uint32 public constant feeBps = 30;

    address public immutable admin;
    MockOracle public immutable oracle;
    bool public broken;

    constructor(address oracle_) {
        admin = msg.sender;
        oracle = MockOracle(oracle_);
    }

    /// @notice Swaps `amountIn` of `tokenIn` for `tokenOut` at oracle prices minus the fee.
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut)
        external
        returns (uint256 amountOut)
    {
        if (broken) revert SwapBroken();

        uint256 amountInUsd8 = _usd8(amountIn, tokenIn);
        uint256 outUsd8 = amountInUsd8 * (10_000 - feeBps) / 10_000;
        amountOut = _fromUsd8(outUsd8, tokenOut);
        if (amountOut < minAmountOut) revert SlippageExceeded();

        MockERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        MockERC20(tokenOut).transfer(msg.sender, amountOut);
    }

    /// @notice Makes `swap` revert (`true`) or restores it. Admin only.
    function setBroken(bool broken_) external {
        if (msg.sender != admin) revert NotAdmin();
        broken = broken_;
    }

    function _usd8(uint256 amount, address token) private view returns (uint256) {
        (uint256 priceUsd8,) = oracle.getPrice(token);
        return amount * priceUsd8 / 10 ** uint256(MockERC20(token).decimals());
    }

    function _fromUsd8(uint256 usd8, address token) private view returns (uint256) {
        (uint256 priceUsd8,) = oracle.getPrice(token);
        return usd8 * 10 ** uint256(MockERC20(token).decimals()) / priceUsd8;
    }
}
