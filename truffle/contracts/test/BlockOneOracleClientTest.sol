pragma solidity ^0.4.4;

import "../BlockOneOracleClient.sol";
import "../BlockOneOracleIntraDay.sol";
import "../BlockOneOracleEndOfDay.sol";
import "../BlockOneOracleEntityConnect.sol";

contract BlockOneOracleClientTest is BlockOneOracleClient,
    BlockOneOracleIntraDay, BlockOneOracleEndOfDay, BlockOneOracleEntityConnect {

    event BlockOneOracleClientTest_onOracleResponse(uint requestId);
    event BlockOneOracleClientTest_onOracleFailure(uint requestId, uint reason);

    function BlockOneOracleClientTest() BlockOneOracleClient() {
    }

    event BlockOneOracleClientTest_respond_IntraDay(uint requestId, uint timestamp, bytes32 symbol, uint price, uint bid, uint ask, uint volume);

    function respondSuccess_IntraDay(uint requestId, uint timestamp, bytes32 symbol, uint price, uint bid, uint ask, uint volume) {
        BlockOneOracleClientTest_respond_IntraDay(requestId, timestamp, symbol, price, bid, ask, volume);
    }

    function respondError_IntraDay(uint requestId, uint reason) {
        BlockOneOracleClientTest_onOracleFailure(requestId, reason);
    }

    //-------------------------------------------------------------------------------------------------------

    event BlockOneOracleClientTest_respond_EndOfDay(uint requestId, uint timestamp, bytes32 symbol, uint price, uint bid, uint ask, uint volume);

    function respondSuccess_EndOfDay(uint requestId, uint timestamp, bytes32 symbol, uint price, uint bid, uint ask, uint volume) {
        BlockOneOracleClientTest_respond_EndOfDay(requestId, timestamp, symbol, price, bid, ask, volume);
    }

    function respondError_EndOfDay(uint requestId, uint reason) {
        BlockOneOracleClientTest_onOracleFailure(requestId, reason);
    }

    //-------------------------------------------------------------------------------------------------------

    event BlockOneOracleClientTest_respond_EntityConnect(uint requestId, uint connections);

    function respondSuccess_EntityConnect(uint requestId, uint connections) {
        BlockOneOracleClientTest_respond_EntityConnect(requestId, connections);
    }

    function respondError_EntityConnect(uint requestId, uint reason) {
        BlockOneOracleClientTest_onOracleFailure(requestId, reason);
    }
}