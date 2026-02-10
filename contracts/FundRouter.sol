// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IFundRouter.sol";

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);

    function balanceOf(address who) external view returns (uint256);
}

interface IFundRouterStorage {
    function isAllowedCaller(address who) external view returns (bool);

    function isAllowedTreasury(address who) external view returns (bool);
}

/// @title FundRouter
/// @notice Sweep ETH and ERC-20 tokens from a per-client EIP-1167 proxy to an
///         allowed treasury.  Each proxy delegatecalls into this implementation,
///         so `address(this)` is the proxy and balances live there.
contract FundRouter is IFundRouter {
    error NotAuthorizedCaller();
    error TreasuryNotAllowed();
    error LengthMismatch();
    error EthSendFailed();
    error ZeroTreasury();
    error Erc20TransferFailed();

    /// @dev External storage contract that holds caller / treasury allowlists.
    IFundRouterStorage public immutable STORAGE;

    constructor(address storageContract) {
        require(storageContract != address(0), "storage=0");
        STORAGE = IFundRouterStorage(storageContract);
    }

    // ---- Core logic ---------------------------------------------------------

    /// @inheritdoc IFundRouter
    function transferFunds(
        uint256 etherAmount,
        address[] calldata tokens,
        uint256[] calldata amounts,
        address payable treasuryAddress
    ) external override {
        if (treasuryAddress == address(0)) revert ZeroTreasury();
        if (!STORAGE.isAllowedCaller(msg.sender)) revert NotAuthorizedCaller();
        if (!STORAGE.isAllowedTreasury(treasuryAddress))
            revert TreasuryNotAllowed();
        if (tokens.length != amounts.length) revert LengthMismatch();

        // ---- ETH sweep ------------------------------------------------------
        if (etherAmount > 0) {
            (bool ok, ) = treasuryAddress.call{value: etherAmount}("");
            if (!ok) revert EthSendFailed();
        }

        // ---- ERC-20 sweep ---------------------------------------------------
        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 amt = amounts[i];
            if (amt == 0) continue;
            bool ok = IERC20(tokens[i]).transfer(treasuryAddress, amt);
            if (!ok) revert Erc20TransferFailed();
        }
    }

    /// @dev Accept plain ETH transfers (e.g. payments arriving at a proxy).
    receive() external payable {}
}
