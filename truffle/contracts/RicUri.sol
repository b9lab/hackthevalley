pragma solidity ^0.4.5;

contract RicUri {
    struct Info {
        string ric;
        string uri;
        string companyRic;
        string companyUri;
    }

    mapping(address => Info) public infos;

    function setRic(string ric) returns (bool success) {
        infos[msg.sender].ric = ric;
        return true;
    }

    function setUri(string uri) returns (bool success) {
        infos[msg.sender].uri = uri;
        return true;
    }

    function setCompanyRic(string companyRic) returns (bool success) {
        infos[msg.sender].companyRic = companyRic;
        return true;
    }

    function setCompanyUri(string companyUri) returns (bool success) {
        infos[msg.sender].companyUri = companyUri;
        return true;
    }
}