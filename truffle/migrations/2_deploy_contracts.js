module.exports = function(deployer, network) {
	var entitlementAddresses = {
		"ropsten": "0x6216e07ba072ca4451f35bdfa2326f46d3f99dbe",
		"norsborg": "0x995bef79dfa2e666de2c6e5f751b4483b6d05cd8",
		"default": "0x995bef79dfa2e666de2c6e5f751b4483b6d05cd8",
		"test": "0x995bef79dfa2e666de2c6e5f751b4483b6d05cd8"
	};
	if (network == "norsborg") {
		// Deployed already
	    // deployer.deploy(BlockOneOracleClientTest, entitlementAddresses[network]);
	} else if (network == "test") {
	    deployer.deploy(BlockOneOracleClientTest, entitlementAddresses[network]);
	} else {
		// Not needed otherwise
	}
};
