const hre = require("hardhat")
const { ethers, upgrades } = require("hardhat")
async function main() {
  
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
  const vunit = "0x3829Bb12b9d665a6b64A96186da27eA17389f57b";
  // const vcash = await VCASH.deploy()
  // console.log("VCASH address:", vcash.address)
  const monoXPool = await upgrades.deployProxy(MonoXPool, [WETH])
  console.log("MonoXPool address:", monoXPool.address)
  const monoswap = await upgrades.deployProxy(Monoswap, [monoXPool.address, vunit])
  console.log("Monoswap address:", monoswap.address)
  const monoswapRouter = await MonoswapRouter.deploy(monoswap.address)
  console.log("MonoswapRouter address:", monoswapRouter.address)

  // await vcash.deployed()
  await monoXPool.deployed()
  await monoswap.deployed()
  await monoswapRouter.deployed()

  // await vcash.setMinter(monoswap.address)
  // await vcash.setMinter(deployer.address)
  await monoXPool.setAdmin(deployer.address)
  await monoXPool.transferOwnership(monoswap.address)
  await monoXPool.setRouter(monoswapRouter.address)
  await monoswap.setFeeTo(deployer.address)
  
  
  const oz_monoswap = require("../.openzeppelin/" + (network.name === "unknown" ? network.name + "-" + network.chainId : network.name) + ".json")
  const implsLen = Object.keys(oz_monoswap.impls).length;
  const monoxpoolImplAddress = oz_monoswap.impls[Object.keys(oz_monoswap.impls)[implsLen - 2]].address
  console.log("MonoXPool Impl Address", monoxpoolImplAddress)

  const monoswapImplAddress = oz_monoswap.impls[Object.keys(oz_monoswap.impls)[implsLen - 1]].address
  console.log("Monoswap Impl Address", monoswapImplAddress)

  if (network.chainId == 43113) return
  
  // try {
  //   await hre.run("verify:verify", {
  //     address: vcash.address,
  //     constructorArguments: [
  //     ],
  //   })
  // } catch(e) {
  //   console.log(e)
  // }
  
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
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });