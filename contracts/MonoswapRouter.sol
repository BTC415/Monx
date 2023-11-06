// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.7.6;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./interfaces/IMonoswap.sol";
import "./interfaces/IMonoswapRouter.sol";
import "./interfaces/IMonoXPool.sol";
import './interfaces/IWETH.sol';
import './libraries/MonoXLibrary.sol';
import "hardhat/console.sol";

// contract MonoswapRouter is Initializable, OwnableUpgradeable {
  contract MonoswapRouter is Ownable, IMonoswapRouter {
  using SafeMath for uint256;
  using SafeMath for uint112;
  using SafeERC20 for IERC20;

  address public core;
  address monoXPool;
  address WETH;

  constructor(address _core) {
    core = _core;
    monoXPool = IMonoswap(core).monoXPool();
    WETH = IMonoswap(core).WETH();
  }

  modifier ensure(uint deadline) {
    require(deadline >= block.timestamp, 'MonoswapRouter:EXPIRED');
    _;
  }

  function swapExactTokenForToken(
    address tokenIn,
    address tokenOut,
    uint amountIn,
    uint amountOutMin,
    address to,
    uint deadline
  ) external override virtual ensure(deadline) returns (uint amountOut) {
    amountOut = IMonoswap(core).swapIn(tokenIn, tokenOut, msg.sender, to, amountIn);
    require(amountOut >= amountOutMin, 'MonoswapRouter:INSUFF_OUTPUT');
  }

  function swapTokenForExactToken(
    address tokenIn,
    address tokenOut,
    uint amountInMax,
    uint amountOut,
    address to,
    uint deadline
  ) external override virtual ensure(deadline) returns (uint amountIn) {
    amountIn = IMonoswap(core).swapOut(tokenIn, tokenOut, msg.sender, to, amountOut);
    require(amountIn <= amountInMax, 'MonoswapRouter:EXCESSIVE_INPUT');
  }

  function swapExactETHForToken(
    address tokenOut,
    uint amountOutMin,
    address to,
    uint deadline
  ) external override virtual payable ensure(deadline) returns (uint amountOut) {
    uint amountIn = msg.value;
    MonoXLibrary.safeTransferETH(monoXPool, amountIn);
    IMonoXPool(monoXPool).depositWETH(amountIn);
    amountOut = IMonoswap(core).swapIn(WETH, tokenOut, core, to, amountIn);
    require(amountOut >= amountOutMin, 'MonoswapRouter:INSUFF_OUTPUT');
  }

  function swapExactTokenForETH(
    address tokenIn,
    uint amountIn,
    uint amountOutMin,
    address to,
    uint deadline
  ) external override virtual ensure(deadline) returns (uint amountOut) {
    amountOut = IMonoswap(core).swapIn(tokenIn, WETH, msg.sender, monoXPool, amountIn);
    require(amountOut >= amountOutMin, 'MonoX:INSUFF_OUTPUT');
    IMonoXPool(monoXPool).withdrawWETH(amountOut);
    IMonoXPool(monoXPool).safeTransferETH(to, amountOut);
  }

   function swapETHForExactToken(
    address tokenOut,
    uint amountInMax,
    uint amountOut,
    address to,
    uint deadline
  ) external override virtual payable ensure(deadline) returns (uint amountIn) {
    uint amountSentIn = msg.value;
    ( , , amountIn, ) = IMonoswap(core).getAmountIn(WETH, tokenOut, amountOut);
    MonoXLibrary.safeTransferETH(monoXPool, amountIn);
    IMonoXPool(monoXPool).depositWETH(amountIn);
    amountIn = IMonoswap(core).swapOut(WETH, tokenOut, core, to, amountOut);
    require(amountIn <= amountSentIn, 'MonoX:BAD_INPUT');
    require(amountIn <= amountInMax, 'MonoX:EXCESSIVE_INPUT');
    if (amountSentIn > amountIn) {
      MonoXLibrary.safeTransferETH(msg.sender, amountSentIn.sub(amountIn));
    }
  }

  function swapTokenForExactETH(
    address tokenIn,
    uint amountInMax,
    uint amountOut,
    address to,
    uint deadline
  ) external override virtual ensure(deadline) returns (uint amountIn) {
    amountIn = IMonoswap(core).swapOut(tokenIn, WETH, msg.sender, monoXPool, amountOut);
    require(amountIn <= amountInMax, 'MonoX:EXCESSIVE_INPUT');
    IMonoXPool(monoXPool).withdrawWETH(amountOut);
    IMonoXPool(monoXPool).safeTransferETH(to, amountOut);
  }

  // add liquidity pair to a pool. allows adding vcash.
  function addLiquidityPair (address _token, 
    uint256 vcashAmount, 
    uint256 tokenAmount,
    address to) external override returns(uint256 liquidity) {
    liquidity = IMonoswap(core).addLiquidityPair(msg.sender, _token, vcashAmount, tokenAmount, msg.sender, to);
  }

  // add one-sided liquidity to a pool. no vcash
  function addLiquidity (address _token, uint256 _amount, address to) external override returns(uint256 liquidity) {
    liquidity = IMonoswap(core).addLiquidityPair(msg.sender, _token, 0, _amount, msg.sender, to);
  }  

  // add one-sided ETH liquidity to a pool. no vcash
  function addLiquidityETH (address to) external override payable returns(uint256 liquidity)  {
    MonoXLibrary.safeTransferETH(monoXPool, msg.value);
    IMonoXPool(monoXPool).depositWETH(msg.value);
    liquidity = IMonoswap(core).addLiquidityPair(msg.sender, WETH, 0, msg.value, core, to);
  }  

  // actually removes liquidity
  function removeLiquidity (address _token, uint256 liquidity, address to, 
    uint256 minVcashOut, 
    uint256 minTokenOut) external override returns(uint256 vcashOut, uint256 tokenOut)  {
    (vcashOut, tokenOut) = IMonoswap(core).removeLiquidityHelper(msg.sender, _token, liquidity, to, minVcashOut, minTokenOut, false);
  }

  // actually removes ETH liquidity
  function removeLiquidityETH (uint256 liquidity, address to, 
    uint256 minVcashOut, 
    uint256 minTokenOut) external override returns(uint256 vcashOut, uint256 tokenOut)  {
    (vcashOut, tokenOut) = IMonoswap(core).removeLiquidityHelper(msg.sender, WETH, liquidity, to, minVcashOut, minTokenOut, true);
  }
}
