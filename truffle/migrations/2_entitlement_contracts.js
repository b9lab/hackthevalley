module.exports = function(deployer, network) {
    if (network == "test") {
        var investorEntitlement;
        var auditorEntitlement;
        var oracleEntitlement;
        deployer.deploy(EntitlementMock)
            .then(function () {
                investorEntitlement = EntitlementMock.address;
                return deployer.deploy(EntitlementMock);
            })
            .then(function () {
                auditorEntitlement = EntitlementMock.address;
                return deployer.deploy(BlockOneOracleMock);
            })
            .then(function () {
                oracleEntitlement = BlockOneOracleMock.address;
                return deployer.deploy(EntitlementRegistryMock);
            })
            .then(function () {
                var registry = EntitlementRegistryMock.at(EntitlementRegistryMock.address);
                registry.set("com.b9lab.drating.investor", investorEntitlement);
                registry.set("com.b9lab.drating.auditor", auditorEntitlement);
                registry.set("com.tr.oracle.main", oracleEntitlement);
            });
    }
};