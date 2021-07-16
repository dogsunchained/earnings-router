// SPDX-License-Identifier: MIT
pragma solidity >= 0.6.0;
import "./lib/SafeMath.sol";
import "./lib/Ownable.sol";
import "./lib/SafeERC20.sol";
import "./lib/ReentrancyGuard.sol";

contract EarningsRouter is Ownable, ReentrancyGuard {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using Address for address payable;
    /**
     * This contract is a generalized contract for
     * fairly and transparently distributing funds
     * between multiple parties. It supports both
     * ETH and ERC20 distributions.
     * 
     * To use it, deploy the contract and set the
     * recipients who will receive them. In addition
     * specify the weight of ownership for each
     * recipient.
     * 
     * As an example, assume Alice, Bob, and Charity
     * each own a portion of an NFT's revenue. Alice
     * is due 50%, Bob 30% and, Charity 20%. for at 
     * least 1 year.
     * 
     * Deploy  the contract and set the addresses to 
     * [0xAlice, 0xBob, 0xCharity] 
     * and the ownerships to 
     * [5, 3, 2] (or [50, 30, 20])
     * and the duration to
     * 365 * 24 * 60 * 60 (1 years worth of seconds).
     * 
     * Then, set the NFT's contract to send all earnings
     * to the deployed contract.
     * 
     * Whenever a distribution is to be made, call
     * the "distribute" function and everyone's funds
     * will be automatically distributed.
     * 
     */
    // list of addresses to pay out earnings to
    address payable[] public recipients;
    // list of weights for each recipient
    uint256[] public ownerships;
    // used to calculate portion due
    uint256 public totalOwnership;
    // timelock to make sure earnings aren't changed before a certain date
    uint256 public immutableExpiration;

    event EarningsDistributed(
        address token,
        uint256 amount
    );

    /**
     * @notice initialize the contract with the first routing rules
     * @param _recipients addresses of each recipient of earnings
     * @param _ownerships weight of ownership of earnings
     * @param _duration length of time before destinations can be changed
     */
    constructor(
        address payable[] memory _recipients,
        uint256[] memory _ownerships,
        uint256 _duration
    ) public {
        _setDestinations(_recipients, _ownerships, _duration);
    }
    /**
     * @notice update the contract with new recipients and ownership weights
     * @param _recipients addresses of each recipient of earnings
     * @param _ownerships weight of ownership of earnings
     * @param _duration length of time before destinations can be changed
     */
    function setDestinations(
        address payable[] calldata _recipients,
        uint256[] calldata _ownerships,
        uint256 _duration
    ) external onlyOwner {
        _setDestinations(_recipients, _ownerships, _duration);
    }
    /**
     * @dev helper function to set the recipients, their weights, and lock on mutability
     * @param _recipients addresses of each recipient of earnings
     * @param _ownerships weight of ownership of earnings
     * @param _duration length of time before destinations can be changed
     */
    function _setDestinations(
        address payable[] memory _recipients,
        uint256[] memory _ownerships,
        uint256 _duration
    ) internal {
        require(immutableExpiration < block.timestamp, "Cannot change destinations yet");
        require(_recipients.length == _ownerships.length, "Data lengths must be equal");
        require(_recipients.length > 0, "At least one recipient required"); 
        require(_recipients.length <= 16, "Maximum 16 recipients allowed"); // reasonable limit for gas purposes
        recipients = _recipients;
        ownerships = _ownerships;
        totalOwnership = 0;
        for (uint i = 0; i < recipients.length; i++) {
            totalOwnership = totalOwnership.add(ownerships[i]);
        }
        immutableExpiration = block.timestamp + _duration;
    }
    /**
     * @notice distributes funds inside the contract to recipients based on their weighted ownerships
     * use address(0x0) to distribute ETH instead of an ERC20 
     * 
     * note: the function is specifically left public so that anyone can call it.
     * this ensures that someone can't withhold payments from others.
     * for other use cases, you can add onlyOwner or other modifiers.
     */
    function distribute(address token) public nonReentrant {
        uint256 balance;
        if (token == address(0))
            balance = address(this).balance;
        else
            balance = IERC20(token).balanceOf(address(this));
        for (uint i = 0; i < recipients.length; i++) {
            if (token == address(0))
                recipients[i].sendValue(ownerships[i].mul(balance).div(totalOwnership));
            else
                IERC20(token).safeTransfer(recipients[i], ownerships[i].mul(balance).div(totalOwnership));
        }
        emit EarningsDistributed(token, balance);
    }
    // included to ensure contract can safely receive ETH
    receive() external payable {}
    fallback() external payable {}
}