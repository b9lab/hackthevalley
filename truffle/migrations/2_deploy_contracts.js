module.exports = function(deployer, network) {
	if (network == "norsborg") {
		// Deployed already
	    // deployer.deploy(BlockOneOracleClientTest);
	} else if (network == "test") {
	    deployer.deploy(BlockOneOracleClientTest);
	} else {
		// Not needed otherwise
	}
};
