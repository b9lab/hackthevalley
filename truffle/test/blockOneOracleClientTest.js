const Extensions = require("../utils/extensions.js");
Extensions.init(web3, assert);

contract('BlockOneOracleClientTest', function(accounts) {

    var user;
    var blockOneOracleClientTest;

    before("should prepare accounts", function() {
        assert.isAtLeast(accounts.length, 1, "should have at least 1 account");
        user = accounts[0];
        return Extensions.makeSureAreUnlocked(
                [ user ])
            .then(function() {
                return Extensions.makeSureHasAtLeast(
                    user,
                    [ user ],
                    web3.toWei(1));
            });
    });

    beforeEach("should deploy a BlockOneOracleClientTest", function() {
        return BlockOneOracleClientTest.new(EntitlementMock.deployed().address)
            .then(function (_created) {
                blockOneOracleClientTest = _created;
                console.log(blockOneOracleClientTest);
            });
    });

    it("should get an intra day", function() {
        var requestId;
        return blockOneOracleClientTest
            .request_IntraDay.call("VOD.L", new Date().getTime())
            .then(function (requestId) {
                assert.isAtLeast(requestId.toNumber(), 3, "should not be the first request");
                return BlockOneOracleClientTest.deployed()
                    .request_IntraDay.sendTransaction("VOD.L", new Date().getTime(), { from: user, gas: 3000000 });
            })
            .then(function (txHash) {
                return web3.eth.getTransactionReceiptMined(txHash);
            })
            .then(function (receipt) {
                var formattedEvent = BlockOneOracleClientTest.deployed()
                    .BlockOneOracleClientTest_requested_IntraDay()
                    .formatter(receipt.logs[1]);
                requestId = formattedEvent.args.requestId;
                console.log("requestId:", requestId.toString(10));
                assert.isAtLeast(requestId.toNumber(), 14, "should not be the first request");
                return Extensions.getEventsPromise(BlockOneOracleClientTest.deployed()
                    .BlockOneOracleClientTest_respond_IntraDay(
                        {}, { fromBlock: receipt.blockNumber }));
            })
            .then(function (events) {
                assert.strictEqual(events.length, 1, "should have received one");
                assert.strictEqual(events[0].args.requestId.toString(10), requestId.toString(10), "should match");
            });
    });

    it("should get an end of day", function() {
        var requestId;
        return blockOneOracleClientTest
            .request_EndOfDay.call("VOD.L", new Date().getTime())
            .then(function (requestId) {
                assert.isAtLeast(requestId.toNumber(), 3, "should not be the first request");
                return BlockOneOracleClientTest.deployed()
                    .request_EndOfDay.sendTransaction("VOD.L", new Date().getTime(), { from: user });
            })
            .then(function (txHash) {
                return web3.eth.getTransactionReceiptMined(txHash);
            })
            .then(function (receipt) {
                var formattedEvent = BlockOneOracleClientTest.deployed()
                    .BlockOneOracleClientTest_requested_EndOfDay()
                    .formatter(receipt.logs[1]);
                requestId = formattedEvent.args.requestId;
                console.log("requestId:", requestId.toString(10));
                assert.isAtLeast(requestId.toNumber(), 14, "should not be the first request");
                return Extensions.getEventsPromise(BlockOneOracleClientTest.deployed()
                    .BlockOneOracleClientTest_respond_EndOfDay(
                        {}, { fromBlock: receipt.blockNumber }));
            })
            .then(function (events) {
                assert.strictEqual(events.length, 1, "should have received one");
                assert.strictEqual(events[0].args.requestId.toString(10), requestId.toString(10), "should match");
            });
    });

    it("should get an entity count", function() {
        var requestId;
        var goldmanSachs = "http://permid.org/1-4295884772";
        var unilever = "http://permid.org/1-4295911963";
        return blockOneOracleClientTest
            .request_EntityConnect.call(goldmanSachs, unilever, 2)
            .then(function (requestId) {
                assert.isAtLeast(requestId.toNumber(), 3, "should not be the first request");
                return BlockOneOracleClientTest.deployed()
                    .request_EntityConnect.sendTransaction(
                        goldmanSachs, unilever, 2, { from: user });
            })
            .then(function (txHash) {
                return web3.eth.getTransactionReceiptMined(txHash);
            })
            .then(function (receipt) {
                var formattedEvent = BlockOneOracleClientTest.deployed()
                    .BlockOneOracleClientTest_requested_EntityConnect()
                    .formatter(receipt.logs[1]);
                requestId = formattedEvent.args.requestId;
                console.log("requestId:", requestId.toString(10));
                assert.isAtLeast(requestId.toNumber(), 14, "should not be the first request");
                return Extensions.getEventsPromise(BlockOneOracleClientTest.deployed()
                    .BlockOneOracleClientTest_respond_EntityConnect(
                        {}, { fromBlock: receipt.blockNumber }));
            })
            .then(function (events) {
                assert.strictEqual(events.length, 1, "should have received one");
                assert.strictEqual(events[0].args.requestId.toString(10), requestId.toString(10), "should match");
                assert.isAtLeast(events[0].args.connections.toNumber(), 7, "should be large connections");
            });
    });
});
