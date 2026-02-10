// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "./IFundRouter.sol";

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

/// @title FundRouter (skeleton)
/// @notice Pull ETH held by a proxy and forward it (and optional ERC20s) to a treasury.
/// @dev Key checks and a couple of mechanics are TODOs for the candidate.
contract FundRouter is IFundRouter {
    error NotAuthorizedCaller();
    error TreasuryNotAllowed();
    error LengthMismatch();
    error EthSendFailed();
    error ZeroTreasury();
    /// @dev External storage contract with allowlists.
    address public immutable STORAGE;
    constructor(address storageContract) {
        require(storageContract != address(0), "storage=0");
        STORAGE = storageContract;
    }
    /// @dev Minimal interface to the storage contract.
    function _isAllowedCaller(address a) internal view returns (bool ok) {
        // TODO: call FundRouterStorage.isAllowedCaller(a)
        // hint: (bool s, bytes memory r) = STORAGE.staticcall(abi.encodeWithSignature("isAllowedCaller(address)", a));
        // then decode (bool).
        // For now, pretend false to force candidate to implement.
        ok = false;
    }
    function _isAllowedTreasury(address a) internal view returns (bool ok) {
        // TODO: call FundRouterStorage.isAllowedTreasury(a) and return result.
        ok = false;
    }
    /// @inheritdoc IFundRouter
    function transferFunds(
        uint256 etherAmount,
        address[] calldata tokens,
        uint256[] calldata amounts,
        address payable treasuryAddress
    ) external override {
        if (treasuryAddress == address(0)) revert ZeroTreasury();
        // TODO: enforce that msg.sender is an allowed caller
        if (!_isAllowedCaller(msg.sender)) revert NotAuthorizedCaller();
        // TODO: enforce that treasury is allowed
        if (!_isAllowedTreasury(treasuryAddress)) revert TreasuryNotAllowed();
        if (tokens.length != amounts.length) revert LengthMismatch();
        // ---- ETH routing (from this contract's balance) ----------------------
        // Assumption: ETH has already been sent to this router (e.g., via the proxy's fallback)
        // or msg.sender has ETH and is delegatecalling; keep it simple: just forward from here.
        if (etherAmount > 0) {
            // IMPORTANT: this assumes the ETH is already held here.
            // A minimal proxy that forwards value to this router will land ETH here.
            (bool ok, ) = treasuryAddress.call{value: etherAmount}("");
            if (!ok) revert EthSendFailed();
        }
        // ---- ERC20 routing (optional) ---------------------------------------
        for (uint256 i = 0; i < tokens.length; i++) {
            address token = tokens[i];
            uint256 amt = amounts[i];
            if (amt == 0) continue;
            // TODO: implement ERC20 transfer out.
            // Choices:
            // - If tokens sit here, do IERC20(token).transfer(treasuryAddress, amt).
            // - If tokens sit on msg.sender, you'd need transferFrom and prior approval (not defined on IERC20 above).
            // Keep it simple: assume tokens are already held here.
            // For now we leave as a stub—candidate should implement.
            // e.g. require(IERC20(token).transfer(treasuryAddress,amt), "ERC20 transfer failed");
        }
    }
    // Accept ETH so proxies can push value here.
    receive() external payable {}
}
