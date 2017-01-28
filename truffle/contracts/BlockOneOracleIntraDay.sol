pragma solidity ^0.4.5;

import "BlockOneOracle.sol";
import "BlockOneOracleClientI.sol";

contract BlockOneOracleIntraDay is BlockOneOracleClientI {
    function request_IntraDay(bytes32 symbol, uint timestamp) returns (uint requestId) {
        return BlockOneOracle(getOracle()).request_IntraDay(symbol, timestamp);
    }

    // Please implement this method to receive a success response from the Oracle
    function respondSuccess_IntraDay(uint requestId, uint timestamp, bytes32 _symbol, uint price, uint bid, uint ask, uint volume);

    // Please implement this method to receive a failure response from the Oracle
    function respondError_IntraDay(uint requestId, uint reason);
}