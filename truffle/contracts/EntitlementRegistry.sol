pragma solidity ^0.4.4;

contract EntitlementRegistry {
    function get(string _name)constant returns (address);
    function getOrThrow(string _name)constant returns (address);
}

