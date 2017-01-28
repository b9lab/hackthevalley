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
                return deployer.deploy(EntitlementRegistryMock);
            })
            .then(function () {
                EntitlementRegistryMock.at(EntitlementRegistryMock.address)
                    .set("com.b9lab.drating.investor", investorEntitlement);
                EntitlementRegistryMock.at(EntitlementRegistryMock.address)
                    .set("com.b9lab.drating.auditor", auditorEntitlement);
            });
    }
};