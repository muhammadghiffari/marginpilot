// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Admin-controlled price feed for the simulated lending market (D-002).
contract MockOracle {
    error NotAdmin();
    error UnknownToken(address token);

    struct Price {
        uint256 priceUsd8;
        uint256 updatedAt;
        bool exists;
    }

    address public immutable admin;
    mapping(address => Price) private _prices;

    event PriceSet(address indexed token, uint256 priceUsd8, uint256 updatedAt);

    constructor() {
        admin = msg.sender;
    }

    /// @notice Sets `token`'s price and stamps it with the current block timestamp.
    function setPrice(address token, uint256 priceUsd8) external {
        _setPrice(token, priceUsd8, block.timestamp);
    }

    /// @notice Sets `token`'s price with an explicit timestamp (stale-price scenarios).
    function setPriceAt(address token, uint256 priceUsd8, uint256 updatedAt) external {
        _setPrice(token, priceUsd8, updatedAt);
    }

    /// @notice Returns the last price for `token`; reverts if it was never set.
    function getPrice(address token) external view returns (uint256 priceUsd8, uint256 updatedAt) {
        Price storage p = _prices[token];
        if (!p.exists) revert UnknownToken(token);
        return (p.priceUsd8, p.updatedAt);
    }

    function _setPrice(address token, uint256 priceUsd8, uint256 updatedAt) private {
        if (msg.sender != admin) revert NotAdmin();
        _prices[token] = Price({priceUsd8: priceUsd8, updatedAt: updatedAt, exists: true});
        emit PriceSet(token, priceUsd8, updatedAt);
    }
}
