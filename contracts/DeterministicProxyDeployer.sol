// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
/// @title DeterministicProxyDeployer (skeleton)
/// @notice Deploys minimal proxies that forward to FUND_ROUTER_ADDRESS via CREATE2.
/// @dev A few pieces are deliberately stubbed with TODOs.
contract DeterministicProxyDeployer {
    /// @dev Replace at deployment time, or make settable in a constructor.
    address public immutable FUND_ROUTER_ADDRESS;
    error Create2Failed();
    error InvalidBytecode();
    constructor(address fundRouter) {
        require(fundRouter != address(0), "router=0");
        FUND_ROUTER_ADDRESS = fundRouter;
    }
    // ---- Bytecode helpers ----------------------------------------------------
    /// @notice Returns the init code used for CREATE2 deployments.
    /// @dev TODO: Candidate must implement this to return a minimal forwarding proxy
    /// whose *runtime* code forwards calls (and ETH) to FUND_ROUTER_ADDRESS.
    /// Hints welcome: EIP-1167 style or custom minimal runtime with CALL.
    function _proxyInitCode() internal view returns (bytes memory) {
        // TODO: return init-code bytes that deploy runtime forwarding to FUND_ROUTER_ADDRESS
        // The original snippet had a hex string with${FUND_ROUTER_ADDRESS} spliced in.
        // For clarity here, either:
        // - build it with abi.encodePacked(prefix, FUND_ROUTER_ADDRESS, suffix), or
        // - implement an EIP-1167 minimal proxy pointing at FUND_ROUTER_ADDRESS.
        // Revert for now so it compiles.
        revert InvalidBytecode();
    }
    /// @notice Per-caller salt derivation to avoid collisions across different users.
    /// @dev Candidates can keep this as-is or modify in place if they justify.
    function _deriveSalt(
        bytes32 userSalt,
        address caller
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(userSalt, caller));
    }
    // ---- Public API ----------------------------------------------------------
    function deployMultiple(
        bytes32[] calldata salts
    ) external returns (address[] memory addrs) {
        bytes memory bytecode = _proxyInitCode();
        addrs = new address[](salts.length);
        for (uint256 i = 0; i < salts.length; i++) {
            bytes32 salt = _deriveSalt(salts[i], msg.sender);
            address addr;
            assembly {
                // create2(value, ptr, size, salt)
                addr := create2(0, add(bytecode, 0x20), mload(bytecode), salt)
            }
            if (addr == address(0)) revert Create2Failed();
            addrs[i] = addr;
        }
    }
    /// @notice Pure address calculation (preview) for a given list of salts.
    /// @dev Uses CREATE2 formula with the same derived salt logic as deployMultiple().
    function calculateDestinationAddresses(
        bytes32[] calldata salts
    ) external view returns (address[] memory out) {
        bytes memory bytecode = _proxyInitCode();
        bytes32 initCodeHash = keccak256(bytecode);
        out = new address[](salts.length);
        for (uint256 i = 0; i < salts.length; i++) {
            bytes32 salt = _deriveSalt(salts[i], msg.sender);
            bytes32 data = keccak256(
                abi.encodePacked(
                    bytes1(0xff),
                    address(this),
                    salt,
                    initCodeHash
                )
            );
            out[i] = address(uint160(uint256(data)));
        }
    }
}
