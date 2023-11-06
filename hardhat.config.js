require("@nomiclabs/hardhat-truffle5");
require("@nomiclabs/hardhat-ethers");
require('@openzeppelin/hardhat-upgrades');
require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-web3");
require("dotenv/config")
require("@nomiclabs/hardhat-etherscan");
require("hardhat-gas-reporter");
require("solidity-coverage");
require('hardhat-contract-sizer');

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async () => {
  const accounts = await ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

task("set-official-pool", "Sets a pool to official")
  .addParam("monoswap", "MONO core's address")
  .addParam("pool", "pool token address")
  .setAction(async (args) => {

  const [deployer] = await ethers.getSigners();

  if(!(ethers.utils.isAddress(args.monoswap) && ethers.utils.isAddress(args.pool))){
    console.log(args)
    throw new Error("bad args");
  }

  console.log(
    "Deploying contracts with the account:",
    deployer.address
  );
  
  console.log("Account balance:", (await deployer.getBalance()).toString());
  
  const Monoswap = await ethers.getContractFactory("Monoswap");
  const monoswap = await Monoswap.attach(args.monoswap);
  await monoswap.updatePoolStatus(args.pool, 2);

  console.log("success");
})

task("set-whitelist", "Sets whitelist")
  .addParam("monoxpool", "MonoXPool's address")
  .addParam("staking", "pool token address")
  .setAction(async (args) => {

  const [deployer] = await ethers.getSigners();

  if(!(ethers.utils.isAddress(args.monoxpool) && ethers.utils.isAddress(args.staking))){
    console.log(args)
    throw new Error("bad args");
  }

  console.log(
    "Deploying contracts with the account:",
    deployer.address
  );
  
  console.log("Account balance:", (await deployer.getBalance()).toString());
  
  const MonoXPool = await ethers.getContractFactory("MonoXPool")
  const monoXPool = await MonoXPool.attach(args.monoxpool);
  await monoXPool.setWhitelist(args.staking, true)
  await monoXPool.setWhitelist(deployer.address, true) // deployer.address is owner

  console.log("success");
})

task("set-uri", "Sets URI")
  .addParam("monoxpool", "MonoXPool's address")
  .addParam("uri", "URI, Ex: https://token-cdn-domain/\{id\}.json")
  .setAction(async (args) => {
  
  if(!(ethers.utils.isAddress(args.monoxpool))){
    console.log(args)
    throw new Error("bad args");
  }
  const [deployer] = await ethers.getSigners();

  console.log(
    "Deploying contracts with the account:",
    deployer.address
  );
  
  console.log("Account balance:", (await deployer.getBalance()).toString());
  
  const MonoXPool = await ethers.getContractFactory("MonoXPool")
  const monoXPool = await MonoXPool.attach(args.monoxpool);
  await monoXPool.setURI(args.uri)

  console.log("success");
})

task("deploy-monoswap", "Deploy Monoswap contract")
  .addParam("vunit", "vUNIT's address")
  .setAction(async (args) => {

  if(!(ethers.utils.isAddress(args.vunit))){
    console.log(args)
    throw new Error("bad args");
  }

  const [deployer] = await ethers.getSigners()

  console.log(
    "Deploying contracts with the account:",
    deployer.address
  )
  
  console.log("Account balance:", (await deployer.getBalance()).toString())
  const network = await ethers.provider.getNetwork()
  const MonoXPool = await ethers.getContractFactory("MonoXPool")
  const Monoswap = await ethers.getContractFactory("Monoswap")
  const MonoswapRouter = await ethers.getContractFactory("MonoswapRouter")
  // const VCASH = await ethers.getContractFactory('VCASH')
  let WETH
  switch (network.chainId) {
    case 1: // mainnet
      WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
      break
    case 42: // kovan
      WETH = '0xd0A1E359811322d97991E03f863a0C30C2cF029C'
      break
    case 3: // ropsten
      WETH = '0xc778417e063141139fce010982780140aa0cd5ab'
      break
    case 4: // rinkeby
      WETH = '0xc778417e063141139fce010982780140aa0cd5ab'
      break
    case 5: // goerli
      WETH = '0xb4fbf271143f4fbf7b91a5ded31805e42b2208d6'
      break
    case 137: // polygon
      WETH = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'
      break
    case 80001: // mumbai
      WETH = '0x9c3C9283D3e44854697Cd22D3Faa240Cfb032889'
      break
    case 43113: // fuji
      WETH = '0xd00ae08403B9bbb9124bB305C09058E32C39A48c'
      break
    default:
      throw new Error("unknown network");
  }
  const vunit = args.vunit
  const monoXPool = await upgrades.deployProxy(MonoXPool, [WETH])
  console.log("MonoXPool address:", monoXPool.address)
  const monoswap = await upgrades.deployProxy(Monoswap, [monoXPool.address, vunit])
  console.log("Monoswap address:", monoswap.address)
  const monoswapRouter = await MonoswapRouter.deploy(monoswap.address)
  console.log("MonoswapRouter address:", monoswapRouter.address)

  await monoXPool.deployed()
  await monoswap.deployed()
  await monoswapRouter.deployed()

  await monoXPool.setAdmin(deployer.address)
  await monoXPool.transferOwnership(monoswap.address)
  await monoXPool.setRouter(monoswapRouter.address)
  await monoswap.setRouter(monoswapRouter.address)
  await monoswap.setFeeTo(deployer.address)
  
  
  const oz_monoswap = require("./.openzeppelin/" + (network.name === "unknown" ? network.name + "-" + network.chainId : network.name) + ".json")
  const implsLen = Object.keys(oz_monoswap.impls).length;
  const monoxpoolImplAddress = oz_monoswap.impls[Object.keys(oz_monoswap.impls)[implsLen - 2]].address
  console.log("MonoXPool Impl Address", monoxpoolImplAddress)

  const monoswapImplAddress = oz_monoswap.impls[Object.keys(oz_monoswap.impls)[implsLen - 1]].address
  console.log("Monoswap Impl Address", monoswapImplAddress)

  if (network.chainId == 43113) return
  
  try {
    await hre.run("verify:verify", {
      address: monoxpoolImplAddress,
      constructorArguments: [
      ],
    })
  } catch (e) {
    console.log(e)
  }
  
  try {
    await hre.run("verify:verify", {
      address: monoswapImplAddress,
      constructorArguments: [
      ],
    })  
  } catch (e) {
    console.log(e)
  }

  try {
    await hre.run("verify:verify", {
      address: monoswapRouter.address,
      constructorArguments: [
        monoswap.address
      ],
    })
  } catch(e) {
    console.log(e)
  }
  console.log("success");
})

task("upgrade-monoxpool", "Upgrade MonoXPool contract")
  .addParam("monoxpool", "MonoXPool's address")
  .setAction(async (args) => {

  if(!(ethers.utils.isAddress(args.monoxpool))){
    console.log(args)
    throw new Error("bad args");
  }

  const [deployer] = await ethers.getSigners()

  console.log(
    "Deploying contracts with the account:",
    deployer.address
  )
  
  console.log("Account balance:", (await deployer.getBalance()).toString())
  const network = (await ethers.provider.getNetwork())
  const MonoXPool = await ethers.getContractFactory("MonoXPool")

  const monoXPool = await upgrades.upgradeProxy(args.monoxpool, MonoXPool)
  console.log("MonoXPool address:", monoXPool.address)
  await monoXPool.deployed()
  
  const oz_monoswap = require("./.openzeppelin/" + (network.name === "unknown" ? network.name + "-" + network.chainId : network.name) + ".json")
  const implsLen = Object.keys(oz_monoswap.impls).length;
  const monoXPoolImplAddress = oz_monoswap.impls[Object.keys(oz_monoswap.impls)[implsLen-1]].address
  console.log("MonoXPool Impl Address", monoXPoolImplAddress)
  try {
    await hre.run("verify:verify", {
      address: monoXPoolImplAddress,
      constructorArguments: [
      ],
    })
  } catch (e) {
    console.log(e)
  }

  console.log("success");
})

task("upgrade-monoswap", "Upgrade Monoswap contract")
  .addParam("monoswap", "Monoswap's address")
  .setAction(async (args) => {

  if(!(ethers.utils.isAddress(args.monoswap))){
    console.log(args)
    throw new Error("bad args");
  }

  const [deployer] = await ethers.getSigners()

  console.log(
    "Deploying contracts with the account:",
    deployer.address
  )
  
  console.log("Account balance:", (await deployer.getBalance()).toString())
  const network = (await ethers.provider.getNetwork())
  const Monoswap = await ethers.getContractFactory("Monoswap")

  const monoswap = await upgrades.upgradeProxy(args.monoswap, Monoswap)
  console.log("Monoswap address:", monoswap.address)
  await monoswap.deployed()
  
  const oz_monoswap = require("./.openzeppelin/" + (network.name === "unknown" ? network.name + "-" + network.chainId : network.name) + ".json")
  const implsLen = Object.keys(oz_monoswap.impls).length;
  const monoswapImplAddress = oz_monoswap.impls[Object.keys(oz_monoswap.impls)[implsLen - 1]].address
  console.log("Monoswap Impl Address", monoswapImplAddress)
  try {
    await hre.run("verify:verify", {
      address: monoswapImplAddress,
      constructorArguments: [
      ],
    })
  } catch (e) {
    console.log(e)
  }

  console.log("success");
})

task("update-childchainmanager", "Deploy MonoswapStaking")
  .addParam("vcash", "vCASH token")
  .addParam("childchainmanager", "Child Chain Proxy Manager")
  .setAction(async (args) => {

  const [deployer] = await ethers.getSigners();

  if(!(ethers.utils.isAddress(args.vcash)) || !(ethers.utils.isAddress(args.childchainmanager))){
    console.log(args)
    throw new Error("bad args");
  }

  console.log(
    "Deploying contracts with the account:",
    deployer.address
  );
  
  console.log("Account balance:", (await deployer.getBalance()).toString());
  
  const vCASH = await ethers.getContractFactory("vCASH");
  const vcash = await vCASH.attach(args.vcash);
  
  await vcash.updateChildChainManager(args.childchainmanager)
  
  console.log("success");
})

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: {
    version: "0.7.6",
    settings: {
      optimizer: {
        enabled: true,
        runs: 20
      }
    }
  },
  networks: {
    hardhat: {
      accounts: {
        accountsBalance: '10000000000000000000000000000' // 10000000000 ETH
      }
    },
    ropsten: {
      url: `https://ropsten.infura.io/v3/${process.env.INFURA_PROJECT_ID}`,
      accounts: [`0x${process.env.PRIVATE_KEY}`]
    },
    kovan: {
      url: `https://kovan.infura.io/v3/${process.env.INFURA_PROJECT_ID}`,
      accounts: [`0x${process.env.PRIVATE_KEY}`]
    },
    rinkeby: {
      url: `https://rinkeby.infura.io/v3/${process.env.INFURA_PROJECT_ID}`,
      accounts: [`0x${process.env.PRIVATE_KEY}`]
    },
    goerli: {
      url: `https://goerli.infura.io/v3/${process.env.INFURA_PROJECT_ID}`,
      accounts: [`0x${process.env.PRIVATE_KEY}`]
    },
    mainnet: {
      url: `https://mainnet.infura.io/v3/${process.env.INFURA_PROJECT_ID}`,
      accounts: [`0x${process.env.PRIVATE_KEY}`]
    },
    mumbai: {
      url: "https://naughty-blackwell:waffle-sprawl-math-used-ripple-snarl@nd-311-035-380.p2pify.com",
      accounts: [`0x${process.env.PRIVATE_KEY}`]
    },
    matic: {
      url: "https://nd-484-955-811.p2pify.com/32d6df71df6498ecd235a9358e5cb831",
      accounts: [`0x${process.env.PRIVATE_KEY}`]
    },
    fuji: {
      url: "https://api.avax-test.network/ext/bc/C/rpc",
      chainId: 43113,
      accounts: [`0x${process.env.PRIVATE_KEY}`]
    }
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
    // apiKey: process.env.MATIC_API_KEY,
  },
  contractSizer: {
    alphaSort: true,
    runOnCompile: true,
    disambiguatePaths: false,
  },
};

