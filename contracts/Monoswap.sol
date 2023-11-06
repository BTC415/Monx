// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.7.6;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "hardhat/console.sol";
import "./interfaces/IMonoXPool.sol";
import './interfaces/IWETH.sol';
import './libraries/MonoXLibrary.sol';

interface IvCash is IERC20 {
  function mint (address account, uint256 amount) external;

  function burn (address account, uint256 amount) external;
}


/**
 * The MonoswapCore is ERC1155 contract does this and that...
 */
contract Monoswap is Initializable, OwnableUpgradeable {
  using SafeMath for uint256;
  using SafeMath for uint112;
  using SafeERC20 for IERC20;
  using SafeERC20 for IvCash;

  IvCash vCash;
  address public router;
  address public WETH;
  address public feeTo;
  uint16 public fees; // over 1e5, 300 means 0.3%
  uint16 public devFee; // over 1e5, 50 means 0.05%

  uint256 constant MINIMUM_LIQUIDITY=100;
  
  struct PoolInfo {
    uint256 pid;
    uint256 lastPoolValue;
    address token;
    PoolStatus status;
    uint112 vcashDebt;
    uint112 vcashCredit;
    uint112 tokenBalance;
    uint256 price; // over 1e18
    uint256 createdAt; // timestamp
  }

  enum TxType {
    SELL,
    BUY
  }

  enum PoolStatus {
    UNLISTED,
    LISTED,
    OFFICIAL,
    SYNTHETIC,
    PAUSED
  }
  
  mapping (address => PoolInfo) public pools;
  
  // tokenStatus is for token lock/transfer. exempt means no need to verify post tx
  mapping (address => uint8) private tokenStatus; //0=unlocked, 1=locked, 2=exempt

  // token poool status is to track if the pool has already been created for the token
  mapping (address => uint8) public tokenPoolStatus; //0=undefined, 1=exists
  
  // negative vCash balance allowed for each token
  mapping (address => uint) public tokenInsurance;

  uint256 public poolSize;

  uint private unlocked;
  modifier lock() {
    require(unlocked == 1, 'MonoX:LOCKED');
    unlocked = 0;
    _;
    unlocked = 1;
  }

  modifier lockToken(address _token) { 
    uint8 originalState = tokenStatus[_token];
    require(originalState!=1, 'MonoX:POOL_LOCKED');
    if(originalState==0) {
      tokenStatus[_token] = 1;
    }
    _;
    if(originalState==0) {
      tokenStatus[_token] = 0;
    }
  }

  modifier onlyPriceAdjuster(){
    require(priceAdjusterRole[msg.sender]==true,"MonoX:BAD_ROLE");
    _;
  }

  modifier onlyRouter() {
    require(router == msg.sender, 'MonoX:NOT_ROUTER');
    _;
  }

  event AddLiquidity(address indexed provider, 
    uint indexed pid,
    address indexed token,
    uint liquidityAmount,
    uint vcashAmount, uint tokenAmount, uint price);

  event RemoveLiquidity(address indexed provider, 
    uint indexed pid,
    address indexed token,
    uint liquidityAmount,
    uint vcashAmount, uint tokenAmount, uint price);

  event Swap(
    address indexed user,
    address indexed tokenIn,
    address indexed tokenOut,
    uint amountIn,
    uint amountOut,
    uint swapVcashValue
  );

  // event PriceAdjusterChanged(
  //   address indexed priceAdjuster,
  //   bool added
  // );

  event PoolBalanced(
    address _token,
    uint vcashIn
  );

  event SyntheticPoolPriceChanged(
    address _token,
    uint price
  );

  event PoolStatusChanged(
    address _token,
    PoolStatus oldStatus,
    PoolStatus newStatus
  );

  IMonoXPool public monoXPool;
  
  // mapping (token address => block number of the last trade)
  mapping (address => uint) public lastTradedBlock; 

  uint256 constant MINIMUM_POOL_VALUE = 10000 * 1e18;
  mapping (address=>bool) public priceAdjusterRole;

  // ------------
  uint public poolSizeMinLimit;
  mapping (address => uint256) public unassessedFees;

  function initialize(IMonoXPool _monoXPool, IvCash _vcash) public initializer {
    OwnableUpgradeable.__Ownable_init();
    monoXPool = _monoXPool;
    vCash = _vcash;
    WETH = _monoXPool.WETH();
    fees = 300;
    devFee = 50;
    poolSize = 0;
    unlocked = 1;
  }

  // receive() external payable {
  //   assert(msg.sender == WETH); // only accept ETH via fallback from the WETH contract
  // }

  function setRouter (address _router) onlyOwner external {
    router = _router;
  }

  function setFeeTo (address _feeTo) onlyOwner external {
    feeTo = _feeTo;
  }
  
  function setFees (uint16 _fees) onlyOwner external {
    require(_fees<1e3);
    fees = _fees;
  }

  function setDevFee (uint16 _devFee) onlyOwner external {
    require(_devFee<1e3);
    devFee = _devFee;
  }

  function setPoolSizeMinLimit(uint _poolSizeMinLimit) onlyOwner external {
    poolSizeMinLimit = _poolSizeMinLimit;
  }

  function setTokenInsurance (address _token, uint _insurance) onlyOwner external {
    tokenInsurance[_token] = _insurance;
  }

  // when safu, setting token status to 2 can achieve significant gas savings 
  function setTokenStatus (address _token, uint8 _status) onlyOwner external {
    tokenStatus[_token] = _status;
  } 

  // update status of a pool. onlyOwner.
  function updatePoolStatus(address _token, PoolStatus _status) external onlyOwner {    

    PoolStatus poolStatus = pools[_token].status;
    if(poolStatus==PoolStatus.PAUSED){
      require(block.number > lastTradedBlock[_token].add(6000), "MonoX:TOO_EARLY");
    }
    else{
      // okay to pause an official pool, wait 6k blocks and then convert it to synthetic
      require(_status!=PoolStatus.SYNTHETIC,"MonoX:NO_SYNT");
    }
      
    emit PoolStatusChanged(_token, poolStatus,_status);
    pools[_token].status = _status;

    // unlisting a token allows creating a new pool of the same token. 
    // should move it to PAUSED if the goal is to blacklist the token forever
    if(_status==PoolStatus.UNLISTED) {
      tokenPoolStatus[_token] = 0;
    }
  }
  
  /**
    @dev update pools price if there were no active trading for the last 6000 blocks
    @notice Only owner callable, new price can neither be 0 nor be equal to old one
    @param _token pool identifider (token address)
    @param _newPrice new price in wei (uint112)
   */
  function updatePoolPrice(address _token, uint _newPrice) external onlyOwner {
    require(_newPrice > 0, 'MonoX:0_PRICE');
    require(tokenPoolStatus[_token] != 0, "MonoX:NO_POOL");

    require(block.number > lastTradedBlock[_token].add(6000), "MonoX:TOO_EARLY");
    pools[_token].price = _newPrice;
    lastTradedBlock[_token] = block.number;
  }

  function updatePriceAdjuster(address account, bool _status) external onlyOwner{
    priceAdjusterRole[account]=_status;
    //emit PriceAdjusterChanged(account,_status);
  }

  function setSynthPoolPrice(address _token, uint price) external onlyPriceAdjuster {
    require(pools[_token].status==PoolStatus.SYNTHETIC,"MonoX:NOT_SYNT");
    require(price > 0, "MonoX:ZERO_PRICE");
    pools[_token].price=price;
    emit SyntheticPoolPriceChanged(_token,price);
  }

  function rebalancePool(address _token) external lockToken(_token) onlyOwner{
      // // PoolInfo memory pool = pools[_token];
      // uint poolPrice = pools[_token].price;
      // require(vcashIn <= pools[_token].vcashDebt,"MonoX:NO_CREDIT");
      // require((pools[_token].tokenBalance * poolPrice).div(1e18) >= vcashIn,"MonoX:INSUF_TOKEN_VAL");
      // // uint rebalancedAmount = vcashIn.mul(1e18).div(pool.price);
      // monoXPool.safeTransferERC20Token(_token, msg.sender, vcashIn.mul(1e18).div(poolPrice));
      // _syncPoolInfo(_token, vcashIn, 0);
      // emit PoolBalanced(_token, vcashIn);

      _internalRebalance(_token);
  }

  // must be called from a method with token lock to prevent reentry
  function _internalRebalance(address _token) internal {
    uint poolPrice = pools[_token].price;
    uint vcashIn = pools[_token].vcashDebt;
    if(poolPrice.mul(pools[_token].tokenBalance) / 1e18 < vcashIn){
      vcashIn = poolPrice.mul(pools[_token].tokenBalance) / 1e18;
    }

    if(tokenStatus[_token]==2){
      monoXPool.safeTransferERC20Token(_token, feeTo, vcashIn.mul(1e18).div(poolPrice));
    }else{
      uint256 balanceIn0 = IERC20(_token).balanceOf(address(monoXPool));
      monoXPool.safeTransferERC20Token(_token, feeTo, vcashIn.mul(1e18).div(poolPrice));
      uint256 balanceIn1 = IERC20(_token).balanceOf(address(monoXPool));
      uint realAmount = balanceIn0.sub(balanceIn1);

      vcashIn = realAmount.mul(poolPrice) / 1e18;
    }
    
    _syncPoolInfo(_token, vcashIn, 0);
    emit PoolBalanced(_token,vcashIn);
  }

  // creates a pool
  function _createPool (address _token, uint _price, PoolStatus _status) lock internal returns(uint256 _pid)  {
    require(tokenPoolStatus[_token]==0, "MonoX:POOL_EXISTS");
    require (_token != address(vCash), "MonoX:NO_vCash");
    _pid = poolSize;
    pools[_token] = PoolInfo({
      token: _token,
      pid: _pid,
      vcashCredit: 0,
      vcashDebt: 0,
      tokenBalance: 0,
      lastPoolValue: 0,
      status: _status,
      price: _price,
      createdAt: block.timestamp
    });

    poolSize = _pid.add(1);
    tokenPoolStatus[_token]=1;

    // initialze pool's lasttradingblocknumber as the block number on which the pool is created
    lastTradedBlock[_token] = block.number;
  }

  // creates a pool with special status
  function addSpecialToken (address _token, uint _price, PoolStatus _status) onlyOwner external returns(uint256 _pid)  {
    _pid = _createPool(_token, _price, _status);
  }

  // internal func to pay contract owner
  function _mintFee (uint256 pid, address _token, uint256 newPoolValue) internal {
    uint256 deltaPoolValue = unassessedFees[_token];
    uint deltaFi = deltaPoolValue.mul(devFee)/1e5;
    uint numerator = monoXPool.totalSupplyOf(pid).mul(deltaFi);
    if (newPoolValue > deltaPoolValue.add(deltaFi)) {
      uint denominator = newPoolValue.sub(deltaPoolValue).sub(deltaFi);
      uint devLiquidity = numerator / denominator;
      if (devLiquidity > 0) {
        monoXPool.mint(feeTo, pid, devLiquidity);
        unassessedFees[_token] = 0;
      }
    }
  }

  // util func to get some basic pool info
  function getPool (address _token) view public returns (uint256 poolValue, 
    uint256 tokenBalanceVcashValue, uint256 vcashCredit, uint256 vcashDebt) {
    // PoolInfo memory pool = pools[_token];
    vcashCredit = pools[_token].vcashCredit;
    vcashDebt = pools[_token].vcashDebt;
    tokenBalanceVcashValue = pools[_token].price.mul(pools[_token].tokenBalance)/1e18;

    poolValue = tokenBalanceVcashValue.add(vcashCredit).sub(vcashDebt);
  }

  // trustless listing pool creation. always creates unofficial pool
  function listNewToken (address _token, uint _price, 
    uint256 vcashAmount, 
    uint256 tokenAmount,
    address to) external returns(uint _pid, uint256 liquidity) {
    _pid = _createPool(_token, _price, PoolStatus.LISTED);
    liquidity = _addLiquidityPair(msg.sender, _token, vcashAmount, tokenAmount, msg.sender, to);
  }

  function addLiquidityPair (address user,
    address _token, 
    uint256 vcashAmount, 
    uint256 tokenAmount,
    address from,
    address to) external onlyRouter returns(uint256 liquidity) {
    liquidity = _addLiquidityPair (user, _token, vcashAmount, tokenAmount, from, to);
  }

  // add liquidity pair to a pool. allows adding vcash.
  function _addLiquidityPair (address user,
    address _token, 
    uint256 vcashAmount, 
    uint256 tokenAmount,
    address from,
    address to) internal lockToken(_token) returns(uint256 liquidity) {
    require (tokenAmount>0, "MonoX:BAD_AMOUNT");

    require(tokenPoolStatus[_token]==1, "MonoX:NO_POOL");
    
    // (uint256 poolValue, , ,) = getPool(_token);
    PoolInfo memory pool = pools[_token];
    IMonoXPool monoXPoolLocal = monoXPool;
    
    uint256 poolValue = pool.price.mul(pool.tokenBalance)/1e18;
    poolValue = poolValue.add(pool.vcashCredit).sub(pool.vcashDebt);

    
    _mintFee(pool.pid, pool.token, poolValue);

    tokenAmount = transferAndCheck(from,address(monoXPoolLocal),_token,tokenAmount);

    if(vcashAmount>0){
      vCash.safeTransferFrom(user, address(monoXPoolLocal), vcashAmount);
      vCash.burn(address(monoXPool), vcashAmount);
    }

    // this is to avoid stack too deep
    {
      uint256 _totalSupply = monoXPoolLocal.totalSupplyOf(pool.pid);
      uint256 liquidityVcashValue = vcashAmount.add(tokenAmount.mul(pool.price)/1e18);

      if(_totalSupply==0){
        liquidityVcashValue = liquidityVcashValue/1e6; // so $1m would get you 1e18
        liquidity = liquidityVcashValue.sub(MINIMUM_LIQUIDITY);
        // sorry, oz doesn't allow minting to address(0)
        monoXPoolLocal.mintLp(feeTo, pool.pid, MINIMUM_LIQUIDITY, pool.status == PoolStatus.LISTED); 
      }else{
        liquidity = _totalSupply.mul(liquidityVcashValue).div(poolValue);
      }
    }
    
    monoXPoolLocal.mintLp(to, pool.pid, liquidity, pool.status == PoolStatus.LISTED);
    _syncPoolInfo(_token, vcashAmount, 0);

    emit AddLiquidity(to, 
    pool.pid,
    _token,
    liquidity, 
    vcashAmount, tokenAmount, pool.price);
  }

  // updates pool vcash balance, token balance and last pool value.
  // this function requires others to do the input validation
  function _syncPoolInfo (address _token, uint256 vcashIn, uint256 vcashOut) internal {
    // PoolInfo memory pool = pools[_token];
    uint256 tokenPoolPrice = pools[_token].price;
    (uint256 vcashCredit, uint256 vcashDebt) = _updateVcashBalance(_token, vcashIn, vcashOut);

    uint256 tokenReserve = IERC20(_token).balanceOf(address(monoXPool));
    uint256 tokenBalanceVcashValue = tokenPoolPrice.mul(tokenReserve)/1e18;

    require(tokenReserve <= uint112(-1));
    pools[_token].tokenBalance = uint112(tokenReserve);
    // poolValue = tokenBalanceVcashValue.add(vcashCredit).sub(vcashDebt);
    pools[_token].lastPoolValue = tokenBalanceVcashValue.add(vcashCredit).sub(vcashDebt);
  }
  
  // view func for removing liquidity
  function _removeLiquidity (address user, address _token, uint256 liquidity) view public returns(
    uint256 poolValue, uint256 liquidityIn, uint256 vcashOut, uint256 tokenOut) {
    
    uint256 tokenBalanceVcashValue;
    uint256 vcashCredit;
    uint256 vcashDebt;
    PoolInfo memory pool = pools[_token];
    (poolValue, tokenBalanceVcashValue, vcashCredit, vcashDebt) = getPool(_token);
    uint256 _totalSupply = monoXPool.totalSupplyOf(pool.pid);

    liquidityIn = monoXPool.balanceOf(user, pool.pid)>liquidity?liquidity:monoXPool.balanceOf(user, pool.pid);
    uint256 tokenReserve = IERC20(_token).balanceOf(address(monoXPool));
    
    if(tokenReserve < pool.tokenBalance){
      tokenBalanceVcashValue = tokenReserve.mul(pool.price)/1e18;
    }

    if(vcashDebt>0){
      tokenReserve = (tokenBalanceVcashValue.sub(vcashDebt)).mul(1e18).div(pool.price);
    }

    // if vcashCredit==0, vcashOut will be 0 as well
    vcashOut = liquidityIn.mul(vcashCredit).div(_totalSupply);
    tokenOut = liquidityIn.mul(tokenReserve).div(_totalSupply);
  }

  // actually removes liquidity
  function removeLiquidityHelper (address user, address _token, uint256 liquidity, address to, 
    uint256 minVcashOut, 
    uint256 minTokenOut,
    bool isETH) onlyRouter lockToken(_token) external returns(uint256 vcashOut, uint256 tokenOut)  {
    require (tokenPoolStatus[_token]==1, "MonoX:NO_TOKEN");
    PoolInfo memory pool = pools[_token];
    
    require (liquidity>0, "MonoX:BAD_AMOUNT");
    
    {
      uint256 lastAdded = monoXPool.liquidityLastAddedOf(pool.pid, user);
      lastAdded = lastAdded != 0 ? lastAdded : block.timestamp;
      uint256 lockTime;
      if (pool.status == PoolStatus.OFFICIAL) lockTime = 4 hours;
      else if (pool.status == PoolStatus.LISTED) lockTime = 24 hours;
      require(lastAdded + lockTime <= block.timestamp, "MonoX:WRONG_TIME"); // Users are not allowed to remove liquidity right after adding
    }

    {
      address topLPHolder = monoXPool.topLPHolderOf(pool.pid);
      require(pool.status != PoolStatus.LISTED || user != topLPHolder || pool.createdAt + 90 days < block.timestamp, "MonoX:TOP_HOLDER & WRONG_TIME"); // largest LP holder is not allowed to remove LP within 90 days after pool creation
    }
    uint256 poolValue;
    uint256 liquidityIn;
    (poolValue, liquidityIn, vcashOut, tokenOut) = _removeLiquidity(user, _token, liquidity);
    _mintFee(pool.pid, pool.token, poolValue);
    require (vcashOut>=minVcashOut, "MonoX:INSUFF_vCash");
    require (tokenOut>=minTokenOut, "MonoX:INSUFF_TOKEN");

    if (vcashOut>0){
      vCash.mint(to, vcashOut);
    }
    if (!isETH) {
      monoXPool.safeTransferERC20Token(_token, to, tokenOut);
    } else {
      monoXPool.withdrawWETH(tokenOut);
      monoXPool.safeTransferETH(to, tokenOut);
    }

    monoXPool.burn(user, pool.pid, liquidityIn);

    _syncPoolInfo(_token, 0, vcashOut);

    emit RemoveLiquidity(to, 
      pool.pid,
      _token,
      liquidityIn, 
      vcashOut, tokenOut, pool.price);
  }

  // util func to compute new price
  function _getNewPrice (uint256 originalPrice, uint256 reserve, 
    uint256 delta, uint256 deltaBlocks, TxType txType) pure internal returns(uint256 price) {
    if(txType==TxType.SELL) {
      // no risk of being div by 0
      price = originalPrice.mul(reserve)/(reserve.add(delta));
    }else{ // BUY
      price = originalPrice.mul(reserve).div(reserve.sub(delta));
    }
  }

  // util func to compute new price
  function _getAvgPrice (uint256 originalPrice, uint256 newPrice) pure internal returns(uint256 price) {
    price = originalPrice.add(newPrice.mul(4))/5;
  }

  // util func to manipulate vcash balance
  function _updateVcashBalance (address _token, 
    uint _vcashIn, uint _vcashOut) internal returns (uint _vcashCredit, uint _vcashDebt) {
    if(_vcashIn>_vcashOut){
      _vcashIn = _vcashIn - _vcashOut;
      _vcashOut = 0;
    }else{
      _vcashOut = _vcashOut - _vcashIn;
      _vcashIn = 0;
    }

    // PoolInfo memory _pool = pools[_token];
    uint _poolVcashCredit = pools[_token].vcashCredit;
    uint _poolVcashDebt = pools[_token].vcashDebt;
    PoolStatus _poolStatus = pools[_token].status;
    
    if(_vcashOut>0){
      (_vcashCredit, _vcashDebt) = MonoXLibrary.vcashBalanceSub(
        _poolVcashCredit, _poolVcashDebt, _vcashOut);
      require(_vcashCredit <= uint112(-1) && _vcashDebt <= uint112(-1));
      pools[_token].vcashCredit = uint112(_vcashCredit);
      pools[_token].vcashDebt = uint112(_vcashDebt);
    }

    if(_vcashIn>0){
      (_vcashCredit, _vcashDebt) = MonoXLibrary.vcashBalanceAdd(
        _poolVcashCredit, _poolVcashDebt, _vcashIn);
      require(_vcashCredit <= uint112(-1) && _vcashDebt <= uint112(-1));
      pools[_token].vcashCredit = uint112(_vcashCredit);
      pools[_token].vcashDebt = uint112(_vcashDebt);
    }

    if(_poolStatus == PoolStatus.LISTED){

      require (_vcashDebt<=tokenInsurance[_token], "MonoX:INSUFF_vCash");
    }
  }
  
  // updates pool token balance and price.
  function _updateTokenInfo (address _token, uint256 _price,
      uint256 _vcashIn, uint256 _vcashOut, uint256 _ETHDebt) internal {
    uint256 _balance = IERC20(_token).balanceOf(address(monoXPool));
    _balance = _balance.sub(_ETHDebt);
    require(pools[_token].status!=PoolStatus.PAUSED,"MonoX:PAUSED");
    require(_balance <= uint112(-1));
    (uint initialPoolValue, , ,) = getPool(_token);
    pools[_token].tokenBalance = uint112(_balance);
    pools[_token].price = _price;

    // record last trade's block number in mapping: lastTradedBlock
    lastTradedBlock[_token] = block.number;

    _updateVcashBalance(_token, _vcashIn, _vcashOut);

    (uint poolValue, , ,) = getPool(_token);

    require(initialPoolValue <= poolValue || poolValue >= poolSizeMinLimit,
      "MonoX:MIN_POOL_SIZE");
    
    
  }

  function directSwapAllowed(uint tokenInPoolPrice,uint tokenOutPoolPrice, 
                              uint tokenInPoolTokenBalance, uint tokenOutPoolTokenBalance, PoolStatus status, bool getsAmountOut) internal pure returns(bool){
      uint tokenInValue  = tokenInPoolTokenBalance.mul(tokenInPoolPrice).div(1e18);
      uint tokenOutValue = tokenOutPoolTokenBalance.mul(tokenOutPoolPrice).div(1e18);
      bool priceExists   = getsAmountOut?tokenInPoolPrice>0:tokenOutPoolPrice>0;
      
      // only if it's official pool with similar size
      return priceExists&&status==PoolStatus.OFFICIAL&&tokenInValue>0&&tokenOutValue>0&&
        ((tokenInValue/tokenOutValue)+(tokenOutValue/tokenInValue)==1);
        
  }

  // view func to compute amount required for tokenIn to get fixed amount of tokenOut
  function getAmountIn(address tokenIn, address tokenOut, 
    uint256 amountOut) public view returns (uint256 tokenInPrice, uint256 tokenOutPrice, 
    uint256 amountIn, uint256 tradeVcashValue) {
    require(amountOut > 0, 'MonoX:INSUFF_INPUT');
    
    uint256 amountOutWithFee = amountOut.mul(1e5).div(1e5 - fees);
    address vcashAddress = address(vCash);
    uint tokenOutPoolPrice = pools[tokenOut].price;
    uint tokenOutPoolTokenBalance = pools[tokenOut].tokenBalance;
    if(tokenOut==vcashAddress){
      tradeVcashValue = amountOutWithFee;
      tokenOutPrice = 1e18;
    }else{
      require (tokenPoolStatus[tokenOut]==1, "MonoX:NO_POOL");
      // PoolInfo memory tokenOutPool = pools[tokenOut];
      PoolStatus tokenOutPoolStatus = pools[tokenOut].status;
      
      require (tokenOutPoolStatus != PoolStatus.UNLISTED, "MonoX:POOL_UNLST");
      tokenOutPrice = _getNewPrice(tokenOutPoolPrice, tokenOutPoolTokenBalance, 
        amountOutWithFee, 0, TxType.BUY);

      tradeVcashValue = _getAvgPrice(tokenOutPoolPrice, tokenOutPrice).mul(amountOutWithFee)/1e18;
    }

    if(tokenIn==vcashAddress){
      amountIn = tradeVcashValue;
      tokenInPrice = 1e18;
    }else{
      require (tokenPoolStatus[tokenIn]==1, "MonoX:NO_POOL");
      // PoolInfo memory tokenInPool = pools[tokenIn];
      PoolStatus tokenInPoolStatus = pools[tokenIn].status;
      uint tokenInPoolPrice = pools[tokenIn].price;
      uint tokenInPoolTokenBalance = pools[tokenIn].tokenBalance;
      require (tokenInPoolStatus != PoolStatus.UNLISTED, "MonoX:POOL_UNLST");

      amountIn = tradeVcashValue.add(tokenInPoolTokenBalance.mul(tokenInPoolPrice).div(1e18));
      amountIn = tradeVcashValue.mul(tokenInPoolTokenBalance).div(amountIn);


      bool allowDirectSwap=directSwapAllowed(tokenInPoolPrice,tokenOutPoolPrice,tokenInPoolTokenBalance,tokenOutPoolTokenBalance,tokenInPoolStatus,false);

      // assuming p1*p2 = k, equivalent to uniswap's x * y = k
      uint directSwapTokenInPrice = allowDirectSwap?tokenOutPoolPrice.mul(tokenInPoolPrice).div(tokenOutPrice):1;

      tokenInPrice = _getNewPrice(tokenInPoolPrice, tokenInPoolTokenBalance, 
        amountIn, 0, TxType.SELL);

      tokenInPrice = directSwapTokenInPrice > tokenInPrice?directSwapTokenInPrice:tokenInPrice;

      amountIn = tradeVcashValue.mul(1e18).div(_getAvgPrice(tokenInPoolPrice, tokenInPrice));
    }
  }

  // view func to compute amount required for tokenOut to get fixed amount of tokenIn
  function getAmountOut(address tokenIn, address tokenOut, 
    uint256 amountIn) public view returns (uint256 tokenInPrice, uint256 tokenOutPrice, 
    uint256 amountOut, uint256 tradeVcashValue) {
    require(amountIn > 0, 'MonoX:INSUFF_INPUT');
    
    uint256 amountInWithFee = amountIn.mul(1e5-fees)/1e5;
    address vcashAddress = address(vCash);
    uint tokenInPoolPrice = pools[tokenIn].price;
    uint tokenInPoolTokenBalance = pools[tokenIn].tokenBalance;

    if(tokenIn==vcashAddress){
      tradeVcashValue = amountInWithFee;
      tokenInPrice = 1e18;
    }else{
      require (tokenPoolStatus[tokenIn]==1, "MonoX:NO_POOL");
      // PoolInfo memory tokenInPool = pools[tokenIn];
      PoolStatus tokenInPoolStatus = pools[tokenIn].status;
      
      require (tokenInPoolStatus != PoolStatus.UNLISTED, "MonoX:POOL_UNLST");
      
      tokenInPrice = _getNewPrice(tokenInPoolPrice, tokenInPoolTokenBalance, 
        amountInWithFee, 0, TxType.SELL);
      tradeVcashValue = _getAvgPrice(tokenInPoolPrice, tokenInPrice).mul(amountInWithFee)/1e18;
    }

    if(tokenOut==vcashAddress){
      amountOut = tradeVcashValue;
      tokenOutPrice = 1e18;
    }else{
      require (tokenPoolStatus[tokenOut]==1, "MonoX:NO_POOL");
      // PoolInfo memory tokenOutPool = pools[tokenOut];
      PoolStatus tokenOutPoolStatus = pools[tokenOut].status;
      uint tokenOutPoolPrice = pools[tokenOut].price;
      uint tokenOutPoolTokenBalance = pools[tokenOut].tokenBalance;

      require (tokenOutPoolStatus != PoolStatus.UNLISTED, "MonoX:POOL_UNLST");
      
      amountOut = tradeVcashValue.add(tokenOutPoolTokenBalance.mul(tokenOutPoolPrice).div(1e18));
      amountOut = tradeVcashValue.mul(tokenOutPoolTokenBalance).div(amountOut);

      bool allowDirectSwap=directSwapAllowed(tokenInPoolPrice,tokenOutPoolPrice,tokenInPoolTokenBalance,tokenOutPoolTokenBalance,tokenOutPoolStatus,true);

      // assuming p1*p2 = k, equivalent to uniswap's x * y = k
      uint directSwapTokenOutPrice = allowDirectSwap?tokenInPoolPrice.mul(tokenOutPoolPrice).div(tokenInPrice):uint(-1);

      // prevent the attack where user can use a small pool to update price in a much larger pool
      tokenOutPrice = _getNewPrice(tokenOutPoolPrice, tokenOutPoolTokenBalance, 
        amountOut, 0, TxType.BUY);
      tokenOutPrice = directSwapTokenOutPrice < tokenOutPrice?directSwapTokenOutPrice:tokenOutPrice;

      amountOut = tradeVcashValue.mul(1e18).div(_getAvgPrice(tokenOutPoolPrice, tokenOutPrice));
    }
  }


  // swap from tokenIn to tokenOut with fixed tokenIn amount.
  function swapIn (address tokenIn, address tokenOut, address from, address to,
      uint256 amountIn) public onlyRouter lockToken(tokenIn) lock returns(uint256 amountOut)  {
    require (tokenIn != tokenOut, "MonoX:SAME_SWAP_TOKEN");

    address monoXPoolLocal = address(monoXPool);

    amountIn = transferAndCheck(from,monoXPoolLocal,tokenIn,amountIn); 
    
    // uint256 halfFeesInTokenIn = amountIn.mul(fees)/2e5;

    uint256 tokenInPrice;
    uint256 tokenOutPrice;
    uint256 tradeVcashValue;
    
    (tokenInPrice, tokenOutPrice, amountOut, tradeVcashValue) = getAmountOut(tokenIn, tokenOut, amountIn);
    
    uint256 oneSideFeesInVcash = tokenInPrice.mul(amountIn.mul(fees)/2e5)/1e18;

    // trading in
    if(tokenIn==address(vCash)){
      vCash.burn(monoXPoolLocal, amountIn);
      // all fees go to the other side
      oneSideFeesInVcash = oneSideFeesInVcash.mul(2);
    }else{
      _updateTokenInfo(tokenIn, tokenInPrice, 0, tradeVcashValue.add(oneSideFeesInVcash), 0);
      unassessedFees[tokenIn] = oneSideFeesInVcash.add(unassessedFees[tokenIn]);
    }

    // trading out
    if(tokenOut==address(vCash)){
      vCash.mint(to, amountOut);
    }else{
      if (to != monoXPoolLocal) {
        IMonoXPool(monoXPoolLocal).safeTransferERC20Token(tokenOut, to, amountOut);
      }
      _updateTokenInfo(tokenOut, tokenOutPrice, tradeVcashValue.add(oneSideFeesInVcash), 0, 
        to == monoXPoolLocal ? amountOut : 0);
      unassessedFees[tokenOut] = oneSideFeesInVcash.add(unassessedFees[tokenOut]);
    }

    if(pools[tokenIn].vcashDebt > 0 && pools[tokenIn].status == PoolStatus.OFFICIAL){
      _internalRebalance(tokenIn);
    }

    emit Swap(to, tokenIn, tokenOut, amountIn, amountOut, tradeVcashValue);
    
  }

  
  // swap from tokenIn to tokenOut with fixed tokenOut amount.
  function swapOut (address tokenIn, address tokenOut, address from, address to, 
      uint256 amountOut) public onlyRouter lockToken(tokenIn) lock returns(uint256 amountIn)  {
    require (tokenIn != tokenOut, "MonoX:SAME_SWAP_TOKEN");
    uint256 tokenInPrice;
    uint256 tokenOutPrice;
    uint256 tradeVcashValue;
    (tokenInPrice, tokenOutPrice, amountIn, tradeVcashValue) = getAmountIn(tokenIn, tokenOut, amountOut);
    
    address monoXPoolLocal = address(monoXPool);

    amountIn = transferAndCheck(from,monoXPoolLocal,tokenIn,amountIn);

    // uint256 halfFeesInTokenIn = amountIn.mul(fees)/2e5;

    uint256 oneSideFeesInVcash = tokenInPrice.mul(amountIn.mul(fees)/2e5)/1e18;

    // trading in
    if(tokenIn==address(vCash)){
      vCash.burn(monoXPoolLocal, amountIn);
      // all fees go to buy side
      oneSideFeesInVcash = oneSideFeesInVcash.mul(2);
    }else {
      _updateTokenInfo(tokenIn, tokenInPrice, 0, tradeVcashValue.add(oneSideFeesInVcash), 0);
      unassessedFees[tokenIn] = oneSideFeesInVcash.add(unassessedFees[tokenIn]);
    }

    // trading out
    if(tokenOut==address(vCash)){
      vCash.mint(to, amountOut);
      // all fees go to sell side
      _updateVcashBalance(tokenIn, oneSideFeesInVcash, 0);
    }else{
      if (to != monoXPoolLocal) {
        IMonoXPool(monoXPoolLocal).safeTransferERC20Token(tokenOut, to, amountOut);
      }
      _updateTokenInfo(tokenOut, tokenOutPrice, tradeVcashValue.add(oneSideFeesInVcash), 0, 
        to == monoXPoolLocal ? amountOut:0 );
      unassessedFees[tokenOut] = oneSideFeesInVcash.add(unassessedFees[tokenOut]);
    }
     
    if(pools[tokenIn].vcashDebt > 0 && pools[tokenIn].status == PoolStatus.OFFICIAL){
      _internalRebalance(tokenIn);
    }

    emit Swap(to, tokenIn, tokenOut, amountIn, amountOut, tradeVcashValue);

  }
  // function balanceOf(address account, uint256 id) public view returns (uint256) {
  //   return monoXPool.balanceOf(account, id);
  // }

  function getConfig() public view returns (address _vCash, address _weth, address _feeTo, uint16 _fees, uint16 _devFee) {
    _vCash = address(vCash);
    _weth = WETH;
    _feeTo = feeTo;
    _fees = fees;
    _devFee = devFee;
  }

  function transferAndCheck(address from,address to,address _token,uint amount) internal returns (uint256){
    if(from == address(this)){
      return amount; // if it's ETH
    }

    // if it's not ETH
    if(tokenStatus[_token]==2){
      IERC20(_token).safeTransferFrom(from, to, amount);
      return amount;
    }else{
      uint256 balanceIn0 = IERC20(_token).balanceOf(to);
      IERC20(_token).safeTransferFrom(from, to, amount);
      uint256 balanceIn1 = IERC20(_token).balanceOf(to);
      return balanceIn1.sub(balanceIn0);
    }   

  }
}
