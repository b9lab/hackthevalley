pragma solidity ^0.4.5;

import "../EntitlementRegistry.sol";

contract EntitlementRegistryMock is EntitlementRegistry {
	mapping (string => address) entitlements;

    function get(string _name) constant returns (address) {
    	return entitlements[_name];
    }

    function getOrThrow(string _name) constant returns (address entitlement) {
    	entitlement = entitlements[_name];
    	if (entitlement == 0) {
    		throw;
    	}
    }

    function set(string _name, address entitlement) returns (bool success) {
    	entitlements[_name] = entitlement;
    	return true;
    }
}