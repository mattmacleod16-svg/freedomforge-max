// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  CompanyLauncher — FreedomForge OnchainStockForge
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  Deploys tokenized company shares as ERC-20 tokens on any EVM chain.
 *
 *  Flow:
 *    1. Founder calls launchCompany() with name, ticker, share count, price.
 *    2. Contract deploys a new CompanyShareToken (ERC-20) and registers it.
 *    3. All shares are minted to the founder.
 *    4. CompanyLaunched event is emitted.
 *
 *  Security:
 *    - One company per ticker symbol (duplicate protection)
 *    - Minimum share price enforced (anti-dust)
 *    - ReentrancyGuard on state-mutating functions
 *    - Owner can pause launches in emergencies
 */

// ─── Minimal OpenZeppelin interfaces (self-contained) ─────────────────────────

abstract contract Context {
    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }
}

interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
}

abstract contract Ownable is Context {
    address private _owner;
    error OwnableUnauthorizedAccount(address account);
    error OwnableInvalidOwner(address owner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert OwnableInvalidOwner(address(0));
        _owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    modifier onlyOwner() {
        if (_msgSender() != _owner) revert OwnableUnauthorizedAccount(_msgSender());
        _;
    }

    function owner() public view returns (address) { return _owner; }

    function transferOwnership(address newOwner) public onlyOwner {
        if (newOwner == address(0)) revert OwnableInvalidOwner(address(0));
        emit OwnershipTransferred(_owner, newOwner);
        _owner = newOwner;
    }
}

abstract contract ReentrancyGuard {
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED     = 2;
    uint256 private _status = NOT_ENTERED;

    error ReentrantCall();
    modifier nonReentrant() {
        if (_status == ENTERED) revert ReentrantCall();
        _status = ENTERED;
        _;
        _status = NOT_ENTERED;
    }
}

// ─── CompanyShareToken — minimal ERC-20 ──────────────────────────────────────

contract CompanyShareToken is Context, IERC20 {
    string  public name;
    string  public symbol;
    uint8   public constant decimals = 0; // shares are whole units
    uint256 private _totalSupply;
    address public founder;

    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;

    constructor(
        string memory _name,
        string memory _symbol,
        uint256 totalShares,
        address _founder
    ) {
        name     = _name;
        symbol   = _symbol;
        founder  = _founder;
        _mint(_founder, totalShares);
    }

    function totalSupply() external view override returns (uint256) { return _totalSupply; }
    function balanceOf(address account) external view override returns (uint256) { return _balances[account]; }

    function transfer(address to, uint256 amount) external override returns (bool) {
        _transfer(_msgSender(), to, amount);
        return true;
    }

    function allowance(address owner_, address spender) external view override returns (uint256) {
        return _allowances[owner_][spender];
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        _allowances[_msgSender()][spender] = amount;
        emit Approval(_msgSender(), spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        uint256 allowed = _allowances[from][_msgSender()];
        require(allowed >= amount, "CompanyShareToken: insufficient allowance");
        _allowances[from][_msgSender()] = allowed - amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "CompanyShareToken: transfer to zero address");
        require(_balances[from] >= amount, "CompanyShareToken: insufficient balance");
        _balances[from] -= amount;
        _balances[to]   += amount;
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        _totalSupply    += amount;
        _balances[to]   += amount;
        emit Transfer(address(0), to, amount);
    }
}

// ─── CompanyLauncher ──────────────────────────────────────────────────────────

contract CompanyLauncher is Ownable, ReentrancyGuard {

    // ── Storage ──────────────────────────────────────────────────────────────

    struct Company {
        string  companyName;
        string  ticker;
        uint256 totalShares;
        uint256 pricePerShareWei;
        address owner;
        uint256 launchedAt;
    }

    /// token address → Company
    mapping(address => Company) private _companies;

    /// ticker (uppercase) → token address (duplicate protection)
    mapping(string => address) private _tickerToToken;

    /// all launched token addresses
    address[] private _allTokens;

    bool public paused;

    uint256 public constant MIN_PRICE_WEI   = 1_000;       // 0.000001 gwei minimum
    uint256 public constant MAX_SHARES      = 10_000_000_000; // 10 billion shares max

    // ── Events ────────────────────────────────────────────────────────────────

    event CompanyLaunched(
        address indexed tokenAddress,
        address indexed founder,
        string companyName,
        string ticker,
        uint256 totalShares,
        uint256 pricePerShareWei
    );

    event LaunchPaused(bool paused);

    // ── Errors ────────────────────────────────────────────────────────────────

    error TickerAlreadyTaken(string ticker);
    error PriceTooLow(uint256 provided, uint256 minimum);
    error SharesOutOfRange(uint256 provided, uint256 maximum);
    error LaunchesPaused();
    error CompanyNotFound(address tokenAddress);

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor() Ownable(msg.sender) {}

    // ── Core functions ────────────────────────────────────────────────────────

    /**
     * Launch a new tokenized company.
     * All shares are minted to msg.sender (founder).
     *
     * @param companyName     Human-readable company name
     * @param ticker          Short uppercase symbol (e.g. "ACME")
     * @param totalShares     Number of shares to mint
     * @param pricePerShareWei Indicative price in wei (informational, not enforced on-chain)
     * @return tokenAddress   Address of the newly deployed CompanyShareToken
     */
    function launchCompany(
        string  calldata companyName,
        string  calldata ticker,
        uint256 totalShares,
        uint256 pricePerShareWei
    ) external nonReentrant returns (address tokenAddress) {
        if (paused) revert LaunchesPaused();

        if (_tickerToToken[ticker] != address(0)) revert TickerAlreadyTaken(ticker);
        if (pricePerShareWei < MIN_PRICE_WEI)     revert PriceTooLow(pricePerShareWei, MIN_PRICE_WEI);
        if (totalShares == 0 || totalShares > MAX_SHARES) revert SharesOutOfRange(totalShares, MAX_SHARES);

        // Deploy share token
        CompanyShareToken token = new CompanyShareToken(
            companyName,
            ticker,
            totalShares,
            msg.sender
        );
        tokenAddress = address(token);

        // Register
        _companies[tokenAddress] = Company({
            companyName:      companyName,
            ticker:           ticker,
            totalShares:      totalShares,
            pricePerShareWei: pricePerShareWei,
            owner:            msg.sender,
            launchedAt:       block.timestamp
        });

        _tickerToToken[ticker] = tokenAddress;
        _allTokens.push(tokenAddress);

        emit CompanyLaunched(tokenAddress, msg.sender, companyName, ticker, totalShares, pricePerShareWei);
    }

    // ── View functions ────────────────────────────────────────────────────────

    function getCompany(address tokenAddress)
        external
        view
        returns (
            string  memory companyName,
            string  memory ticker,
            uint256 totalShares,
            uint256 pricePerShareWei,
            address companyOwner,
            uint256 launchedAt
        )
    {
        Company storage c = _companies[tokenAddress];
        if (c.launchedAt == 0) revert CompanyNotFound(tokenAddress);
        return (c.companyName, c.ticker, c.totalShares, c.pricePerShareWei, c.owner, c.launchedAt);
    }

    function getTokenByTicker(string calldata ticker) external view returns (address) {
        return _tickerToToken[ticker];
    }

    function getAllTokens() external view returns (address[] memory) {
        return _allTokens;
    }

    function totalCompanies() external view returns (uint256) {
        return _allTokens.length;
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit LaunchPaused(_paused);
    }
}
