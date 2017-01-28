const Extensions = require("../utils/extensions.js");
Extensions.init(web3, assert);

contract('BlockOneOracleClientTest', function(accounts) {

    var owner, investor, auditor;

    before("should prepare accounts", function() {
        assert.isAtLeast(accounts.length, 3, "should have at least 3 accounts");
        owner = accounts[0];
        investor = accounts[1];
        auditor = accounts[2];
        return Extensions.makeSureAreUnlocked(
                [ owner, investor, auditor ])
            .then(function() {
                return Extensions.makeSureHasAtLeast(
                    owner,
                    [ investor, auditor ],
                    web3.toWei(500, "finney"));
            })
            .then(function() {
                return Promise.all([
                        EntitlementRegistryMock.deployed()
                            .getOrThrow("com.b9lab.drating.investor"),
                        EntitlementRegistryMock.deployed()
                            .getOrThrow("com.b9lab.drating.auditor")
                    ]);
            })
            .then(function(entitlements) {
                return Promise.all([
                        EntitlementMock.at(entitlements[0])
                            .setEntitled(investor, true),
                        EntitlementMock.at(entitlements[1])
                            .setEntitled(auditor, true)
                    ]);
            });
    });  

    var submittedKey;

    it("should be possible for investor to submit a request", function() {
        return Ratings.deployed().submitRequestForRating.call(
                "Augur ICO", "Augur is ambitious", "AUG", "http://something", 1485708344, 3, "Qmskjdfhsdjkf",
                { from: investor, value: web3.toWei(100, "finney") })
            .then(function (success) {
                assert.isTrue(success);
                return Ratings.deployed().submitRequestForRating(
                    "Augur ICO", "Augur is ambitious", "AUG", "http://something", 1485708344, 3, "Qmskjdfhsdjkf",
                    { from: investor, value: web3.toWei(100, "finney") })
            })
            .then(function (txHash) {
                return web3.eth.getTransactionReceiptMined(txHash);
            })
            .then(function (receipt) {
                return Extensions.getEventsPromise(Ratings.deployed().LogRequestForRatingSubmitted(
                    {}, { fromBlock: receipt.blockNumber }));
            })
            .then(function (events) {
                assert.strictEqual(events.length, 1, "should be 1");
                // console.log(events[0].args);
                submittedKey = events[0].args.key;
                assert.strictEqual(events[0].args.investor, investor, "should have been investor");
            });
    });

});