pragma solidity ^0.7.6;

interface IMonoswap {
    function monoXPool() external returns (address);

    function WETH() external returns (address);
    
    function swapIn(
        address tokenIn,
        address tokenOut,
        address from,
        address to,
        uint256 amountIn
    ) external returns (uint256);
    
    function swapOut(address tokenIn,
        address tokenOut,
        address from,
        address to,
        uint256 amountOut
    ) external returns (uint256);
    
    function getAmountIn(
        address tokenIn,
        address tokenOut, 
        uint256 amountOut
    ) external view returns (uint256, uint256, uint256, uint256);
    
    function removeLiquidityHelper(
        address user,
        address _token,
        uint256 liquidity,
        address to,
        uint256 minVcashOut, 
        uint256 minTokenOut,
        bool isETH
    ) external returns(uint256, uint256);
    
    function addLiquidityPair(
        address user,
        address _token,
        uint256 vcashAmount,
        uint256 tokenAmount,
        address from,
        address to
    ) external returns(uint256);
}