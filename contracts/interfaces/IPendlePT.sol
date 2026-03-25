// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ─── ERC-8004 Interfaces (deployed on mainnet) ────────────────────────────────

interface IIdentityRegistry {
    function register(string calldata agentURI) external returns (uint256);
}

interface IReputationRegistry {
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external;
}

// ─── Minimal Pendle PT Interface ──────────────────────────────────────────────

interface IPendleRouter {
    function swapExactTokenForPt(
        address receiver,
        address market,
        uint256 minPtOut,
        bytes calldata guessPtOut,
        bytes calldata input,
        bytes calldata limit
    ) external payable returns (uint256 netPtOut, uint256 netSyFee, uint256 netSyInterm);

    function redeemPyToToken(
        address receiver,
        address yt,
        uint256 netPyIn,
        bytes calldata output
    ) external returns (uint256 netTokenOut);
}

interface IPendlePtToken {
    function expiry() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

// ─── Vault Share Token Interface ──────────────────────────────────────────────

interface IVaultShareToken is IERC20 {
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
    function totalSupply() external view returns (uint256);
}
