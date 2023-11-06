const { ethers, assert, upgrades } = require("hardhat");
const { expect } = require("chai");
const { expectRevert, time } = require('@openzeppelin/test-helpers');
const { deployContract, MockProvider, solidity } = require('ethereum-waffle');

const Web3 = require('web3');
const { BigNumber } = require("ethers");
const { utils } = Web3;

const e18 = 1 + '0'.repeat(18)
const e26 = 1 + '0'.repeat(26)
const e24 = 1 + '0'.repeat(24)

const bigNum = num=>(num + '0'.repeat(18))
const smallNum = num=>(parseInt(num)/bigNum(1))
const PoolStatus = {
    UNLISTED: 0,
    LISTED: 1,
    OFFICIAL: 2
}

const overrides = {
    gasLimit: 9500000
}
const DEFAULT_ETH_AMOUNT = 10000000000
describe('MonoX Core', function () {
    before(async function () {
        [
            this.owner, 
            this.alice,
            this.bob,
            this.carol,
            this.minter,
            this.dev,
            ...addrs
          ] = await ethers.getSigners();
        this.Monoswap = await ethers.getContractFactory('Monoswap');
        this.MonoswapRouter = await ethers.getContractFactory('MonoswapRouter');
        this.MockERC20 = await ethers.getContractFactory('MockERC20');
        this.WETH9 = await ethers.getContractFactory('WETH9');
        this.vCASH = await ethers.getContractFactory('VCASH');
        this.MonoXPool = await ethers.getContractFactory('MonoXPool');
    })
    
    beforeEach(async function () {
        this.weth = await this.WETH9.deploy();
        this.yfi = await this.MockERC20.deploy('YFI', 'YFI', e26);
        this.dai = await this.MockERC20.deploy('Dai', 'DAI', e26);
        this.uni = await this.MockERC20.deploy('UNI', 'UNI', e26);
        this.aave = await this.MockERC20.deploy('Aave','AAVE',e26); // used to test if exploit is possible at low value of the pool
        this.comp = await this.MockERC20.deploy('Compound','COMP',e26); 
        this.vcash = await this.vCASH.deploy();

        await this.weth.deposit({value: bigNum(100000000)})
        await this.weth.transfer(this.alice.address, bigNum(10000000))
        await this.yfi.transfer(this.alice.address, bigNum(10000000))
        await this.dai.transfer(this.alice.address, bigNum(10000000))
        await this.uni.transfer(this.alice.address, bigNum(10000000))
        await this.aave.transfer(this.alice.address, bigNum(10000000))  //alice will initiate the pool
        await this.comp.transfer(this.alice.address, bigNum(10000000))

        await this.weth.transfer( this.bob.address, bigNum(10000000))
        await this.yfi.transfer( this.bob.address, bigNum(10000000))
        await this.dai.transfer( this.bob.address, bigNum(10000000))
        await this.uni.transfer( this.bob.address, bigNum(10000000))
        await this.aave.transfer(this.bob.address, bigNum(10000000))  //bob will sell and take the price down
        await this.comp.transfer(this.bob.address, bigNum(10000000))  
        this.monoXPool = await upgrades.deployProxy(this.MonoXPool, [this.weth.address],{unsafeAllowLinkedLibraries:true})
        this.pool = await upgrades.deployProxy(this.Monoswap, [this.monoXPool.address, this.vcash.address],{unsafeAllowLinkedLibraries:true})
        this.router = await this.MonoswapRouter.deploy(this.pool.address)
        this.vcash.setMinter(this.pool.address)
        this.vcash.setMinter(this.minter.address)
        this.monoXPool.setAdmin(this.minter.address)
        this.monoXPool.transferOwnership(this.pool.address)
        this.monoXPool.connect(this.minter).setRouter(this.router.address)
        this.pool.setRouter(this.router.address)
        this.pool.setFeeTo(this.dev.address)

        const timestamp = (await time.latest()) + 10000;

        await this.weth.connect(this.alice).approve(this.pool.address, e26);
        await this.yfi.connect(this.alice).approve(this.pool.address, e26);
        await this.dai.connect(this.alice).approve(this.pool.address, e26);
        await this.uni.connect(this.alice).approve(this.pool.address, e26);
        await this.aave.connect(this.alice).approve(this.pool.address, e26);    //alice approval
        await this.aave.approve(this.pool.address, e26);    //owner approval
        await this.vcash.connect(this.alice).approve(this.pool.address, e26);
        await this.comp.connect(this.alice).approve(this.pool.address, e26);

        await this.weth.connect(this.bob).approve(this.pool.address, e26);
        await this.yfi.connect(this.bob).approve(this.pool.address, e26);
        await this.dai.connect(this.bob).approve(this.pool.address, e26);
        await this.uni.connect(this.bob).approve(this.pool.address, e26);
        await this.vcash.connect(this.bob).approve(this.pool.address, e26);
        await this.aave.connect(this.bob).approve(this.pool.address, e26);    //bob approval
        await this.comp.connect(this.bob).approve(this.pool.address, e26);

        await this.pool.addSpecialToken(this.weth.address, bigNum(300), 2)
        await this.pool.addSpecialToken(this.dai.address, bigNum(1), 2)
        await this.pool.addSpecialToken(this.aave.address, bigNum(100), 3)    // aave price starts at 100
        await this.pool.addSpecialToken(this.uni.address, bigNum(30), 2)
        await this.pool.addSpecialToken(this.comp.address, bigNum(30), 1) // unofficial pool

        await this.router.connect(this.alice).addLiquidity(this.weth.address, 
            bigNum(500000), this.alice.address);
        await this.router.connect(this.alice).addLiquidityETH(
            this.alice.address,
            { ...overrides, value: bigNum(500000) }
            );
            
        await this.router.connect(this.alice).addLiquidity(this.dai.address, 
            bigNum(1000000), this.alice.address);

        await this.router.connect(this.alice).addLiquidity(this.aave.address, 
            bigNum(1000), this.alice.address);       // 1000 aave is added by alice

        await this.router.connect(this.alice).addLiquidity(this.uni.address, 
            bigNum(1000000), this.alice.address);

        await this.router.connect(this.alice).addLiquidity(this.comp.address, 
            bigNum(1000000), this.alice.address);
    })

    it("should set correct state variables", async function () {
        const config = await this.pool.getConfig()
        expect(config._vCash).to.equal(this.vcash.address)
        expect(config._feeTo).to.equal(this.dev.address)
        expect(config._fees).to.equal(300)
        expect(config._devFee).to.equal(50)
    });

    it("should set fees", async function () {
        await expect(this.pool.setFees(1000)).to.be.revertedWith("")
        this.pool.setFees(300)
    });

    it("should set dev fee", async function () {
        await expect(this.pool.setDevFee(1000)).to.be.revertedWith("")
        this.pool.setDevFee(50)
    });

    it('should set uri successfully', async function () {
        await this.monoXPool.connect(this.minter).setURI("https://token-cdn-domain/\{id\}.json")
        expect(await this.monoXPool.uri(0)).to.equal("https://token-cdn-domain/\{id\}.json")
    });

    it('should add liquidity successfully', async function () {
        let ethPool = await this.pool.pools(this.weth.address);
        expect(await ethPool.price.toString()).to.equal(bigNum(300))

        await this.router.connect(this.bob).addLiquidity(this.weth.address, 
            bigNum(1000000),  this.bob.address);

        ethPool = await this.pool.pools(this.weth.address);
        expect(await ethPool.price.toString()).to.equal(bigNum(300))

        let uniPool = await this.pool.pools(this.uni.address);
        expect(await uniPool.price.toString()).to.equal(bigNum(30))

        await this.router.connect(this.bob).addLiquidity(this.uni.address, 
            bigNum(1000000),  this.bob.address);

        uniPool = await this.pool.pools(this.uni.address);
        expect(await uniPool.price.toString()).to.equal(bigNum(30))
    });

    it('should purchase and sell ERC-20 successfully', async function () {

        const deadline = (await time.latest()) + 10000

        await expect(this.router.connect(this.bob).swapExactTokenForToken(
            this.weth.address, this.dai.address, 
            bigNum(2), bigNum(600), this.bob.address, deadline)).to.be.revertedWith("MonoswapRouter:INSUFF_OUTPUT")

        await expect(this.router.connect(this.bob).swapExactTokenForToken(
            this.weth.address, this.dai.address, 
            0, bigNum(400), this.bob.address, deadline)).to.be.revertedWith("MonoX:INSUFF_INPUT")

        await this.router.connect(this.bob).swapExactTokenForToken(
            this.weth.address, this.dai.address, 
            bigNum(2), bigNum(400), this.bob.address, deadline)

        const ethAmount = await this.weth.balanceOf(this.bob.address)
        const daiAmount = await this.dai.balanceOf(this.bob.address)

        const ethPool = await this.pool.pools(this.weth.address);

        const daiPool = await this.pool.pools(this.dai.address);
        expect(smallNum(await ethAmount.toString())).to.equal(10000000 - 2)
        expect(smallNum(await daiAmount.toString())-10000000).to.greaterThan(550)
        expect(smallNum(await daiAmount.toString())-10000000).to.lessThan(600)

        expect(smallNum(await daiPool.price.toString())).to.greaterThan(1)
        expect(smallNum(await daiPool.price.toString())).to.lessThan(2)

        expect(smallNum(await ethPool.price.toString())).to.greaterThan(200)
        expect(smallNum(await ethPool.price.toString())).to.lessThan(300)

    });

    it('should purchase and sell ERC-20 successfully - 2', async function () {

        const deadline = (await time.latest()) + 10000
        this.pool.setTokenStatus(this.uni.address, 2)
        await this.router.connect(this.bob).swapExactTokenForToken(
            this.uni.address, this.dai.address, 
            bigNum(2), bigNum(55), this.bob.address, deadline)

        const uniAmount = await this.uni.balanceOf(this.bob.address)
        const daiAmount = await this.dai.balanceOf(this.bob.address)

        const uniPool = await this.pool.pools(this.uni.address);

        const daiPool = await this.pool.pools(this.dai.address);
        expect(smallNum(await uniAmount.toString())).to.equal(10000000 - 2)
        expect(smallNum(await daiAmount.toString())-10000000).to.greaterThan(55)
        expect(smallNum(await daiAmount.toString())-10000000).to.lessThan(60)

        expect(smallNum(await daiPool.price.toString())).to.greaterThan(1)
        expect(smallNum(await daiPool.price.toString())).to.lessThan(2)

        expect(smallNum(await uniPool.price.toString())).to.greaterThan(20)
        expect(smallNum(await uniPool.price.toString())).to.lessThan(30)

    });

    it('should purchase and sell vCASH successfully', async function () {

        const deadline = (await time.latest()) + 10000

        await this.router.connect(this.bob).swapExactTokenForToken(
            this.uni.address, this.vcash.address, 
            bigNum(20), bigNum(400),  this.bob.address, deadline)

        let vcashbob0 = smallNum((await this.vcash.balanceOf(this.bob.address)).toString())

        expect(vcashbob0).to.greaterThan(550)
        expect(vcashbob0).to.lessThan(600)
        
        let uniPool = await this.pool.pools(this.uni.address)
        let uniPrice0 = smallNum(uniPool.price.toString())

        expect(uniPrice0).to.greaterThan(20)
        expect(uniPrice0).to.lessThan(30)


        await expect(this.router.connect(this.bob).swapTokenForExactToken(
            this.vcash.address, this.uni.address, 
            bigNum(300), bigNum(10),  this.bob.address, deadline)).to.be.revertedWith("MonoswapRouter:EXCESSIVE_INPUT")

        await this.router.connect(this.bob).swapTokenForExactToken(
            this.vcash.address, this.uni.address, 
            bigNum(350), bigNum(10),  this.bob.address, deadline)

        let vcashbob1 = smallNum((await this.vcash.balanceOf( this.bob.address)).toString())

        expect(vcashbob0-vcashbob1).to.greaterThan(300)
        expect(vcashbob0-vcashbob1).to.lessThan(302)

        uniPool = await this.pool.pools(this.uni.address)
        const uniPrice1 = smallNum(uniPool.price.toString())
        expect(uniPrice0).to.lessThan(uniPrice1)
    });

    it('should purchase and sell vCASH successfully - 2', async function () {

        const deadline = (await time.latest()) + 10000

        await this.router.connect(this.bob).swapTokenForExactToken(
            this.uni.address, this.vcash.address, 
            bigNum(20), bigNum(400),  this.bob.address, deadline)

        let vcashbob0 = smallNum((await this.vcash.balanceOf(this.bob.address)).toString())

        expect(vcashbob0).to.equal(400)
        
        let uniPool = await this.pool.pools(this.uni.address)
        let uniPrice0 = smallNum(uniPool.price.toString())

        expect(uniPrice0).to.greaterThan(20)
        expect(uniPrice0).to.lessThan(30)

        await this.router.connect(this.bob).swapExactTokenForToken(
            this.vcash.address, this.uni.address, 
            bigNum(350), bigNum(10),  this.bob.address, deadline)

        let vcashbob1 = smallNum((await this.vcash.balanceOf( this.bob.address)).toString())

        expect(vcashbob0-vcashbob1).to.equal(350)

        uniPool = await this.pool.pools(this.uni.address)
        const uniPrice1 = smallNum(uniPool.price.toString())
        expect(uniPrice0).to.lessThan(uniPrice1)
    });

    it('should remove liquidity successfully', async function () {

        const deadline = (await time.latest()) + 10000

        await this.router.connect(this.bob).swapExactTokenForToken(
            this.dai.address, this.weth.address, 
            bigNum(15000), bigNum(45),  this.bob.address, deadline)
        const liquidity = (await this.monoXPool.balanceOf(this.alice.address, 0)).toString()

        console.log('liquidity', liquidity);
        await expect(this.router.connect(this.alice).removeLiquidity(
            this.weth.address, liquidity, this.alice.address, 0, 0))
            .to.be.revertedWith("MonoX:WRONG_TIME") // remove liquidity after add liquidity
        await time.increase(60 * 60 * 4)
        const results = await this.router.connect(this.alice).removeLiquidity(
            this.weth.address, liquidity, this.alice.address, 0, 0);

        let vcashAmount = await this.vcash.balanceOf(this.alice.address)

        expect(smallNum(vcashAmount.toString())).to.greaterThan(50*250)
        expect(smallNum(vcashAmount.toString())).to.lessThan(50*300)

        let devFee = await this.vcash.balanceOf(this.dev.address)
        console.log(smallNum(devFee.toString()))
    });

    it('should add and remove liquidity successfully', async function () {

        const deadline = (await time.latest()) + 10000

        await this.router.connect(this.bob).swapExactTokenForToken(
            this.dai.address, this.uni.address, 
            bigNum(15000), bigNum(450),  this.bob.address, deadline)

        await this.router.connect(this.bob).addLiquidity(this.uni.address, 
            bigNum(1000000),  this.bob.address);
        const liquidity = (await this.monoXPool.balanceOf(this.alice.address, 3)).toString()

        console.log('liquidity', liquidity);
        await expect(this.router.connect(this.alice).removeLiquidity(
            this.comp.address, liquidity, this.alice.address, 0, 0))
            .to.be.revertedWith("MonoX:WRONG_TIME")
        await time.increase(60 * 60 * 24)
        const results = await this.router.connect(this.alice).removeLiquidity(
            this.uni.address, liquidity, this.alice.address, 0, 0);

        let vcashAmount = await this.vcash.balanceOf(this.alice.address)

        expect(smallNum(vcashAmount.toString())).to.greaterThan(500*25/2)
        expect(smallNum(vcashAmount.toString())).to.lessThan(500*30/2)

        let devFee = await this.vcash.balanceOf(this.dev.address)
        console.log(smallNum(devFee.toString()))
    });

    it('should add and remove liquidity ETH successfully', async function () {

        const deadline = (await time.latest()) + 10000
        const initialEthAmount = await ethers.provider.getBalance(this.bob.address)
        await this.router.connect(this.bob).addLiquidityETH( 
            this.bob.address,
            { ...overrides, value: bigNum(1000000) }
            );
        const liquidity = (await this.monoXPool.balanceOf(this.bob.address, 0)).toString()
        await time.increase(60 * 60 * 24)
        const results = await this.router.connect(this.bob).removeLiquidityETH(
            liquidity, this.bob.address, 0, 0);

        let vcashAmount = await this.vcash.balanceOf(this.bob.address)
        const ethAmount = await ethers.provider.getBalance(this.bob.address)
        expect(smallNum(initialEthAmount.toString()) - smallNum(ethAmount.toString())).to.lessThan(1) // consider gas fee
        expect(smallNum(vcashAmount.toString())).to.equal(0)
    });

    it('should list new tokens successfully', async function () {

        const deadline = (await time.latest()) + 10000

        await this.pool.connect(this.bob).listNewToken(
            this.yfi.address, bigNum(20000), 
            0, bigNum(20),  this.bob.address)

        const yfiAlice0 = smallNum((await this.yfi.balanceOf(this.alice.address)).toString())
        const daiAlice0 = smallNum((await this.dai.balanceOf(this.alice.address)).toString())

        let yfiPool = await this.pool.pools(this.yfi.address)
        const yfiPrice0 = smallNum(yfiPool.price.toString())

        await this.router.connect(this.alice).swapTokenForExactToken(
            this.dai.address, this.yfi.address, 
            bigNum(30000), bigNum(1), this.alice.address, deadline)

        const yfiAlice1 = smallNum((await this.yfi.balanceOf(this.alice.address)).toString())
        const daiAlice1 = smallNum((await this.dai.balanceOf(this.alice.address)).toString())
        expect((yfiAlice1-yfiAlice0).toPrecision(1)).to.equal('1')
        expect(daiAlice0-daiAlice1).to.greaterThan(20000)
        expect(daiAlice0-daiAlice1).to.lessThan(22000)

        yfiPool = await this.pool.pools(this.yfi.address)
        const yfiPrice1 = smallNum(yfiPool.price.toString())

        expect(yfiPrice1).to.greaterThan(yfiPrice0)
        console.log('yfi', yfiPrice1, yfiPrice0)
        
    });

    it('update pool status successfully', async function () {
        await this.pool.updatePoolStatus(this.weth.address, PoolStatus.LISTED) 
        let ethPool = await this.pool.pools(this.weth.address)
        expect(ethPool.status).to.equal(PoolStatus.LISTED)

        await this.pool.updatePoolStatus(this.dai.address, PoolStatus.UNLISTED) 
        let daiPool = await this.pool.pools(this.dai.address)
        expect(daiPool.status).to.equal(PoolStatus.UNLISTED)
    });

    it('should purchase and sell ETH successfully - swapExactETHForToken', async function () {
        const deadline = (await time.latest()) + 10000
        const initialEthAmount = await ethers.provider.getBalance(this.bob.address)

        await expect(this.router.connect(this.bob).swapExactETHForToken(this.dai.address, 
            bigNum(600), this.bob.address, deadline, 
            { ...overrides, value: bigNum(2) }
            )).to.be.revertedWith("MonoswapRouter:INSUFF_OUTPUT")

        await this.router.connect(this.bob).swapExactETHForToken(this.dai.address, 
            bigNum(400), this.bob.address, deadline, 
            { ...overrides, value: bigNum(2) }
            )

        const daiAmount = await this.dai.balanceOf(this.bob.address)
        const wethAmount = await this.weth.balanceOf(this.monoXPool.address)

        const ethPool = await this.pool.pools(this.weth.address)
        const ethAmount = await ethers.provider.getBalance(this.bob.address)
        

        const daiPool = await this.pool.pools(this.dai.address);
        expect(smallNum(await daiAmount.toString())-10000000).to.greaterThan(550)
        expect(smallNum(await daiAmount.toString())-10000000).to.lessThan(600)
        expect(smallNum(initialEthAmount.toString()) - smallNum(ethAmount.toString())).to.greaterThan(2)
        expect(smallNum(initialEthAmount.toString()) - smallNum(ethAmount.toString())).to.lessThan(3)
        expect(smallNum(await wethAmount.toString())).to.greaterThan(1000000)   //internal rebalancing happens
        expect(smallNum(await wethAmount.toString())).to.lessThan(1000001)

        expect(smallNum(await daiPool.price.toString())).to.greaterThan(1)
        expect(smallNum(await daiPool.price.toString())).to.lessThan(2)

        expect(smallNum(await ethPool.price.toString())).to.greaterThan(200)
        expect(smallNum(await ethPool.price.toString())).to.lessThan(300)
    });

    it('should purchase and sell ETH successfully - swapExactETHForToken - 2', async function () {
        const deadline = (await time.latest()) + 10000
        const initialEthAmount = await ethers.provider.getBalance(this.bob.address)

        await this.router.connect(this.bob).swapExactETHForToken(this.dai.address, 
            bigNum(200), this.bob.address, deadline, 
            { ...overrides, value: bigNum(1) }
            )

        const daiAmount = await this.dai.balanceOf(this.bob.address)
        const wethAmount = await this.weth.balanceOf(this.monoXPool.address)

        const ethPool = await this.pool.pools(this.weth.address)
        const ethAmount = await ethers.provider.getBalance(this.bob.address)
        

        const daiPool = await this.pool.pools(this.dai.address);
        expect(smallNum(await daiAmount.toString())-10000000).to.greaterThan(250)
        expect(smallNum(await daiAmount.toString())-10000000).to.lessThan(300)
        expect(smallNum(initialEthAmount.toString()) - smallNum(ethAmount.toString())).to.greaterThan(0.99)
        expect(smallNum(initialEthAmount.toString()) - smallNum(ethAmount.toString())).to.lessThan(2)
        expect(smallNum(await wethAmount.toString())).to.greaterThan(1000000)       //internal rebalancing happens
        expect(smallNum(await wethAmount.toString())).to.lessThan(1000000.002)

        expect(smallNum(await daiPool.price.toString())).to.greaterThan(1)
        expect(smallNum(await daiPool.price.toString())).to.lessThan(2)

        expect(smallNum(await ethPool.price.toString())).to.greaterThan(200)
        expect(smallNum(await ethPool.price.toString())).to.lessThan(300)
    });

    it('should purchase and sell ERC-20 successfully - swapETHForExactToken', async function () {
        const deadline = (await time.latest()) + 10000
        const initialEthAmount = await ethers.provider.getBalance(this.bob.address)
        
        await expect(this.router.connect(this.bob).swapETHForExactToken(
            this.dai.address, 
            bigNum(1), bigNum(590), this.bob.address, deadline,
            { ...overrides, value: bigNum(2) }
            )).to.be.revertedWith("MonoX:EXCESSIVE_INPUT")

        await expect(this.router.connect(this.bob).swapETHForExactToken(
            this.dai.address, 
            bigNum(1), 0, this.bob.address, deadline,
            { ...overrides, value: bigNum(2) }
            )).to.be.revertedWith("MonoX:INSUFF_INPUT")
        
        await this.router.connect(this.bob).swapETHForExactToken(
            this.dai.address, 
            bigNum(2), bigNum(590), this.bob.address, deadline,
            { ...overrides, value: bigNum(2) }
            )
        
        const daiAmount = await this.dai.balanceOf(this.bob.address)
        const wethAmount = await this.weth.balanceOf(this.monoXPool.address)

        const ethPool = await this.pool.pools(this.weth.address)
        const ethAmount = await ethers.provider.getBalance(this.bob.address)

        const daiPool = await this.pool.pools(this.dai.address);
        expect(smallNum(await daiAmount.toString())-10000000).to.greaterThan(550)
        expect(smallNum(await daiAmount.toString())-10000000).to.lessThan(600)
        
        expect(smallNum(initialEthAmount.toString()) - smallNum(ethAmount.toString())).to.greaterThan(1.9)
        expect(smallNum(initialEthAmount.toString()) - smallNum(ethAmount.toString())).to.lessThan(2)
        expect(smallNum(await wethAmount.toString())).to.greaterThan(1000000 - 1)
        expect(smallNum(await wethAmount.toString())).to.lessThan(1000000 + 2)

        expect(smallNum(await daiPool.price.toString())).to.greaterThan(1)
        expect(smallNum(await daiPool.price.toString())).to.lessThan(2)

        expect(smallNum(await ethPool.price.toString())).to.greaterThan(200)
        expect(smallNum(await ethPool.price.toString())).to.lessThan(300)
    });

    it('should purchase and sell ERC-20 successfully - swapETHForExactToken - 2', async function () {
        const deadline = (await time.latest()) + 10000
        const initialEthAmount = await ethers.provider.getBalance(this.bob.address)

        await this.router.connect(this.bob).swapETHForExactToken(
            this.dai.address, 
            bigNum(1), bigNum(295), this.bob.address, deadline,
            { ...overrides, value: bigNum(2) }
            )
        
        const daiAmount = await this.dai.balanceOf(this.bob.address)
        const wethAmount = await this.weth.balanceOf(this.bob.address)

        const ethPool = await this.pool.pools(this.weth.address)
        const ethAmount = await ethers.provider.getBalance(this.bob.address)

        const daiPool = await this.pool.pools(this.dai.address);
        expect(smallNum(await daiAmount.toString())-10000000).to.greaterThan(250)
        expect(smallNum(await daiAmount.toString())-10000000).to.lessThan(300)
        
        expect(smallNum(initialEthAmount.toString()) - smallNum(ethAmount.toString())).to.greaterThan(0.9)
        expect(smallNum(initialEthAmount.toString()) - smallNum(ethAmount.toString())).to.lessThan(1)
        expect(smallNum(await wethAmount.toString())).to.equal(10000000)

        expect(smallNum(await daiPool.price.toString())).to.greaterThan(1)
        expect(smallNum(await daiPool.price.toString())).to.lessThan(2)

        expect(smallNum(await ethPool.price.toString())).to.greaterThan(200)
        expect(smallNum(await ethPool.price.toString())).to.lessThan(300)
    });

    it('should purchase and sell ERC-20 successfully - swapExactTokenForETH', async function () {
        const deadline = (await time.latest()) + 10000
        const initialEthAmount = await ethers.provider.getBalance(this.bob.address)
        
        await expect(this.router.connect(this.bob).swapExactTokenForETH(
            this.dai.address, 
            bigNum(610), bigNum(3), this.bob.address, deadline)).to.be.revertedWith("MonoX:INSUFF_OUTPUT")
            
        await this.router.connect(this.bob).swapExactTokenForETH(
            this.dai.address, 
            bigNum(610), bigNum(2), this.bob.address, deadline)
        
        const daiAmount = await this.dai.balanceOf(this.bob.address)
        const wethAmount = await this.weth.balanceOf(this.monoXPool.address)

        const ethPool = await this.pool.pools(this.weth.address)
        const ethAmount = await ethers.provider.getBalance(this.bob.address)
        const daiPool = await this.pool.pools(this.dai.address);
        expect(10000000 - smallNum(await daiAmount.toString())).to.equal(610)
        expect(smallNum(ethAmount.toString()) - smallNum(initialEthAmount.toString())).to.greaterThan(2)
        expect(smallNum(ethAmount.toString()) - smallNum(initialEthAmount.toString())).to.lessThan(3)
        expect(smallNum(await wethAmount.toString())).to.lessThan(1000000 - 2)
        expect(smallNum(await wethAmount.toString())).to.greaterThan(1000000 - 3)
        expect(smallNum(await daiPool.price.toString())).to.greaterThan(0.999)
        expect(smallNum(await daiPool.price.toString())).to.lessThan(1)
        expect(smallNum(await ethPool.price.toString())).to.greaterThan(300)
    });

    it('should purchase and sell ERC-20 successfully - swapExactTokenForETH - 2', async function () {
        const deadline = (await time.latest()) + 10000
        const initialEthAmount = await ethers.provider.getBalance(this.bob.address)
        await this.router.connect(this.bob).swapExactTokenForETH(
            this.dai.address, 
            bigNum(305), bigNum(1), this.bob.address, deadline)
        
        const daiAmount = await this.dai.balanceOf(this.bob.address)
        const wethAmount = await this.weth.balanceOf(this.monoXPool.address)

        const ethPool = await this.pool.pools(this.weth.address)
        const ethAmount = await ethers.provider.getBalance(this.bob.address)
        const daiPool = await this.pool.pools(this.dai.address);
        expect(10000000 - smallNum(await daiAmount.toString())).to.equal(305)
        expect(smallNum(ethAmount.toString()) - smallNum(initialEthAmount.toString())).to.greaterThan(1)
        expect(smallNum(ethAmount.toString()) - smallNum(initialEthAmount.toString())).to.lessThan(2)
        expect(smallNum(await wethAmount.toString())).to.lessThan(1000000 - 1)
        expect(smallNum(await wethAmount.toString())).to.greaterThan(1000000 - 2)
        expect(smallNum(await daiPool.price.toString())).to.greaterThan(0.999)
        expect(smallNum(await daiPool.price.toString())).to.lessThan(1)
        expect(smallNum(await ethPool.price.toString())).to.greaterThan(300)
    });
    
    it('should purchase and sell ERC-20 successfully - swapTokenforExactETH', async function () {
        const deadline = (await time.latest()) + 10000
        const initialEthAmount = await ethers.provider.getBalance(this.bob.address)

        await expect(this.router.connect(this.bob).swapTokenForExactETH(
            this.dai.address, 
            bigNum(500), bigNum(2), this.bob.address, deadline)).to.be.revertedWith("MonoX:EXCESSIVE_INPUT")

        await this.router.connect(this.bob).swapTokenForExactETH(
            this.dai.address, 
            bigNum(610), bigNum(2), this.bob.address, deadline)
        
        const daiAmount = await this.dai.balanceOf(this.bob.address)
        const wethAmount = await this.weth.balanceOf(this.monoXPool.address)

        const ethPool = await this.pool.pools(this.weth.address)
        const ethAmount = await ethers.provider.getBalance(this.bob.address)
        const daiPool = await this.pool.pools(this.dai.address);
        expect(smallNum(await daiAmount.toString())-10000000).to.greaterThan(-610)
        expect(smallNum(await daiAmount.toString())-10000000).to.lessThan(-600)
        expect(smallNum(ethAmount.toString()) - smallNum(initialEthAmount.toString())).to.greaterThan(1.9)
        expect(smallNum(ethAmount.toString()) - smallNum(initialEthAmount.toString())).to.lessThanOrEqual(2)
        expect(smallNum(await wethAmount.toString())).to.equal(1000000 - 2)
        expect(smallNum(await daiPool.price.toString())).to.greaterThan(0.999)
        expect(smallNum(await daiPool.price.toString())).to.lessThan(1)

        expect(smallNum(await ethPool.price.toString())).to.greaterThan(300)
    });

    it('should purchase and sell ERC-20 successfully - swapTokenforExactETH - 2', async function () {
        const deadline = (await time.latest()) + 10000
        const initialEthAmount = await ethers.provider.getBalance(this.bob.address)
        await this.router.connect(this.bob).swapTokenForExactETH(
            this.dai.address, 
            bigNum(305), bigNum(1), this.bob.address, deadline)
        
        const daiAmount = await this.dai.balanceOf(this.bob.address)
        const wethAmount = await this.weth.balanceOf(this.monoXPool.address)

        const ethPool = await this.pool.pools(this.weth.address)
        const ethAmount = await ethers.provider.getBalance(this.bob.address)
        const daiPool = await this.pool.pools(this.dai.address);
        expect(smallNum(await daiAmount.toString())-10000000).to.greaterThan(-305)
        expect(smallNum(await daiAmount.toString())-10000000).to.lessThan(-300)
        expect(smallNum(ethAmount.toString()) - smallNum(initialEthAmount.toString())).to.greaterThan(0.9)
        expect(smallNum(ethAmount.toString()) - smallNum(initialEthAmount.toString())).to.lessThanOrEqual(1)
        expect(smallNum(await wethAmount.toString())).to.equal(1000000 - 1)
        expect(smallNum(await daiPool.price.toString())).to.greaterThan(0.999)
        expect(smallNum(await daiPool.price.toString())).to.lessThan(1)

        expect(smallNum(await ethPool.price.toString())).to.greaterThan(300)
    });

    it('should prevent the owner from altering the price of an active pair in the last 6000 blocks', async function () {
        await expectRevert(
            this.pool.updatePoolPrice(this.weth.address, 0),
            'MonoX:0_PRICE',
          );
        
        await expectRevert(
            this.pool.updatePoolPrice(this.vcash.address, bigNum(1)),
            'MonoX:NO_POOL',
            );
        await expectRevert(
            this.pool.updatePoolPrice(this.weth.address, bigNum(30)),
            'MonoX:TOO_EARLY',
          );
    });

    it('should update last trading block for every trading', async function() {
        const deadline = (await time.latest()) + 10000
        let recipt = await this.router.connect(this.bob).swapTokenForExactETH(
            this.dai.address, 
            bigNum(305), bigNum(1), this.bob.address, deadline)
        
        let blockNumber = recipt.blockNumber
        let lastTradedBlock = await this.pool.lastTradedBlock(this.dai.address)
        assert(lastTradedBlock.eq(blockNumber))
    })

    it('should allow the admin update pool price after 6000 blocks', async function() {
        this.timeout(0);
        const deadline = (await time.latest()) + 10000
        let recipt = await this.router.connect(this.bob).swapTokenForExactETH(
            this.dai.address, 
            bigNum(305), bigNum(1), this.bob.address, deadline)
        
        let blockNumber = recipt.blockNumber
        await time.advanceBlockTo(blockNumber + 6001)
        this.pool.updatePoolPrice(this.dai.address, bigNum(2))
        let poolinfo = await this.pool.pools(this.dai.address)
        assert(poolinfo.price.eq(bigNum(2)))
    })
    it('should not remove all liquidity from the contract via exploit', async function () {
        
        const deadline = (await time.latest()) + 10000
        
        const bobAAVEBefore=await this.aave.balanceOf(this.bob.address);

        //exploit begins
        //pool has 1000 aave with 100$ price
        //prerequisites: 2246.57 + 100 AAVE

        await this.router.connect(this.bob).swapExactTokenForETH(
            this.aave.address, 
            "2246570000000000000000", bigNum(2), this.bob.address, deadline)        // huge sellof so that the pool value is 0.0589351766$ after sale

        const bobETHAfterSale =await ethers.provider.getBalance(this.bob.address);

        const bobAaveLPBefore = (await this.monoXPool.balanceOf(this.bob.address, 2)).toString();

        await this.router.connect(this.bob).addLiquidity(this.aave.address, 
            bigNum(100), this.bob.address);       // 100 aave is added by bob

        const bobAaveLPAfter = (await this.monoXPool.balanceOf(this.bob.address, 2)).toString();

        await this.router.connect(this.bob).swapETHForExactToken(
            this.aave.address, 
            bigNum(1000),"2246570000000000000000", this.bob.address, deadline,
            { ...overrides, value: bigNum(1000) }
            )

        console.log('liquidity before/after',bobAaveLPBefore,bobAaveLPAfter);   //we can see bob now has a huge number of lp
        await time.increase(60 * 60 * 24)
        await this.router.connect(this.bob).removeLiquidity(
            this.aave.address, bobAaveLPAfter, this.bob.address, 0, 0);

        // const bobAAVEAfter=await this.aave.balanceOf(this.bob.address)

        // console.log('bob aave before/after exploit',bobAAVEBefore.toString(),bobAAVEAfter.toString());  // we can see that bob removed all (99.99%) the AAVE from the contract

    });

    it('should balance the liquidity properly', async function () {
        const deadline = (await time.latest()) + 10000

        //selling begins
        //pool has 1000 aave with 100$ price
       

        await this.router.connect(this.bob).swapExactTokenForETH(
            this.aave.address, 
            "2246570000000000000000", bigNum(2), this.bob.address, deadline)        // huge sellof so that the pool value is 0.0589351766$ after sale

        const bobETHAfterSale =await ethers.provider.getBalance(this.bob.address);
   
        const poolInfo = await this.pool.getPool(this.aave.address);
        console.log('poolinfoBefore',poolInfo.poolValue.toString(),poolInfo.vcashDebt.toString(),poolInfo.vcashCredit.toString(),poolInfo.tokenBalanceVcashValue.toString());
        expect(poolInfo.vcashDebt.toString()).to.equal('100207967701922338036149');    // debt is 100207967701922338036149
   
        const aliceBalanceBeforeRebalancing=await this.aave.balanceOf(this.alice.address);
        
        const poolPriceBeforeRebalancing = ((await this.pool.pools(this.aave.address)).price).toString();

        const poolBalanceBeforeRebalancing = ((await this.pool.pools(this.aave.address)).tokenBalance).toString();

        await this.pool.rebalancePool(this.aave.address);

        const poolInfoAfterBalance = await this.pool.getPool(this.aave.address);  
        
        console.log('poolinfoAfter',poolInfoAfterBalance.poolValue.toString(),poolInfoAfterBalance.vcashDebt.toString(),poolInfoAfterBalance.vcashCredit.toString(),poolInfoAfterBalance.tokenBalanceVcashValue.toString());

        const poolPriceAfterRebalancing = ((await this.pool.pools(this.aave.address)).price).toString();

        const poolBalanceAfterRebalancing = ((await this.pool.pools(this.aave.address)).tokenBalance).toString();

        const aliceBalanceAfterRebalancing=await this.aave.balanceOf(this.alice.address);

        console.log('pool price before/after',poolPriceBeforeRebalancing,poolPriceAfterRebalancing);

        console.log('pool balance before/after',poolBalanceBeforeRebalancing,poolBalanceAfterRebalancing);

        console.log('tokens received by owner',aliceBalanceAfterRebalancing-aliceBalanceBeforeRebalancing);

        expect(poolInfoAfterBalance.vcashDebt.toNumber()).to.lessThan(1000); //we expect the new debt to be close to 0

        expect(poolPriceAfterRebalancing).to.equal(poolPriceBeforeRebalancing);

        expect(parseInt(poolInfoAfterBalance.poolValue.toString())).to.greaterThan(poolInfo.poolValue.toString() - 50);  // pool value should remain the same. There's an issue here because of the precision
        expect(parseInt(poolInfoAfterBalance.poolValue.toString())).to.lessThan(parseInt(poolInfo.poolValue.toString()) + 50);
    });

    it('should add price adjuster and adjust price', async function () {

        //await this.pool.updatePoolStatus(this.aave.address,3);  //make the pool synthetic

        await this.pool.updatePriceAdjuster(this.bob.address, true);
        expect(await this.pool.priceAdjusterRole(this.bob.address)).to.equal(true); //role granted

        await expect(this.pool.connect(this.alice).setSynthPoolPrice(this.aave.address,"100000000000"))
            .to.be.revertedWith("MonoX:BAD_ROLE")

        await expect(this.pool.connect(this.bob).setSynthPoolPrice(this.uni.address,"100000000000"))
            .to.be.revertedWith("MonoX:NOT_SYNT")
        
        await expect(this.pool.connect(this.bob).setSynthPoolPrice(this.aave.address, "0"))
            .to.be.revertedWith("MonoX:ZERO_PRICE")

        await this.pool.connect(this.bob).setSynthPoolPrice(this.aave.address,"100000000000");   
        expect(((await this.pool.pools(this.aave.address)).price).toString()).to.equal("100000000000"); //price changed

        await this.pool.updatePriceAdjuster(this.bob.address, false);      //remove role
        expect(await this.pool.priceAdjusterRole(this.bob.address)).to.equal(false);

    });


    it('should revert transaction because pool size would be to low - swapExactTokenForToken', async function () {

        const deadline = (await time.latest()) + 10000

        await this.pool.setPoolSizeMinLimit(bigNum(298000000));

        await expect(this.router.connect(this.bob).swapExactTokenForToken(
            this.weth.address,
            this.dai.address,
            bigNum(10000),
            bigNum(400),
            this.bob.address,
            deadline
        )).to.be.revertedWith("MonoX:MIN_POOL_SIZE");
    });

    it('should revert and than accept transaction after changing the minimum pool size', async function () {
        const deadline = (await time.latest()) + 10000

        await this.pool.setPoolSizeMinLimit(bigNum(298000000));

        await expect(this.router.connect(this.bob).swapExactTokenForToken(
            this.weth.address,
            this.dai.address,
            bigNum(10000),
            bigNum(400),
            this.bob.address,
            deadline
        )).to.be.revertedWith("MonoX:MIN_POOL_SIZE");

        await this.pool.setPoolSizeMinLimit(bigNum(297000000));

        await expect(this.router.connect(this.bob).swapExactTokenForToken(
            this.weth.address,
            this.dai.address,
            bigNum(10000),
            bigNum(400),
            this.bob.address,
            deadline
        )).to.be.not.reverted;
    });

    it('should revert transaction because pool size would be to low - swapExactETHForToken', async function () {

        const deadline = (await time.latest()) + 10000

        await this.pool.setPoolSizeMinLimit(bigNum(298000000));

        await expect(this.router.connect(this.bob).swapExactETHForToken(
            this.dai.address,
            bigNum(400),
            this.bob.address,
            deadline,
            {...overrides, value: bigNum(10000)}
        )).to.be.revertedWith("MonoX:MIN_POOL_SIZE");
    });

    it('should pause the pool and revert swaps', async function () {

        const deadline = (await time.latest()) + 10000

        await this.pool.updatePoolStatus(this.dai.address,4);

        await expect(this.router.connect(this.alice).swapExactETHForToken(
            this.dai.address,
            bigNum(400),
            this.bob.address,
            deadline,
            {...overrides, value: bigNum(10000)}
        )).to.be.revertedWith("MonoX:PAUSED");
    });

    it('should not allow creating a new pool for paused token', async function () {
        this.tToken = await this.MockERC20.deploy('Ttoken', 'TK', e26);
        await this.tToken.approve(this.pool.address, bigNum(10000));
        await this.pool.listNewToken(this.tToken.address, bigNum(1), 0, bigNum(10000), this.alice.address);
        // pause a pool
        this.pool.updatePoolStatus(this.tToken.address, 4);
        // try to list same token as the paused one.
        await expectRevert(
            this.pool.listNewToken(this.tToken.address, bigNum(1), 0, bigNum(10000), this.alice.address),
            'MonoX:POOL_EXISTS',
        );
    });

    it('should rebalance official pool', async function () {
        const deadline = (await time.latest()) + 10000
        

        let feeTo=(await this.pool.getConfig())[2];

        let feeToBalance = await this.weth.balanceOf(feeTo);
        expect(feeToBalance).to.equal(0);   //balance of fee to is 0

        await this.router.connect(this.bob).swapExactTokenForToken(
            this.weth.address, this.dai.address, 
            bigNum(200), bigNum(400), this.bob.address, deadline)

        let infoAfter=await this.pool.pools(this.weth.address);
        let feeToBalanceAfter = await this.weth.balanceOf(feeTo);
        
        expect(parseInt(infoAfter.vcashDebt)).to.lessThan(10000);  // we expect vcashDebt to still be near0 because of internal rebalancing for official pools
        expect(parseInt(feeToBalanceAfter)).to.greaterThan(0); //we expect the feeTo address to contain the tokens resulted from internal rebalancing
     
    });

    it('should not remove liquidity for largest LP holder in unofficial pool', async function () {

        let liquidity = (await this.monoXPool.balanceOf(this.alice.address, 4)).toString()

        console.log('liquidity', liquidity);
        
        await expect(this.router.connect(this.alice).removeLiquidity(
            this.comp.address, liquidity, this.alice.address, 0, 0))
            .to.be.revertedWith("MonoX:WRONG_TIME") // remove liquidity after add liquidity
        await this.router.connect(this.bob).addLiquidity(this.comp.address, 
            bigNum(500000), this.bob.address)
        await time.increase(60 * 60 * 24)
        await expect(this.router.connect(this.alice).removeLiquidity(
            this.comp.address, liquidity, this.alice.address, 0, 0))
            .to.be.revertedWith("MonoX:TOP_HOLDER & WRONG_TIME") // burn restriction for largest LP holder
        
        await this.router.connect(this.bob).addLiquidity(this.comp.address, 
            bigNum(2000000), this.bob.address);
        await this.router.connect(this.alice).removeLiquidity(
                this.comp.address, liquidity, this.alice.address, 0, 0);
        await time.increase(60 * 60 * 24 * 90)
        const bobLiquidity = (await this.monoXPool.balanceOf(this.bob.address, 4)).toString()
        await this.router.connect(this.alice).removeLiquidity(
            this.comp.address, bobLiquidity, this.bob.address, 0, 0);
    });

    it('should transfer lp tokens in unofficial pool', async function () {

        let liquidity = (await this.monoXPool.balanceOf(this.alice.address, 4)).toString()

        await this.router.connect(this.bob).addLiquidity(this.comp.address, 
            bigNum(500000), this.bob.address)
        
        await expect(this.monoXPool.connect(this.bob).safeTransferFrom(this.bob.address, this.alice.address, 4, bigNum(1), web3.utils.fromAscii('')))
            .to.be.revertedWith("MonoXPool:WRONG_TIME")
        await this.monoXPool.connect(this.minter).setWhitelist(this.alice.address, true)
        await this.monoXPool.connect(this.bob).safeTransferFrom(this.bob.address, this.alice.address, 4, bigNum(1), web3.utils.fromAscii(''))
        await time.increase(60 * 60 * 24)
        await this.monoXPool.connect(this.minter).setWhitelist(this.alice.address, false)
        await this.monoXPool.connect(this.bob).safeTransferFrom(this.bob.address, this.alice.address, 4, bigNum(1), web3.utils.fromAscii('')) 
        liquidity = (await this.monoXPool.balanceOf(this.alice.address, 4)).toString()

        await time.increase(60 * 60 * 24)
        await expect(this.monoXPool.connect(this.alice).safeTransferFrom(this.alice.address, this.bob.address, 4, liquidity, web3.utils.fromAscii(''))) 
            .to.be.revertedWith("MonoXPool:TOP HOLDER") // transfer restriction for largest LP holder
    });

    it('should transfer lp tokens in official pools', async function () {

        await this.router.connect(this.bob).addLiquidity(this.uni.address, 
            bigNum(500000), this.bob.address)
        
        await time.increase(60 * 60 * 4)
        await this.monoXPool.connect(this.bob).safeTransferFrom(this.bob.address, this.alice.address, 3, bigNum(1), web3.utils.fromAscii('')) 
    });

    it('should transfer admin role', async function () {
        expect(await this.monoXPool.admin()).to.equal(this.minter.address)
        await this.monoXPool.connect(this.minter).setAdmin(this.alice.address)
        expect(await this.monoXPool.admin()).to.equal(this.alice.address)
    });

    it('should add and remove liquidity successfully - 2', async function () {

        const deadline = (await time.latest()) + 10000

        await this.vcash.connect(this.minter).mint(this.bob.address, bigNum(1000000))

        await this.router.connect(this.bob).addLiquidityPair(this.uni.address, 
            bigNum(1000000), bigNum(1000000),  this.bob.address);
        console.log(await this.vcash.balanceOf(this.alice.address))
        const liquidity = (await this.monoXPool.balanceOf(this.alice.address, 3)).toString()
        console.log('liquidity', liquidity);
        await time.increase(60 * 60 * 24)
        const results = await this.router.connect(this.bob).removeLiquidity(
            this.uni.address, liquidity, this.alice.address, 0, 0);

        let vcashAmount = await this.vcash.balanceOf(this.alice.address)

        expect(smallNum(vcashAmount.toString())).to.greaterThan(490000)
        expect(smallNum(vcashAmount.toString())).to.lessThan(500000)

        let devFee = await this.vcash.balanceOf(this.dev.address)
        console.log(smallNum(devFee.toString()))
    });

    it('should revert if it is expired.', async function () {
        const deadline = (await time.latest()) - 1000
        this.pool.setTokenStatus(this.uni.address, 2)
        await expect(this.router.connect(this.bob).swapExactTokenForToken(
            this.uni.address, this.dai.address, 
            bigNum(2), bigNum(55), this.bob.address, deadline)).to.be.revertedWith("MonoswapRouter:EXPIRED")
    });

    it('should revert if it is not router.', async function () {
        const deadline = (await time.latest()) + 10000
        this.pool.setTokenStatus(this.uni.address, 2)
        await expect(this.pool.connect(this.bob).swapIn(
            this.uni.address, this.dai.address, this.bob.address, this.alice.address,
            bigNum(2))).to.be.revertedWith("MonoX:NOT_ROUTER")
    });

    it("should set token insurance", async function () {
        this.pool.setTokenInsurance(this.uni.address, bigNum(100))
        expect(await this.pool.tokenInsurance(this.uni.address)).to.equal(bigNum(100))
    });

    it('shouldn not swap same token', async function () {

        const deadline = (await time.latest()) + 10000

        await expect(this.router.connect(this.bob).swapExactTokenForToken(
            this.uni.address, this.uni.address, 
            bigNum(20), bigNum(400),  this.bob.address, deadline)).to.be.revertedWith("VM Exception while processing transaction: revert MonoX:SAME_SWAP_TOKEN")

        await expect(this.router.connect(this.bob).swapTokenForExactToken(
            this.uni.address, this.uni.address, 
            bigNum(350), bigNum(10),  this.bob.address, deadline)).to.be.revertedWith("VM Exception while processing transaction: revert MonoX:SAME_SWAP_TOKEN")
    });

    it('user should not remove others liquidity', async function () {

        const deadline = (await time.latest()) + 10000
        await this.router.connect(this.bob).addLiquidityPair(this.uni.address, 
            0, bigNum(100),  this.bob.address);
        const liquidityBob = (await this.monoXPool.balanceOf(this.bob.address, 3)).toString()
        const liquidity = (await this.monoXPool.balanceOf(this.alice.address, 3)).toString()
        console.log('liquidity', liquidity);
        await time.increase(60 * 60 * 24)
        await expect(this.router.connect(this.bob).removeLiquidity(
            this.uni.address, liquidityBob, this.alice.address, 0, 0))

        const liquidity2 = (await this.monoXPool.balanceOf(this.alice.address, 3)).toString()
        expect(liquidity).to.be.equal(liquidity2)

        await this.router.connect(this.alice).removeLiquidity(
            this.uni.address, liquidity, this.alice.address, 0, 0)
        const liquidity3 = (await this.monoXPool.balanceOf(this.alice.address, 3)).toString()
        expect(liquidity3).to.be.equal('0')

    });

});