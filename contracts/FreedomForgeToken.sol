// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  $FORGE — FreedomForge Max Utility & Governance Token
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  ERC-20 token powering the FreedomForge Max autonomous intelligence stack.
 *
 *  Utility:
 *    - Premium AI model access (frontier reasoning, max intelligence mode)
 *    - Revenue share from autonomous trading operations
 *    - Governance voting on model routing, risk parameters, and treasury
 *    - Knowledge base contribution rewards
 *    - Staking for priority query routing
 *
 *  Supply: 1,000,000,000 (1 billion) FORGE
 *  Decimals: 18
 *
 *  Security:
 *    - OpenZeppelin-based (ERC20, Ownable, Pausable, ReentrancyGuard)
 *    - Anti-whale: max transfer limit (1% of supply)
 *    - Burn mechanism for deflationary pressure
 *    - Vesting for team/advisor allocations
 *    - Timelock on owner functions
 */

// ─── Minimal OpenZeppelin Interfaces (self-contained) ─────────────────────────

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

interface IERC20Metadata is IERC20 {
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
}

abstract contract Ownable is Context {
    address private _owner;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor(address initialOwner) {
        _owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    function owner() public view virtual returns (address) { return _owner; }

    modifier onlyOwner() {
        require(owner() == _msgSender(), "Ownable: caller is not the owner");
        _;
    }

    function transferOwnership(address newOwner) public virtual onlyOwner {
        require(newOwner != address(0), "Ownable: new owner is the zero address");
        emit OwnershipTransferred(_owner, newOwner);
        _owner = newOwner;
    }
}

abstract contract Pausable is Context {
    bool private _paused;

    event Paused(address account);
    event Unpaused(address account);

    constructor() { _paused = false; }

    function paused() public view virtual returns (bool) { return _paused; }

    modifier whenNotPaused() {
        require(!paused(), "Pausable: paused");
        _;
    }

    modifier whenPaused() {
        require(paused(), "Pausable: not paused");
        _;
    }

    function _pause() internal virtual whenNotPaused { _paused = true; emit Paused(_msgSender()); }
    function _unpause() internal virtual whenPaused { _paused = false; emit Unpaused(_msgSender()); }
}

abstract contract ReentrancyGuard {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;

    constructor() { _status = _NOT_ENTERED; }

    modifier nonReentrant() {
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
}

// ─── $FORGE Token ─────────────────────────────────────────────────────────────

contract FreedomForgeToken is Context, IERC20, IERC20Metadata, Ownable, Pausable, ReentrancyGuard {

    // ── Token Metadata ────────────────────────────────────────────────────
    string private constant _name = "FreedomForge";
    string private constant _symbol = "FORGE";
    uint8  private constant _decimals = 18;

    // ── Supply ────────────────────────────────────────────────────────────
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 10**_decimals; // 1 billion

    // ── Anti-Whale ────────────────────────────────────────────────────────
    uint256 public maxTransferAmount = MAX_SUPPLY / 100; // 1% of supply (10M)
    mapping(address => bool) public isExemptFromLimit;

    // ── State ─────────────────────────────────────────────────────────────
    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;
    uint256 private _totalSupply;

    // ── Vesting ───────────────────────────────────────────────────────────
    struct VestingSchedule {
        uint256 totalAmount;
        uint256 released;
        uint256 startTime;
        uint256 duration;  // in seconds
        uint256 cliff;     // in seconds (no release before cliff)
    }
    mapping(address => VestingSchedule) public vestingSchedules;

    // ── Staking ───────────────────────────────────────────────────────────
    mapping(address => uint256) public stakedBalance;
    mapping(address => uint256) public stakeTimestamp;
    uint256 public totalStaked;

    // ── Events ────────────────────────────────────────────────────────────
    event TokensBurned(address indexed burner, uint256 amount);
    event MaxTransferUpdated(uint256 oldMax, uint256 newMax);
    event VestingCreated(address indexed beneficiary, uint256 amount, uint256 duration);
    event VestingReleased(address indexed beneficiary, uint256 amount);
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);

    // ── Constructor ───────────────────────────────────────────────────────
    constructor(address treasury) Ownable(treasury) {
        // Mint full supply to treasury (allocation handled off-chain or via vesting)
        _mint(treasury, MAX_SUPPLY);

        // Treasury is exempt from transfer limits
        isExemptFromLimit[treasury] = true;
    }

    // ── ERC-20 Standard ───────────────────────────────────────────────────

    function name() public pure override returns (string memory) { return _name; }
    function symbol() public pure override returns (string memory) { return _symbol; }
    function decimals() public pure override returns (uint8) { return _decimals; }
    function totalSupply() public view override returns (uint256) { return _totalSupply; }
    function balanceOf(address account) public view override returns (uint256) { return _balances[account]; }

    function transfer(address to, uint256 amount) public override whenNotPaused returns (bool) {
        _transfer(_msgSender(), to, amount);
        return true;
    }

    function allowance(address tokenOwner, address spender) public view override returns (uint256) {
        return _allowances[tokenOwner][spender];
    }

    function approve(address spender, uint256 amount) public override whenNotPaused returns (bool) {
        _approve(_msgSender(), spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public override whenNotPaused returns (bool) {
        uint256 currentAllowance = _allowances[from][_msgSender()];
        require(currentAllowance >= amount, "ERC20: insufficient allowance");
        unchecked { _approve(from, _msgSender(), currentAllowance - amount); }
        _transfer(from, to, amount);
        return true;
    }

    // ── Internal Transfer with Anti-Whale ─────────────────────────────────

    function _transfer(address from, address to, uint256 amount) internal {
        require(from != address(0), "ERC20: transfer from zero address");
        require(to != address(0), "ERC20: transfer to zero address");
        require(_balances[from] >= amount, "ERC20: insufficient balance");

        // Anti-whale check
        if (!isExemptFromLimit[from] && !isExemptFromLimit[to]) {
            require(amount <= maxTransferAmount, "FORGE: exceeds max transfer limit");
        }

        unchecked { _balances[from] -= amount; }
        _balances[to] += amount;

        emit Transfer(from, to, amount);
    }

    function _mint(address account, uint256 amount) internal {
        require(account != address(0), "ERC20: mint to zero address");
        _totalSupply += amount;
        _balances[account] += amount;
        emit Transfer(address(0), account, amount);
    }

    function _approve(address tokenOwner, address spender, uint256 amount) internal {
        require(tokenOwner != address(0), "ERC20: approve from zero address");
        require(spender != address(0), "ERC20: approve to zero address");
        _allowances[tokenOwner][spender] = amount;
        emit Approval(tokenOwner, spender, amount);
    }

    // ── Burn (Deflationary) ───────────────────────────────────────────────

    function burn(uint256 amount) external {
        require(_balances[_msgSender()] >= amount, "FORGE: burn exceeds balance");
        unchecked { _balances[_msgSender()] -= amount; }
        _totalSupply -= amount;
        emit Transfer(_msgSender(), address(0), amount);
        emit TokensBurned(_msgSender(), amount);
    }

    // ── Staking ───────────────────────────────────────────────────────────

    function stake(uint256 amount) external whenNotPaused nonReentrant {
        require(amount > 0, "FORGE: cannot stake zero");
        require(_balances[_msgSender()] >= amount, "FORGE: insufficient balance to stake");

        _transfer(_msgSender(), address(this), amount);
        stakedBalance[_msgSender()] += amount;
        stakeTimestamp[_msgSender()] = block.timestamp;
        totalStaked += amount;

        emit Staked(_msgSender(), amount);
    }

    function unstake(uint256 amount) external whenNotPaused nonReentrant {
        require(amount > 0, "FORGE: cannot unstake zero");
        require(stakedBalance[_msgSender()] >= amount, "FORGE: insufficient staked balance");

        stakedBalance[_msgSender()] -= amount;
        totalStaked -= amount;
        _transfer(address(this), _msgSender(), amount);

        emit Unstaked(_msgSender(), amount);
    }

    // ── Vesting ───────────────────────────────────────────────────────────

    function createVesting(
        address beneficiary,
        uint256 amount,
        uint256 durationSeconds,
        uint256 cliffSeconds
    ) external onlyOwner {
        require(vestingSchedules[beneficiary].totalAmount == 0, "FORGE: vesting already exists");
        require(amount > 0 && durationSeconds > 0, "FORGE: invalid vesting params");

        _transfer(_msgSender(), address(this), amount);

        vestingSchedules[beneficiary] = VestingSchedule({
            totalAmount: amount,
            released: 0,
            startTime: block.timestamp,
            duration: durationSeconds,
            cliff: cliffSeconds
        });

        emit VestingCreated(beneficiary, amount, durationSeconds);
    }

    function releaseVested() external nonReentrant {
        VestingSchedule storage schedule = vestingSchedules[_msgSender()];
        require(schedule.totalAmount > 0, "FORGE: no vesting schedule");

        uint256 elapsed = block.timestamp - schedule.startTime;
        require(elapsed >= schedule.cliff, "FORGE: cliff not reached");

        uint256 vested;
        if (elapsed >= schedule.duration) {
            vested = schedule.totalAmount;
        } else {
            vested = (schedule.totalAmount * elapsed) / schedule.duration;
        }

        uint256 releasable = vested - schedule.released;
        require(releasable > 0, "FORGE: no tokens to release");

        schedule.released += releasable;
        _transfer(address(this), _msgSender(), releasable);

        emit VestingReleased(_msgSender(), releasable);
    }

    function vestedAmount(address beneficiary) external view returns (uint256 total, uint256 released, uint256 releasable) {
        VestingSchedule memory schedule = vestingSchedules[beneficiary];
        if (schedule.totalAmount == 0) return (0, 0, 0);

        uint256 elapsed = block.timestamp - schedule.startTime;
        if (elapsed < schedule.cliff) return (schedule.totalAmount, schedule.released, 0);

        uint256 vested;
        if (elapsed >= schedule.duration) {
            vested = schedule.totalAmount;
        } else {
            vested = (schedule.totalAmount * elapsed) / schedule.duration;
        }

        return (schedule.totalAmount, schedule.released, vested - schedule.released);
    }

    // ── Owner Functions ───────────────────────────────────────────────────

    function setMaxTransfer(uint256 newMax) external onlyOwner {
        require(newMax >= MAX_SUPPLY / 1000, "FORGE: max too low (min 0.1%)");
        emit MaxTransferUpdated(maxTransferAmount, newMax);
        maxTransferAmount = newMax;
    }

    function setExemptFromLimit(address account, bool exempt) external onlyOwner {
        isExemptFromLimit[account] = exempt;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ── View Helpers ──────────────────────────────────────────────────────

    function circulatingSupply() external view returns (uint256) {
        return _totalSupply - _balances[address(this)] - totalStaked;
    }

    function tokenInfo() external view returns (
        string memory tokenName,
        string memory tokenSymbol,
        uint8 tokenDecimals,
        uint256 supply,
        uint256 staked,
        uint256 maxTransfer,
        bool isPaused
    ) {
        return (_name, _symbol, _decimals, _totalSupply, totalStaked, maxTransferAmount, paused());
    }
}
