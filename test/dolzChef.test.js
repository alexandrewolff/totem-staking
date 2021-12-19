const { expect } = require('chai');
const { ethers, waffle } = require('hardhat');
const { BigNumber } = ethers;
const { deployMockContract } = waffle;

describe('DolzChef', () => {
  let owner, user1, user2; // users
  let token, babyDolz, dolzChef; // contracts
  const amountPerReward = BigNumber.from('10000000');
  const rewardPerBlock = BigNumber.from('20000');
  const depositAmount = BigNumber.from('100000000000000000000'); // 100 tokens

  before(async () => {
    [owner, user1, user2] = await ethers.getSigners();
  });

  beforeEach(async () => {
    const Token = await ethers.getContractFactory('Token');
    const BabyDolz = await ethers.getContractFactory('BabyDolz');
    const DolzChef = await ethers.getContractFactory('DolzChef');
    token = await Token.deploy();
    babyDolz = await BabyDolz.deploy('BabyDolz', 'BBZ');
    dolzChef = await DolzChef.deploy(babyDolz.address);

    await babyDolz.setMinter(dolzChef.address, true);
  });

  describe('Create pool', () => {
    it('should create a pool', async () => {
      await dolzChef.createPool(token.address, amountPerReward, rewardPerBlock);
      const res = await dolzChef.pools(0);
      expect(res.token).equals(token.address);
      expect(res.rewardPerBlock).equals(rewardPerBlock);
    });

    it('should create two pools', async () => {
      const secondToken = await deployMockContract(owner, []);
      const secondAmountPerReward = 25783;
      const secondRewardPerBlock = 98;

      await dolzChef.createPool(token.address, amountPerReward, rewardPerBlock);
      await dolzChef.createPool(secondToken.address, secondAmountPerReward, secondRewardPerBlock);

      expect((await dolzChef.pools(0)).token).equals(token.address);
      expect((await dolzChef.pools(1)).token).equals(secondToken.address);
    });

    it('should not create a pool if not owner', async () => {
      await expect(
        dolzChef.connect(user1).createPool(token.address, amountPerReward, rewardPerBlock),
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });
  });

  describe('Deposit', () => {
    beforeEach(async () => {
      await token.transfer(user1.address, ethers.utils.parseUnits(depositAmount.toString(), 18));
      await dolzChef.createPool(token.address, amountPerReward, rewardPerBlock);
      await token.connect(user1).approve(dolzChef.address, ethers.constants.MaxUint256);
    });

    it('should deposit tokens', async () => {
      await dolzChef.connect(user1).deposit(0, depositAmount);
      expect((await dolzChef.deposits(0, user1.address)).amount).equals(depositAmount);
    });

    it('should update reward block when deposit', async () => {
      await dolzChef.connect(user1).deposit(0, depositAmount);
      const block = await getBlockNumber();
      expect((await dolzChef.deposits(0, user1.address)).rewardBlockStart).equals(block);
    });

    it('should not get reward when first deposit', async () => {
      await dolzChef.connect(user1).deposit(0, depositAmount);
      expect(await babyDolz.balanceOf(user1.address)).equals(0);
    });

    it('should get reward when deposit', async () => {
      await dolzChef.connect(user1).deposit(0, depositAmount);
      const blockStart = await getBlockNumber();
      await advanceBlocks(10);
      await dolzChef.connect(user1).deposit(0, 1000);
      const blockEnd = await getBlockNumber();

      const expectedReward = computeExpectedReward(
        depositAmount,
        rewardPerBlock,
        blockEnd - blockStart,
        amountPerReward,
      );
      expect(await babyDolz.balanceOf(user1.address)).equals(expectedReward);
    });

    it('should update reward block when deposit', async () => {
      await dolzChef.connect(user1).deposit(0, depositAmount);
      await advanceBlocks(10);
      await dolzChef.connect(user1).deposit(0, depositAmount);
      const block = await getBlockNumber();

      expect((await dolzChef.deposits(0, user1.address)).rewardBlockStart).equals(block);
    });
  });

  describe('Withdraw', () => {
    let blockStart;
    const withdrawAmount = 10000000;

    beforeEach(async () => {
      await token.transfer(user1.address, ethers.utils.parseUnits('10000', 18));
      await dolzChef.createPool(token.address, amountPerReward, rewardPerBlock);
      await token.connect(user1).approve(dolzChef.address, depositAmount);
      await dolzChef.connect(user1).deposit(0, depositAmount);
      blockStart = await getBlockNumber();
      await advanceBlocks(10);
    });

    it('should withdraw tokens', async () => {
      await expect(() => dolzChef.connect(user1).withdraw(0, withdrawAmount)).to.changeTokenBalance(
        token,
        user1,
        withdrawAmount,
      );
      expect((await dolzChef.deposits(0, user1.address)).amount).equals(
        depositAmount.sub(withdrawAmount),
      );
    });

    it('should update reward block when withdraw', async () => {
      await dolzChef.connect(user1).withdraw(0, withdrawAmount);
      const block = await getBlockNumber();
      expect((await dolzChef.deposits(0, user1.address)).rewardBlockStart).equals(block);
    });

    it('should get reward when withdraw', async () => {
      await dolzChef.connect(user1).withdraw(0, withdrawAmount);
      const blockEnd = await getBlockNumber();
      const expectedReward = computeExpectedReward(
        depositAmount,
        rewardPerBlock,
        blockEnd - blockStart,
        amountPerReward,
      );
      expect(await babyDolz.balanceOf(user1.address)).equals(expectedReward);
    });

    it('should not withdraw more that deposited', async () => {
      await expect(dolzChef.connect(user1).withdraw(0, depositAmount.add(1))).to.be.revertedWith(
        'Arithmetic operation underflowed or overflowed outside of an unchecked block',
      );
    });
  });

  describe('Pending reward', () => {
    it('should return pending reward', async () => {
      await token.transfer(user1.address, ethers.utils.parseUnits('10000', 18));
      await dolzChef.createPool(token.address, amountPerReward, rewardPerBlock);
      await token.connect(user1).approve(dolzChef.address, depositAmount);
      await dolzChef.connect(user1).deposit(0, depositAmount);
      const blockStart = await getBlockNumber();
      await advanceBlocks(10);
      const blockEnd = await getBlockNumber();
      const expectedReward = computeExpectedReward(
        depositAmount,
        rewardPerBlock,
        blockEnd - blockStart,
        amountPerReward,
      );
      expect(await dolzChef.pendingReward(0, user1.address)).equals(expectedReward);
    });
  });

  describe('Harvest', () => {
    beforeEach(async () => {
      await token.transfer(user1.address, ethers.utils.parseUnits('10000', 18));
      await dolzChef.createPool(token.address, amountPerReward, rewardPerBlock);
      await token.connect(user1).approve(dolzChef.address, depositAmount);
      await dolzChef.connect(user1).deposit(0, depositAmount);
    });

    it('should withdraw reward', async () => {
      const blockStart = await getBlockNumber();
      await advanceBlocks(10);
      await dolzChef.connect(user1).harvest(0);
      const blockEnd = await getBlockNumber();

      const expectedReward = computeExpectedReward(
        depositAmount,
        rewardPerBlock,
        blockEnd - blockStart,
        amountPerReward,
      );
      expect(await babyDolz.balanceOf(user1.address)).equals(expectedReward);
    });

    it('should update deposit block after withdraw', async () => {
      await advanceBlocks(10);
      await dolzChef.connect(user1).harvest(0);
      const blockEnd = await getBlockNumber();

      expect((await dolzChef.deposits(0, user1.address)).rewardBlockStart).equals(blockEnd);
    });

    it('should not withdraw reward twice', async () => {
      await advanceBlocks(10);
      await dolzChef.connect(user1).harvest(0);

      const expectedReward = computeExpectedReward(
        depositAmount,
        rewardPerBlock,
        1,
        amountPerReward,
      );
      await expect(() => dolzChef.connect(user1).harvest(0)).to.changeTokenBalance(
        babyDolz,
        user1,
        expectedReward,
      );
    });

    it('should work for another user', async () => {
      const newDepositAmount = BigNumber.from('2897325982989832489234');
      await token.transfer(user2.address, ethers.utils.parseUnits('10000', 18));
      await token.connect(user2).approve(dolzChef.address, newDepositAmount);
      await dolzChef.connect(user2).deposit(0, newDepositAmount);

      const blockStart = await getBlockNumber();
      await advanceBlocks(10);
      await dolzChef.connect(user2).harvest(0);
      const blockEnd = await getBlockNumber();

      const expectedReward = computeExpectedReward(
        newDepositAmount,
        rewardPerBlock,
        blockEnd - blockStart,
        amountPerReward,
      );
      expect(await babyDolz.balanceOf(user2.address)).equals(expectedReward);
    });

    it('should work with other values', async () => {
      const newAmountPerReward = BigNumber.from('987324');
      const newRewardPerBlock = BigNumber.from('726');
      const newDepositAmount = BigNumber.from('8848787239857298');

      await dolzChef.createPool(token.address, newAmountPerReward, newRewardPerBlock);
      await token.connect(user1).approve(dolzChef.address, newDepositAmount);
      await dolzChef.connect(user1).deposit(1, newDepositAmount);

      const blockStart = await getBlockNumber();
      await advanceBlocks(10);
      await dolzChef.connect(user1).harvest(1);
      const blockEnd = await getBlockNumber();

      const expectedReward = computeExpectedReward(
        newDepositAmount,
        newRewardPerBlock,
        blockEnd - blockStart,
        newAmountPerReward,
      );
      expect(await babyDolz.balanceOf(user1.address)).equals(expectedReward);
    });
  });
});

async function advanceBlocks(amount) {
  for (let i = 0; i < amount; i += 1) {
    await ethers.provider.send('evm_mine');
  }
}

async function getBlockNumber() {
  return (await ethers.provider.getBlock()).number;
}

function computeExpectedReward(depositAmount, rewardPerBlock, blocksElapsed, amountPerReward) {
  return depositAmount.mul(rewardPerBlock).mul(blocksElapsed).div(amountPerReward);
}
