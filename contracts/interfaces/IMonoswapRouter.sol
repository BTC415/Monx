pragma solidity ^0.7.6;

interface IMonoswapRouter {
    function addLiquidity(
        address _token,
        uint256 _amount,
        address to
    ) external returns(uint256);
    
    function addLiquidityPair(
        address _token,
        uint256 vcashAmount,
        uint256 tokenAmount,
        address to
    ) external returns(uint256);

    function addLiquidityETH(
        address to
    ) external payable returns(uint256);

    function removeLiquidityETH(
        uint256 liquidity,
        address to, 
        uint256 minVcashOut, 
        uint256 minTokenOut
    ) external returns(uint256, uint256);

    function removeLiquidity(
        address _token,
        uint256 liquidity,
        address to, 
        uint256 minVcashOut,
        uint256 minTokenOut
    ) external returns(uint256, uint256);

    function swapExactTokenForToken(
        address tokenIn,
        address tokenOut,
        uint amountIn,
        uint amountOutMin,
        address to,
        uint deadline
    ) external virtual returns(uint);

    function swapTokenForExactToken(
        address tokenIn,
        address tokenOut,
        uint amountInMax,
        uint amountOut,
        address to,
        uint deadline
    ) external virtual returns(uint);

    function swapExactETHForToken(
        address tokenOut,
        uint amountOutMin,
        address to,
        uint deadline
    ) external virtual payable returns(uint);

    function swapExactTokenForETH(
        address tokenIn,
        uint amountIn,
        uint amountOutMin,
        address to,
        uint deadline
    ) external virtual returns(uint);

    function swapETHForExactToken(
        address tokenOut,
        uint amountInMax,
        uint amountOut,
        address to,
        uint deadline
    ) external virtual payable returns(uint);

    function swapTokenForExactETH(
        address tokenIn,
        uint amountInMax,
        uint amountOut,
        address to,
        uint deadline
    ) external virtual returns(uint);
}