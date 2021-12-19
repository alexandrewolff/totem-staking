// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./BabyDolz.sol";

import "hardhat/console.sol";

struct Pool {
    address token;
    uint256 amountPerReward;
    uint256 rewardPerBlock;
}

struct Deposit {
    uint256 amount;
    uint256 rewardBlockStart;
}

contract DolzChef is Ownable {
    using SafeERC20 for IERC20;

    address public immutable babyDolz;
    Pool[] public pools;

    mapping(uint256 => mapping(address => Deposit)) public deposits;

    constructor(address _babyDolz) {
        babyDolz = _babyDolz;
    }

    function createPool(
        address token,
        uint256 amountPerReward,
        uint256 rewardPerBlock
    ) external onlyOwner {
        pools.push(Pool(token, amountPerReward, rewardPerBlock));
    }

    function deposit(uint256 poolId, uint256 amount) external {
        harvest(poolId);
        deposits[poolId][msg.sender].amount += amount;
        IERC20(pools[poolId].token).safeTransferFrom(msg.sender, address(this), amount);
    }

    function withdraw(uint256 poolId, uint256 amount) external {
        harvest(poolId);
        deposits[poolId][msg.sender].amount -= amount;
        IERC20(pools[poolId].token).safeTransfer(msg.sender, amount);
    }

    function pendingReward(uint256 poolId, address account) public view returns (uint256) {
        return
            ((deposits[poolId][account].amount * pools[poolId].rewardPerBlock) *
                (block.number - deposits[poolId][account].rewardBlockStart)) /
            pools[poolId].amountPerReward;
    }

    function harvest(uint256 poolId) public {
        uint256 reward = pendingReward(poolId, msg.sender);
        deposits[poolId][msg.sender].rewardBlockStart = block.number;
        BabyDolz(babyDolz).mint(msg.sender, reward);
    }
}
