pragma solidity ^0.4.5;

import "../BlockOneOracle.sol";
import "../Entitlement.sol";
import "../BlockOneOracleEntityConnect.sol";

contract BlockOneOracleMock is BlockOneOracle, Entitlement {
    function isEntitled(address _address) constant returns (bool isIndeed) {
        return true;
    }

    function request_IntraDay(bytes32 symbol, uint256 timestamp) returns (uint256) {
        throw;
    }

    event LogRequestEntityConnect(
        address sender, uint queryId, bytes32 uri1,
        bytes32 uri2, uint256 level);

    function request_EntityConnect(bytes32 uri1, bytes32 uri2, uint256 level) returns (uint256 ) {
        uint queryId = uint(sha3(uri1, uri2, level, now, block.number));
        LogRequestEntityConnect(msg.sender, queryId, uri1, uri2, level);
        return queryId;
    }

    function request_EndOfDay(bytes32 symbol, uint256 timestamp) returns (uint256 ) {
        throw;
    }
}