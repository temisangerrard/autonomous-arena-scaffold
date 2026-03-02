// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockPriceFeed {
    uint80 private currentRoundId;
    int256 private currentAnswer;
    uint256 private currentUpdatedAt;

    function setLatestRoundData(uint80 roundId, int256 answer, uint256 updatedAt) external {
        currentRoundId = roundId;
        currentAnswer = answer;
        currentUpdatedAt = updatedAt;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (currentRoundId, currentAnswer, currentUpdatedAt, currentUpdatedAt, currentRoundId);
    }
}
