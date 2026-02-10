// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/Clones.sol";

/// @title DeterministicProxyDeployer
/// @notice Deploys EIP-1167 minimal proxies that delegatecall into a FundRouter
///         implementation, using CREATE2 for deterministic addressing.
contract DeterministicProxyDeployer {
    using Clones for address;

    /// @notice The FundRouter implementation all proxies delegate to.
    address public immutable FUND_ROUTER_ADDRESS;

    constructor(address fundRouter) {
        require(fundRouter != address(0), "router=0");
        FUND_ROUTER_ADDRESS = fundRouter;
    }

    // ---- Internal helpers ----------------------------------------------------

    /// @notice Derives a unique salt per caller to prevent cross-user collisions.
    function _deriveSalt(
        bytes32 userSalt,
        address caller
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(userSalt, caller));
    }

    // ---- Public API ----------------------------------------------------------

    /// @notice Deploy one EIP-1167 proxy per salt, deterministically via CREATE2.
    function deployMultiple(
        bytes32[] calldata salts
    ) external returns (address[] memory addrs) {
        addrs = new address[](salts.length);
        for (uint256 i = 0; i < salts.length; i++) {
            bytes32 salt = _deriveSalt(salts[i], msg.sender);
            addrs[i] = FUND_ROUTER_ADDRESS.cloneDeterministic(salt);
        }
    }

    /// @notice Predict proxy addresses without deploying (CREATE2 pre-computation).
    function calculateDestinationAddresses(
        bytes32[] calldata salts
    ) external view returns (address[] memory out) {
        out = new address[](salts.length);
        for (uint256 i = 0; i < salts.length; i++) {
            bytes32 salt = _deriveSalt(salts[i], msg.sender);
            out[i] = FUND_ROUTER_ADDRESS.predictDeterministicAddress(salt);
        }
    }
}
