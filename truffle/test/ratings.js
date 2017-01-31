const Extensions = require("../utils/extensions.js");
Extensions.init(web3, assert);

contract('Ratings', function(accounts) {

    var entitlementRegistry;
    var mocked;
    var owner, investor, auditor;
    var oracle;

    before("should figure out registry", function () {
        return Ratings.deployed().registry()
            .then(function (registry) {
                entitlementRegistry = registry;
                mocked = registry == EntitlementRegistryMock.deployed().address;
            })
    });

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
                    web3.toWei(2));
            })
            .then(function() {
                if (mocked) {
                    return Promise.all([
                            EntitlementRegistryMock.deployed()
                                .getOrThrow("com.b9lab.drating.investor"),
                            EntitlementRegistryMock.deployed()
                                .getOrThrow("com.b9lab.drating.auditor")
                        ]);
                } else {
                    return [];
                }
            })
            .then(function(entitlements) {
                if (entitlements.length > 1) {
                    return Promise.all([
                            EntitlementMock.at(entitlements[0])
                                .setEntitled(investor, true),
                            EntitlementMock.at(entitlements[1])
                                .setEntitled(auditor, true)
                        ]);
                }
            });
    });

    var submittedKey;

    it("should be possible for investor to submit a request", function() {
        var blockNumber;
        return Ratings.deployed().submitRequestForRating.call(
                "Augur ICO", "Augur is ambitious", "AUG", "http://something", 1485708344, 1, "Qmskjdfhsdjkf",
                { from: investor, value: web3.toWei(100, "finney") })
            .then(function (success) {
                assert.isTrue(success, "should be possible");
                return Ratings.deployed().submitRequestForRating(
                    "Augur ICO", "Augur is ambitious", "AUG", "http://something", 1485708344, 1, "Qmskjdfhsdjkf",
                    { from: investor, value: web3.toWei(100, "finney") })
            })
            .then(function (txHash) {
                return web3.eth.getTransactionReceiptMined(txHash);
            })
            .then(function (receipt) {
                blockNumber = receipt.blockNumber;
                return Extensions.getEventsPromise(Ratings.deployed().LogRequestForRatingSubmitted(
                    {}, { fromBlock: receipt.blockNumber }));
            })
            .then(function (events) {
                assert.strictEqual(events.length, 1, "should be 1");
                submittedKey = events[0].args.key;
                assert.strictEqual(events[0].args.investor, investor, "should have been investor");
                if (mocked) {
                    // Make the Oracle "respond"
                    return Extensions.getEventsPromise(BlockOneOracleMock.deployed()
                            .LogRequestEntityConnect({}, { fromBlock: blockNumber }))
                        .then(function (events2) {
                            assert.strictEqual(events2.length, 1, "should be 1");
                            var args = events2[0].args;
                            return BlockOneOracleEntityConnect.at(args.sender)
                                .respondSuccess_EntityConnect(
                                    args.queryId, 7,
                                    { from: accounts[0] });
                        })
                        .then(function(txHash) {
                            return web3.eth.getTransactionReceiptMined(txHash);
                        });
                }
            })
            .then(function(receipt) {
                return Extensions.getEventsPromise(Ratings.deployed().LogRequestForRatingInteractionsUpdated(
                    {}, { fromBlock: blockNumber }));
            })
            .then(function (events) {
                assert.strictEqual(events.length, 1, "should be 1");
                assert.strictEqual(events[0].args.key, submittedKey);
                assert.strictEqual(
                    events[0].args.totalInteractions.toNumber(),
                    7, "should have been investor");
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
                    requestForRating[3].toString(10),
                    web3.toWei(150, "finney"),
                    "should be 150");
            })
    });

    it("should be possible for auditor to join", function() {
        var blockNumber;
        return Ratings.deployed().joinRating.call(
                submittedKey, "http://auditor", { from: auditor })
            .then(function (success) {
                assert.isTrue(success);
                return Ratings.deployed().joinRating(
                    submittedKey, "http://auditor", { from: auditor });
            })
            .then(function (txHash) {
                return web3.eth.getTransactionReceiptMined(txHash);
            })
            .then(function (receipt) {
                blockNumber = receipt.blockNumber;
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
                    web3.toUtf8(args.permid),
                    "http://auditor");
                assert.strictEqual(
                    args.auditorCount.toNumber(),
                    1);
                return Ratings.deployed().requestForRatings(submittedKey);
            })
            .then(function(requestForRating) {
                assert.strictEqual(
                    requestForRating[4].toNumber(),
                    1);
                return Ratings.deployed().getAuditor(submittedKey, auditor);
            })
            .then(function (auditorInfo) {
                assert.isTrue(auditorInfo[0]);
                assert.strictEqual(web3.toUtf8(auditorInfo[2]), "");
                if (mocked) {
                    // Make the Oracle "respond"
                    return Extensions.getEventsPromise(BlockOneOracleMock.deployed()
                            .LogRequestEntityConnect({}, { fromBlock: blockNumber }))
                        .then(function (events) {
                            assert.strictEqual(events.length, 1);
                            var args = events[0].args;
                            return BlockOneOracleEntityConnect.at(args.sender)
                                .respondSuccess_EntityConnect(
                                    args.queryId, 10,
                                    { from: accounts[0] });
                        })
                        .then(function(txHash) {
                            return web3.eth.getTransactionReceiptMined(txHash);
                        });
                }
            })
            .then(function() {
                return Extensions.getEventsPromise(Ratings.deployed().LogAuditorConnectionsUpdated(
                    {}, { fromBlock: blockNumber }));
            })
            .then(function (events) {
                assert.strictEqual(events.length, 1, "should be 1");
                var args = events[0].args;
                assert.strictEqual(args.key, submittedKey);
                assert.strictEqual(args.auditor, auditor);
                assert.strictEqual(
                    args.totalConnections.toNumber(),
                    10, "should have been 10 connections");
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