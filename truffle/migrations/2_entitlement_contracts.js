const Extensions = require("../utils/extensions.js");
Extensions.init(web3);

module.exports = function(deployer, network) {
    Extensions.init(web3);
    var registry;
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
                registry = EntitlementRegistryMock.at(EntitlementRegistryMock.address);
                registry.set("com.b9lab.drating.investor", investorEntitlement);
                registry.set("com.b9lab.drating.auditor", auditorEntitlement);
                return registry.get("com.tr.oracle.main");
            })
            .then(function(oracleAddress) {
                return web3.eth.getCodePromise(oracleAddress)
                    .then(function(code) {
                        if (code == "0x0") {
                            return deployer.deploy(BlockOneOracleMock)
                                .then(function () {
                                    oracleEntitlement = BlockOneOracleMock.address;
                                    return registry.set("com.tr.oracle.main", oracleEntitlement);
                                });
                        }
                    });
            });
    }
};