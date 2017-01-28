pragma solidity ^0.4.4;

import "BlockOneOracleClientI.sol";
import "EntitlementRegistry.sol";

// You need to inherit from this contract
contract BlockOneOracleClient is BlockOneOracleClientI {
    EntitlementRegistry registry;
    address entitledOwner;

    // to be used by both BlockOneOracle and BlockOneOracleClient
    uint8 constant ERR_NO_DATA            = 1;
    uint8 constant ERR_MARKET_CLOSED      = 2;
    uint8 constant ERR_BAD_REQUEST_OWNER  = 3;
    uint8 constant ERR_GENERAL_FAILURE    = 4;
    uint8 constant ERR_INVALID_SYMBOL     = 5;

    function BlockOneOracleClient()  {
        registry = EntitlementRegistry(0x995bef79dfa2e666de2c6e5f751b4483b6d05cd8);
        entitledOwner = msg.sender;
    }

    function getOracle() constant returns(address) {
        return registry.get("com.tr.oracle.main");
    }
}