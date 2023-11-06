# Monoswap Core

## How to list new token?


> Listing new token requires that the token has been approved in advance.
> User can list token using `listNewToken` function

```javascript
function listNewToken (address _token,
    uint _price, 
    uint256 vcashAmount, 
    uint256 tokenAmount,
    address to);

```


_token: Token address to list

_price: Token price

vcashAmount: VCASH amount to add initially

tokenAmount: Token amount to add initially

to: Address that gets liquidity

> This function list tokens and add liquidity with vcashAmount and tokenAmount and send LP token to `to`
## How to add liquidity?

> Adding liquidity requires that the token has been approved in advance.
> User can add liquidity using `addLiquidity` function.

> It adds liquidity to an ERC-20⇄ERC-20 pool.

```javascript
function addLiquidity (address _token, uint256 _amount, address to)
```

_token: Token address

_amount: Token amount to add

to: Address to send LP token

> For adding ETH liquidity, use `addLiquidityETH` function.

> It adds liquidity to an ERC-20⇄WETH pool with ETH.

```javascript
function addLiquidityETH (address to)
```

## How to remove liquidity?
> User can remove liquidity using `removeLiquidity` function.

> It removes liquidity to an ERC-20⇄ERC-20 pool.

```javascript
function removeLiquidity (address _token,
    uint256 liquidity,
    address to, 
    uint256 minVcashOut, 
    uint256 minTokenOut)
```

_token: Token address

liquidity: Liquidity

to: Token amount to add

minVcashOut: The minimum amount of VCash that must be received

minTokenOut: The minimum amount of Token that must be received


> For removing ETH liquidity, use `removeLiquidityETH` function.

> It removes liquidity to an ERC-20⇄WETH pool with ETH.
## How to swap token?
> Swapping token requires that the token has been approved in advance.
> User can swap tokens using `swapExactTokenForToken` and `swapTokenForExactToken`.

```javascript
function swapExactTokenForToken(
    address tokenIn,
    address tokenOut,
    uint amountIn,
    uint amountOutMin,
    address to,
    uint deadline
  )
```
tokenIn: Input token address.

tokenOut: Output token address.

amountIn: The amount of input tokens to send.

amountOutMin: The minimum amount of output tokens that must be received for the transaction not to 
revert.

to: Recipient of the output tokens.

deadline: Unix timestamp after which the transaction will revert.

```javascript
 function swapTokenForExactToken(
    address tokenIn,
    address tokenOut,
    uint amountInMax,
    uint amountOut,
    address to,
    uint deadline
  )
```

tokenIn: Input token address.

tokenOut: Output token address.

amountInMax: The maximum amount of input tokens that can be required before the transaction reverts.

amountOut: The amount of output tokens to receive.

to: Recipient of the output tokens.

deadline: Unix timestamp after which the transaction will revert.

> For swapping ETH, use `swapExactETHForToken`, `swapExactTokenForETH`, `swapETHForExactToken`, `swapTokenForExactETH`

```javascript
function swapExactETHForToken(
    address tokenOut,
    uint amountOutMin,
    address to,
    uint deadline
  )
```

```javascript
function swapExactTokenForETH(
    address tokenIn,
    uint amountIn,
    uint amountOutMin,
    address to,
    uint deadline
  )
```

```javascript
function swapETHForExactToken(
    address tokenOut,
    uint amountInMax,
    uint amountOut,
    address to,
    uint deadline
  )
```

```javascript
function swapTokenForExactETH(
    address tokenIn,
    uint amountInMax,
    uint amountOut,
    address to,
    uint deadline
  )
```
