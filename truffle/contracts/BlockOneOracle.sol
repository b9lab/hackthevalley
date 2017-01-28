pragma solidity ^0.4.5;

contract BlockOneOracle {
    function request_IntraDay(bytes32 symbol,uint256 timestamp)returns (uint256 );
    function request_EntityConnect(bytes32 uri1,bytes32 uri2,uint256 level)returns (uint256 );
    function request_EndOfDay(bytes32 symbol,uint256 timestamp)returns (uint256 );
}

