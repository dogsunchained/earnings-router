// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

import "./ERC20.sol";

contract DummyERC20 is ERC20 {
    
    constructor(uint256 supply) ERC20("Dummy", "DUM") public {
        _mint(msg.sender, supply);
    }
}