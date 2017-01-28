pragma solidity ^0.4.5;

import "EntitlementRegistry.sol";
import "Entitlement.sol";

contract BlockOneUser {
    EntitlementRegistry registry;

    function BlockOneUser(address entitlementRegistry)  {
        if (entitlementRegistry == 0) {
            throw;
        }
        registry = EntitlementRegistry(entitlementRegistry);
    }

    function getAppName() constant returns (string);

    function getEntitlement(string name) constant returns(address) {
        // Example "com.tr.roblh.testdapp1"
        return registry.getOrThrow(name);
    }

    modifier entitledUsersOnly {
        if (!Entitlement(getEntitlement(getAppName())).isEntitled(msg.sender)) throw;
        _;
    }
}