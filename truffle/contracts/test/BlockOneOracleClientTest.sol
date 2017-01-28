pragma solidity ^0.4.5;

import "../BlockOneOracleClient.sol";
import "../BlockOneOracleIntraDay.sol";
import "../BlockOneOracleEndOfDay.sol";
import "../BlockOneOracleEntityConnect.sol";

contract BlockOneOracleClientTest is BlockOneOracleClient,
    BlockOneOracleIntraDay, BlockOneOracleEndOfDay, BlockOneOracleEntityConnect {

    event BlockOneOracleClientTest_onOracleResponse(uint requestId);
    event BlockOneOracleClientTest_onOracleFailure(uint requestId, uint reason);

    function BlockOneOracleClientTest(address entitlementRegistry)
        BlockOneOracleClient(entitlementRegistry) {
    }

    function getAppName() constant returns (string) {
        return "com.b9lab.oracle.test";
    }

    event BlockOneOracleClientTest_requested_IntraDay(uint requestId);
    event BlockOneOracleClientTest_respond_IntraDay(uint requestId, uint timestamp, bytes32 symbol, uint price, uint bid, uint ask, uint volume);

    function request_IntraDay(bytes32 symbol, uint timestamp) returns (uint requestId) {
        requestId = BlockOneOracleIntraDay.request_IntraDay(symbol, timestamp);
        BlockOneOracleClientTest_requested_IntraDay(requestId);
    }

    function respondSuccess_IntraDay(uint requestId, uint timestamp, bytes32 symbol, uint price, uint bid, uint ask, uint volume) {
        BlockOneOracleClientTest_respond_IntraDay(requestId, timestamp, symbol, price, bid, ask, volume);
    }

    function respondError_IntraDay(uint requestId, uint reason) {
        BlockOneOracleClientTest_onOracleFailure(requestId, reason);
    }

    //-------------------------------------------------------------------------------------------------------

    event BlockOneOracleClientTest_requested_EndOfDay(uint requestId);
    event BlockOneOracleClientTest_respond_EndOfDay(uint requestId, uint timestamp, bytes32 symbol, uint price, uint bid, uint ask, uint volume);

    function request_EndOfDay(bytes32 symbol, uint timestamp) returns (uint requestId) {
        requestId = BlockOneOracleEndOfDay.request_EndOfDay(symbol, timestamp);
        BlockOneOracleClientTest_requested_EndOfDay(requestId);
    }

    function respondSuccess_EndOfDay(uint requestId, uint timestamp, bytes32 symbol, uint price, uint bid, uint ask, uint volume) {
        BlockOneOracleClientTest_respond_EndOfDay(requestId, timestamp, symbol, price, bid, ask, volume);
    }

    function respondError_EndOfDay(uint requestId, uint reason) {
        BlockOneOracleClientTest_onOracleFailure(requestId, reason);
    }

    //-------------------------------------------------------------------------------------------------------

    event BlockOneOracleClientTest_requested_EntityConnect(uint requestId);
    event BlockOneOracleClientTest_respond_EntityConnect(uint requestId, uint connections);

    function request_EntityConnect(bytes32 uri1, bytes32 uri2, uint level) returns(uint requestId) {
        requestId = BlockOneOracleEntityConnect.request_EntityConnect(uri1, uri2, level);
        BlockOneOracleClientTest_requested_EntityConnect(requestId);
    }

    function respondSuccess_EntityConnect(uint requestId, uint connections) {
        BlockOneOracleClientTest_respond_EntityConnect(requestId, connections);
    }

    function respondError_EntityConnect(uint requestId, uint reason) {
        BlockOneOracleClientTest_onOracleFailure(requestId, reason);
    }
}