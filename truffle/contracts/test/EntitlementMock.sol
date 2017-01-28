pragma solidity ^0.4.5;

import "../Entitlement.sol";

contract EntitlementMock is Entitlement {
	mapping(address => bool) public entitled;
	
	function isEntitled(address _address) constant returns (bool isIndeed) {
		return entitled[_address];
	}

	function setEntitled(address _address, bool isIndeed)
		returns (bool success) {
		entitled[_address] = isIndeed;
		return success;
	}
}