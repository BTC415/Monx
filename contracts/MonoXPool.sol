// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.7.6;

import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import '@uniswap/lib/contracts/libraries/TransferHelper.sol';
import './interfaces/IWETH.sol';

contract MonoXPool is Initializable, OwnableUpgradeable, ERC1155Upgradeable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    address public WETH;
    mapping (uint256 => uint256) public totalSupply;
    mapping (uint256 => uint256) public createdAt;
    mapping (uint256 => bool) public isUnofficial;
    mapping (uint256 => address) public topHolder;
    mapping (uint256 => mapping(address => uint256)) liquidityLastAdded;
    mapping (address => bool) whitelist;
    address public admin;
    address public router;

    function initialize(
      address _WETH
    ) public initializer {
      OwnableUpgradeable.__Ownable_init();
      ERC1155Upgradeable.__ERC1155_init("{1}");
      WETH = _WETH;
      admin = msg.sender;
    }

    modifier onlyAdmin() {
      require(admin == msg.sender, "MonoXPool:NOT_ADMIN");
      _;
    }

    modifier onlyOwnerOrRouter() {
      require(owner() == msg.sender || router == msg.sender, "MonoXPool:NOT_OWNER_ROUTER");
      _;
    }

    receive() external payable {
    }
    /**
     * @dev Sets a new URI for all token types, by relying on the token type ID
     * substitution mechanism
     * https://eips.ethereum.org/EIPS/eip-1155#metadata[defined in the EIP].
     *
     * For example, the `https://token-cdn-domain/\{id\}.json` URI would be
     * interpreted by clients as
     * `https://token-cdn-domain/000000000000000000000000000000000000000000000000000000000004cce0.json`
     * for token type ID 0x4cce0.
     
     */
    function setURI(string memory uri) external onlyAdmin {
      _setURI(uri);
    }

    function mintLp(address account, uint256 id, uint256 amount, bool _isUnofficial) public onlyOwner {
      if (createdAt[id] == 0) 
        createdAt[id] = block.timestamp;

      isUnofficial[id] = _isUnofficial;
      liquidityLastAdded[id][account] = block.timestamp;

      mint(account, id, amount);
      
      _trackTopHolder(id, account);
    }     

    function mint (address account, uint256 id, uint256 amount) public onlyOwner {
      totalSupply[id] = totalSupply[id].add(amount);
      _mint(account, id, amount, "");
    }                                

    // largest LP can't burn so no need to keep tracking here
    function burn (address account, uint256 id, uint256 amount) public onlyOwner {
      totalSupply[id] = totalSupply[id].sub(amount);
      _burn(account, id, amount);
    }

    function safeTransferFrom(
        address from,
        address to,
        uint256 id,
        uint256 amount,
        bytes memory data
    )
        public
        virtual
        override
    {
      if (!whitelist[from] && !whitelist[to]) {
        require(!isUnofficial[id] || from != topHolder[id] || createdAt[id] + 90 days <= block.timestamp, "MonoXPool:TOP HOLDER");
        if (isUnofficial[id])
          require(liquidityLastAdded[id][from] + 24 hours <= block.timestamp, "MonoXPool:WRONG_TIME");
        else 
          require(liquidityLastAdded[id][from] + 4 hours <= block.timestamp, "MonoXPool:WRONG_TIME");
        liquidityLastAdded[id][to] = block.timestamp;
      }

      super.safeTransferFrom(from, to, id, amount, data);
      
      _trackTopHolder(id, to);
    }

    function totalSupplyOf(uint256 pid) external view returns (uint256) {
      return totalSupply[pid];
    }

    function depositWETH(uint256 amount) external {
      IWETH(WETH).deposit{value: amount}();
    }

    function withdrawWETH(uint256 amount) external onlyOwnerOrRouter {
      IWETH(WETH).withdraw(amount);
    }

    function safeTransferETH(address to, uint amount) external onlyOwnerOrRouter {
      TransferHelper.safeTransferETH(to, amount);
    }

    function safeTransferERC20Token(address token, address to, uint256 amount) external onlyOwner{
      IERC20(token).safeTransfer(to, amount);
    }

    function setWhitelist(address _whitelist, bool _isWhitelist) external onlyAdmin {
      whitelist[_whitelist] = _isWhitelist;  
    }
    
    function liquidityLastAddedOf(uint256 pid, address account) external view returns (uint256) {
      return liquidityLastAdded[pid][account];
    }

    function topLPHolderOf(uint256 pid) external view returns (address) {
      return topHolder[pid];
    }

    function _trackTopHolder(uint256 id, address account) internal {
      if (!whitelist[account] && (isUnofficial[id] || createdAt[id] + 90 days > block.timestamp)) {
        uint256 liquidityAmount = balanceOf(account, id);
        uint256 topHolderAmount = topHolder[id] != address(0) ? balanceOf(topHolder[id], id) : 0;
        if (liquidityAmount > topHolderAmount) {
          topHolder[id] = account;
        }
      }
    }

    function setAdmin(address _admin) public onlyAdmin {
        admin = _admin;
    }

    function setRouter(address _router) public onlyAdmin {
        router = _router;
    }
}