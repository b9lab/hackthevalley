pragma solidity ^0.4.5;

import "BlockOneOracle.sol";
import "BlockOneOracleClientI.sol";

contract BlockOneOracleEndOfDay is BlockOneOracleClientI {
    function request_EndOfDay(bytes32 symbol, uint timestamp) returns (uint requestId) {
        return BlockOneOracle(getOracle()).request_EndOfDay(symbol, timestamp);
    }

    // Please implement this method to receive a success response from the Oracle
    function respondSuccess_EndOfDay(uint requestId, uint timestamp, bytes32 _symbol, uint price, uint bid, uint ask, uint volume);

    // Please implement this method to receive a failure response from the Oracle
    function respondError_EndOfDay(uint requestId, uint reason);
}