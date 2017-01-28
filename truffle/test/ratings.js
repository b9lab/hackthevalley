const Extensions = require("../utils/extensions.js");
Extensions.init(web3, assert);

contract('Ratings', function(accounts) {

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
                "Augur ICO", "Augur is ambitious", "AUG", "http://something", 1485708344, 1, "Qmskjdfhsdjkf",
                { from: investor, value: web3.toWei(100, "finney") })
            .then(function (success) {
                assert.isTrue(success);
                return Ratings.deployed().submitRequestForRating(
                    "Augur ICO", "Augur is ambitious", "AUG", "http://something", 1485708344, 1, "Qmskjdfhsdjkf",
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

    it("should be possible for same investor to contribute", function() {
        return Ratings.deployed().contributeToRequestForRating.call(
                submittedKey, { from: investor, value: web3.toWei(50, "finney") })
            .then(function (success) {
                assert.isTrue(success);
                return Ratings.deployed().contributeToRequestForRating(
                    submittedKey, { from: investor, value: web3.toWei(50, "finney") });
            })
            .then(function (txHash) {
                return web3.eth.getTransactionReceiptMined(txHash);
            })
            .then(function (receipt) {
                return Extensions.getEventsPromise(Ratings.deployed()
                        .LogRequestForRatingContributed({}, { fromBlock: receipt.blockNumber }));
            })
            .then(function (events) {
                assert.strictEqual(events.length, 1, "should be one");
                var args = events[0].args;
                assert.strictEqual(
                    args.contribution.toString(10),
                    web3.toWei(50, "finney").toString(10));
                assert.strictEqual(
                    args.totalReward.toString(10),
                    web3.toWei(150, "finney").toString(10));
                return Ratings.deployed().requestForRatings(submittedKey);
            })
            .then(function(requestForRating) {
                assert.strictEqual(
                    requestForRating[1].toString(10),
                    web3.toWei(150, "finney"));
            })
    });

    it("should be possible for auditor to join", function() {
        return Ratings.deployed().joinRating.call(
                submittedKey, { from: auditor })
            .then(function (success) {
                assert.isTrue(success);
                return Ratings.deployed().joinRating(
                    submittedKey, { from: auditor });
            })
            .then(function (txHash) {
                return web3.eth.getTransactionReceiptMined(txHash);
            })
            .then(function (receipt) {
                return Extensions.getEventsPromise(Ratings.deployed()
                        .LogAuditorJoined({}, { fromBlock: receipt.blockNumber }));
            })
            .then(function (events) {
                assert.strictEqual(events.length, 1, "should be one");
                var args = events[0].args;
                assert.strictEqual(
                    args.auditor,
                    auditor);
                assert.strictEqual(
                    args.auditorCount.toNumber(),
                    1);
                return Ratings.deployed().requestForRatings(submittedKey);
            })
            .then(function(requestForRating) {
                assert.strictEqual(
                    requestForRating[3].toNumber(),
                    1);
                return Ratings.deployed().getAuditor(submittedKey, auditor);
            })
            .then(function (auditorInfo) {
                assert.isTrue(auditorInfo[0]);
                assert.strictEqual(web3.toUtf8(auditorInfo[2]), "");
            })
    });

    it("should be possible for auditor to submit", function() {
        return Ratings.deployed().submitRating.call(
                submittedKey, 12, "Qmwer", { from: auditor })
            .then(function (success) {
                assert.isTrue(success);
                return Ratings.deployed().submitRating(
                    submittedKey, 12, "Qmwer", { from: auditor });
            })
            .then(function (txHash) {
                return web3.eth.getTransactionReceiptMined(txHash);
            })
            .then(function (receipt) {
                return Extensions.getEventsPromise(Ratings.deployed().LogAuditorSubmitted(
                    {}, { fromBlock: receipt.blockNumber }));
            })
            .then(function (events) {
                assert.strictEqual(events.length, 1, "should be one");
                var args = events[0].args;
                assert.strictEqual(
                    args.rating.toNumber(),
                    12);
                assert.strictEqual(
                    args.ipfsHash,
                    "Qmwer");
                assert.strictEqual(
                    args.submissionCount.toNumber(),
                    1);
            })
    });

    it("should be possible for auditor to be paid", function() {
        return Ratings.deployed().requestPayout.call(submittedKey, { from: auditor })
            .then(function (success) {
                assert.isTrue(success);
                return Ratings.deployed().requestPayout(submittedKey, { from: auditor });
            })
            .then(function (txHash) {
                return web3.eth.getTransactionReceiptMined(txHash);
            })
            .then(function (receipt) {
                return Extensions.getEventsPromise(Ratings.deployed().LogAuditorPaid(
                    {}, { fromBlock: receipt.blockNumber }));
            })
            .then(function (events) {
                assert.strictEqual(events.length, 1, "should be one");
                var args = events[0].args;
                assert.strictEqual(
                    args.reward.toString(10),
                    web3.toWei(150, "finney").toString(10));
                return web3.eth.getBalancePromise(Ratings.deployed().address);
            })
            .then(function (balance) {
                assert.strictEqual(balance.toString(10), "0");
            });
    });

});