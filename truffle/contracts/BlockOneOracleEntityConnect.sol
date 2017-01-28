pragma solidity ^0.4.5;

import "BlockOneOracle.sol";
import "BlockOneOracleClientI.sol";

contract BlockOneOracleEntityConnect is BlockOneOracleClientI {
    function request_EntityConnect(bytes32 uri1, bytes32 uri2, uint level) returns (uint requestId) {
        return BlockOneOracle(getOracle()).request_EntityConnect(uri1, uri2, level);
    }

    // Please implement this method to receive a success response from the Oracle
    function respondSuccess_EntityConnect(uint requestId, uint connections);

    // Please implement this method to receive a failure response from the Oracle
    function respondError_EntityConnect(uint requestId, uint reason);
}