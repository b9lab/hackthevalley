pragma solidity ^0.4.5;

import "BlockOneUser.sol";
import "BlockOneOracleClientI.sol";

// You need to inherit from this contract
contract BlockOneOracleClient is BlockOneUser, BlockOneOracleClientI {
    address entitledOwner;

    // to be used by both BlockOneOracle and BlockOneOracleClient
    uint8 constant ERR_NO_DATA            = 1;
    uint8 constant ERR_MARKET_CLOSED      = 2;
    uint8 constant ERR_BAD_REQUEST_OWNER  = 3;
    uint8 constant ERR_GENERAL_FAILURE    = 4;
    uint8 constant ERR_INVALID_SYMBOL     = 5;

    function BlockOneOracleClient(address entitlementRegistry)
        BlockOneUser(entitlementRegistry) {
        entitledOwner = msg.sender;
    }

    function getOracle() constant returns(address) {
        return getEntitlement("com.tr.oracle.main");
    }
}