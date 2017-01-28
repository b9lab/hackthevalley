module.exports = function(deployer, network) {
    var entitlementAddresses = {
        "ropsten": "0x6216e07ba072ca4451f35bdfa2326f46d3f99dbe",
        "norsborg": "0x995bef79dfa2e666de2c6e5f751b4483b6d05cd8",
        "default": "0x995bef79dfa2e666de2c6e5f751b4483b6d05cd8",
        "test": "0x995bef79dfa2e666de2c6e5f751b4483b6d05cd8"
    };
    deployer.deploy(Ratings, entitlementAddresses[network]);
};
