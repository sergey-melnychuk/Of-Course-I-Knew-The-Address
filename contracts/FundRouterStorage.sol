// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
/// @title FundRouterStorage (skeleton)
/// @notice Owner-controlled bitmask permissions.
contract FundRouterStorage {
    address public owner;
    mapping(address => uint8) public permissions; // bit0=caller, bit1=treasury
    event OwnershipTransferred(
        address indexed oldOwner,
        address indexed newOwner
    );
    event PermissionsSet(address indexed who, uint8 bits);
    error NotOwner();
    error ZeroAddress();
    constructor(address _owner) {
        if (_owner == address(0)) revert ZeroAddress();
        owner = _owner;
        emit OwnershipTransferred(address(0), _owner);
    }
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function transferOwnership(address _newOwner) external onlyOwner {
        if (_newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, _newOwner);
        owner = _newOwner;
    }
    /// @notice Set permission bits for an address.
    function setPermissions(address who, uint8 bits) external onlyOwner {
        permissions[who] = bits;
        emit PermissionsSet(who, bits);
    }
    function isAllowedCaller(address who) public view returns (bool) {
        return (permissions[who] & 0x01) == 0x01;
    }
    function isAllowedTreasury(address who) public view returns (bool) {
        return (permissions[who] & 0x02) == 0x02;
    }
    function isAllowedCallerAndTreasury(
        address caller,
        address treasury
    ) external view returns (bool) {
        return isAllowedCaller(caller) && isAllowedTreasury(treasury);
    }
}
