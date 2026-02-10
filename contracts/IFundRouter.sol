// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IFundRouter {
    function transferFunds(
        uint256 etherAmount,
        address[] calldata tokens,
        uint256[] calldata amounts,
        address payable treasuryAddress
    ) external;
}
