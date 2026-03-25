// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

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

// ─── FreedomForge Yield Agent ─────────────────────────────────────────────────

/**
 * @title FreedomForgeYieldAgent
 * @notice Autonomous yield optimizer integrating ERC-8004 agent identity/reputation,
 *         Pendle PT fixed-rate yield, and Theoriq AlphaSwarm delegation.
 *         Security cages enforce maximum drawdown and access control per DASF/MAESTRO.
 */
contract FreedomForgeYieldAgent is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── ERC-8004 Registries (immutable — mainnet addresses) ──────────────────
    IIdentityRegistry public constant IDENTITY_REGISTRY =
        IIdentityRegistry(0x8004A169FB4a3325136EB29fA0ceB6D2e539a432);
    IReputationRegistry public constant REPUTATION_REGISTRY =
        IReputationRegistry(0x8004BAa17C55a88189AE136b182e5fdA19dE9b63);

    // ─── State ────────────────────────────────────────────────────────────────
    uint256 public agentId;
    address public immutable OWNER;
    IVaultShareToken public immutable vaultShareToken;
    IPendleRouter public pendleRouter;

    // ─── Security Policy Cages (DASF/MAESTRO) ────────────────────────────────
    uint256 public constant MAX_DRAWDOWN_BPS = 500;        // 5% max drawdown
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MIN_DEPOSIT = 0.01 ether;
    uint256 public constant MAX_SINGLE_ALLOCATION_BPS = 2_000; // 20% per market

    uint256 public totalDeposited;
    uint256 public highWaterMark;                           // for drawdown tracking
    mapping(address => bool) public authorizedSwarmRoles;  // Theoriq AlphaSwarm

    // ─── Active Pendle Positions ──────────────────────────────────────────────
    struct PendlePosition {
        address market;
        address ptToken;
        uint256 ptAmount;
        uint256 depositedUnderlying;
        uint256 entryTimestamp;
        uint256 expiry;
        bool active;
    }
    mapping(bytes32 => PendlePosition) public positions; // key: keccak256(market)
    bytes32[] public positionKeys;

    // ─── Events ───────────────────────────────────────────────────────────────
    event Deposited(address indexed user, uint256 amount, uint256 sharesIssued);
    event Withdrawn(address indexed user, uint256 shares, uint256 amountOut);
    event Rebalanced(
        string strategySummary,
        uint256 realizedApyBps,
        string pendleMarket,
        uint256 ptAmount
    );
    event FeedbackSubmitted(uint256 agentId, string tag1, int128 value);
    event SwarmSignal(string role, string message, address caller);
    event SwarmRoleUpdated(address indexed role, bool authorized);
    event DrawdownGuardTriggered(uint256 currentValueBps, uint256 maxAllowedBps);

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == OWNER, "FFA: not owner");
        _;
    }

    modifier onlyAuthorizedSwarm() {
        require(
            msg.sender == OWNER || authorizedSwarmRoles[msg.sender],
            "FFA: unauthorized swarm role"
        );
        _;
    }

    modifier drawdownGuard() {
        _;
        // Post-execution check: revert if drawdown exceeds policy cage
        if (totalDeposited > 0 && highWaterMark > 0) {
            uint256 currentValue = address(this).balance + _estimatePositionValue();
            if (currentValue < highWaterMark) {
                uint256 drawdownBps = ((highWaterMark - currentValue) * BPS_DENOMINATOR) / highWaterMark;
                if (drawdownBps > MAX_DRAWDOWN_BPS) {
                    emit DrawdownGuardTriggered(drawdownBps, MAX_DRAWDOWN_BPS);
                    revert("FFA: max drawdown exceeded");
                }
            }
        }
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address _vaultShareToken, address _pendleRouter) {
        OWNER = msg.sender;
        vaultShareToken = IVaultShareToken(_vaultShareToken);
        pendleRouter = IPendleRouter(_pendleRouter);
    }

    // ─── ERC-8004 Identity ────────────────────────────────────────────────────

    /**
     * @notice Register this agent on-chain with ERC-8004 identity.
     *         agentURI should include MCP/A2A endpoints + Pendle capabilities.
     *         Call once after deployment.
     */
    function registerAgent(string calldata agentURI) external onlyOwner returns (uint256) {
        require(agentId == 0, "FFA: already registered");
        agentId = IDENTITY_REGISTRY.register(agentURI);
        return agentId;
    }

    // ─── Deposits & Withdrawals ───────────────────────────────────────────────

    /**
     * @notice Deposit ETH into the yield vault. Issues proportional vault shares.
     */
    function deposit() external payable nonReentrant {
        require(msg.value >= MIN_DEPOSIT, "FFA: below minimum deposit");

        uint256 sharesToMint;
        uint256 supply = vaultShareToken.totalSupply();
        uint256 vaultValue = address(this).balance - msg.value + _estimatePositionValue();

        if (supply == 0 || vaultValue == 0) {
            // First deposit: 1:1 shares to wei
            sharesToMint = msg.value;
        } else {
            // Proportional: shares = deposit * totalSupply / vaultValue
            sharesToMint = (msg.value * supply) / vaultValue;
        }

        totalDeposited += msg.value;

        // Update high water mark
        uint256 newValue = address(this).balance + _estimatePositionValue();
        if (newValue > highWaterMark) {
            highWaterMark = newValue;
        }

        vaultShareToken.mint(msg.sender, sharesToMint);
        emit Deposited(msg.sender, msg.value, sharesToMint);
    }

    /**
     * @notice Redeem vault shares for proportional ETH.
     */
    function withdraw(uint256 shares) external nonReentrant {
        require(shares > 0, "FFA: zero shares");
        uint256 supply = vaultShareToken.totalSupply();
        require(supply > 0, "FFA: no supply");

        uint256 vaultValue = address(this).balance + _estimatePositionValue();
        uint256 ethOut = (shares * vaultValue) / supply;
        require(ethOut > 0, "FFA: zero out");
        require(address(this).balance >= ethOut, "FFA: insufficient liquidity (positions active)");

        vaultShareToken.burn(msg.sender, shares);
        if (totalDeposited >= ethOut) totalDeposited -= ethOut;

        (bool sent, ) = msg.sender.call{value: ethOut}("");
        require(sent, "FFA: ETH transfer failed");

        emit Withdrawn(msg.sender, shares, ethOut);
    }

    // ─── Pendle PT Yield Operations ───────────────────────────────────────────

    /**
     * @notice Allocate ETH into a Pendle PT fixed-rate market.
     * @param market      Pendle market address
     * @param ptToken     Pendle PT token address for this market
     * @param ethAmount   ETH to allocate (must be <= MAX_SINGLE_ALLOCATION_BPS of vault)
     * @param minPtOut    Minimum PT tokens to receive (slippage protection)
     * @param strategySummary Human-readable strategy label for the reputation feed
     */
    function allocateToPendlePT(
        address market,
        address ptToken,
        uint256 ethAmount,
        uint256 minPtOut,
        string calldata strategySummary
    ) external onlyAuthorizedSwarm drawdownGuard nonReentrant {
        require(ethAmount > 0, "FFA: zero amount");
        require(address(this).balance >= ethAmount, "FFA: insufficient ETH");

        // Enforce single-market allocation cap
        uint256 vaultValue = address(this).balance + _estimatePositionValue();
        require(
            ethAmount * BPS_DENOMINATOR <= vaultValue * MAX_SINGLE_ALLOCATION_BPS,
            "FFA: allocation exceeds single-market cap"
        );

        uint256 expiry = IPendlePtToken(ptToken).expiry();
        require(expiry > block.timestamp, "FFA: PT already expired");

        // Call Pendle router to swap ETH for PT
        // Note: actual Pendle router call params depend on the specific market version.
        // Using placeholder guessPtOut and limit — integrate Pendle SDK offchain for real values.
        (uint256 netPtOut, , ) = pendleRouter.swapExactTokenForPt{value: ethAmount}(
            address(this),
            market,
            minPtOut,
            bytes(""),  // guessPtOut — computed offchain via Pendle SDK
            bytes(""),  // input
            bytes("")   // limit
        );

        bytes32 key = keccak256(abi.encodePacked(market));
        if (!positions[key].active) {
            positionKeys.push(key);
        }
        positions[key] = PendlePosition({
            market: market,
            ptToken: ptToken,
            ptAmount: netPtOut,
            depositedUnderlying: ethAmount,
            entryTimestamp: block.timestamp,
            expiry: expiry,
            active: true
        });

        emit Rebalanced(strategySummary, 0, addressToString(market), netPtOut);
    }

    /**
     * @notice Redeem a matured Pendle PT position back to ETH.
     *         Submits ERC-8004 reputation feedback with realized APY.
     */
    function redeemPendlePT(
        address market,
        address ytToken,
        string calldata feedbackEndpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external onlyAuthorizedSwarm nonReentrant {
        bytes32 key = keccak256(abi.encodePacked(market));
        PendlePosition storage pos = positions[key];
        require(pos.active, "FFA: no active position");
        require(block.timestamp >= pos.expiry, "FFA: PT not yet matured");

        uint256 ptBalance = IPendlePtToken(pos.ptToken).balanceOf(address(this));
        require(ptBalance > 0, "FFA: no PT balance");

        IPendlePtToken(pos.ptToken).approve(address(pendleRouter), ptBalance);

        uint256 ethBefore = address(this).balance;
        pendleRouter.redeemPyToToken(address(this), ytToken, ptBalance, bytes(""));
        uint256 ethAfter = address(this).balance;

        uint256 ethReceived = ethAfter - ethBefore;
        uint256 realizedApyBps = _computeApyBps(
            pos.depositedUnderlying,
            ethReceived,
            pos.entryTimestamp,
            block.timestamp
        );

        // Submit ERC-8004 reputation feedback
        if (agentId > 0) {
            int128 reputationScore = int128(int256(realizedApyBps > 0 ? realizedApyBps : 0));
            REPUTATION_REGISTRY.giveFeedback(
                agentId,
                reputationScore,
                2,                      // valueDecimals (bps = 2)
                "pendle-pt-fixed",
                "freedomforge-yield",
                feedbackEndpoint,
                feedbackURI,
                feedbackHash
            );
            emit FeedbackSubmitted(agentId, "pendle-pt-fixed", reputationScore);
        }

        pos.active = false;

        // Update high water mark
        uint256 newValue = address(this).balance + _estimatePositionValue();
        if (newValue > highWaterMark) highWaterMark = newValue;

        emit Rebalanced(
            "pendle-pt-matured",
            realizedApyBps,
            addressToString(market),
            0
        );
    }

    // ─── Theoriq AlphaSwarm Integration ──────────────────────────────────────

    /**
     * @notice Process a signal from an authorized Theoriq AlphaSwarm agent.
     *         Signals are advisory — execution requires a separate authorized call.
     */
    function receiveSwarmSignal(
        string calldata role,
        string calldata message
    ) external onlyAuthorizedSwarm {
        emit SwarmSignal(role, message, msg.sender);
    }

    /**
     * @notice Grant or revoke Theoriq swarm agent authorization.
     */
    function setSwarmRole(address agent, bool authorized) external onlyOwner {
        authorizedSwarmRoles[agent] = authorized;
        emit SwarmRoleUpdated(agent, authorized);
    }

    // ─── Owner Administration ─────────────────────────────────────────────────

    function updatePendleRouter(address newRouter) external onlyOwner {
        require(newRouter != address(0), "FFA: zero address");
        pendleRouter = IPendleRouter(newRouter);
    }

    /**
     * @notice Emergency withdrawal of ETH by owner (bypasses drawdown guard).
     *         For use only in case of critical vulnerability.
     */
    function emergencyWithdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "FFA: nothing to withdraw");
        (bool sent, ) = OWNER.call{value: balance}("");
        require(sent, "FFA: transfer failed");
    }

    // ─── View Functions ───────────────────────────────────────────────────────

    function getVaultStats() external view returns (
        uint256 ethBalance,
        uint256 positionValue,
        uint256 totalValue,
        uint256 shareSupply,
        uint256 sharePrice,      // wei per share (18 dec)
        uint256 activePositions,
        uint256 hwm,
        uint256 drawdownBps
    ) {
        ethBalance = address(this).balance;
        positionValue = _estimatePositionValue();
        totalValue = ethBalance + positionValue;
        shareSupply = vaultShareToken.totalSupply();
        sharePrice = shareSupply > 0 ? (totalValue * 1e18) / shareSupply : 1e18;

        uint256 count;
        for (uint256 i = 0; i < positionKeys.length; i++) {
            if (positions[positionKeys[i]].active) count++;
        }
        activePositions = count;
        hwm = highWaterMark;
        drawdownBps = (highWaterMark > totalValue && highWaterMark > 0)
            ? ((highWaterMark - totalValue) * BPS_DENOMINATOR) / highWaterMark
            : 0;
    }

    function getPosition(address market) external view returns (PendlePosition memory) {
        return positions[keccak256(abi.encodePacked(market))];
    }

    // ─── Internal Helpers ─────────────────────────────────────────────────────

    /**
     * @dev Estimate total PT position value in ETH terms.
     *      Uses deposited underlying as a conservative proxy (PT ≈ underlying at maturity).
     *      A production version should query Pendle's oracle for mark-to-market value.
     */
    function _estimatePositionValue() internal view returns (uint256 total) {
        for (uint256 i = 0; i < positionKeys.length; i++) {
            PendlePosition storage pos = positions[positionKeys[i]];
            if (pos.active) {
                total += pos.depositedUnderlying;
            }
        }
    }

    /**
     * @dev Compute annualized APY in basis points from a yield event.
     */
    function _computeApyBps(
        uint256 deposited,
        uint256 received,
        uint256 startTs,
        uint256 endTs
    ) internal pure returns (uint256) {
        if (deposited == 0 || endTs <= startTs) return 0;
        uint256 yield_ = received > deposited ? received - deposited : 0;
        uint256 elapsed = endTs - startTs;
        // APY bps = (yield / deposited) * (365 days / elapsed) * 10000
        return (yield_ * 365 days * BPS_DENOMINATOR) / (deposited * elapsed);
    }

    /**
     * @dev Convert address to hex string for event emission.
     */
    function addressToString(address addr) internal pure returns (string memory) {
        bytes memory data = abi.encodePacked(addr);
        bytes memory alphabet = "0123456789abcdef";
        bytes memory str = new bytes(42);
        str[0] = "0"; str[1] = "x";
        for (uint256 i = 0; i < 20; i++) {
            str[2 + i * 2] = alphabet[uint8(data[i] >> 4)];
            str[3 + i * 2] = alphabet[uint8(data[i] & 0x0f)];
        }
        return string(str);
    }

    receive() external payable {}
}
