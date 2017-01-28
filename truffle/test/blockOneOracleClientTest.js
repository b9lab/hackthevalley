const Extensions = require("../utils/extensions.js");
Extensions.init(web3, assert);

contract('BlockOneOracleClientTest', function(accounts) {

    var user;

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

    it("should get an end of day", function() {
        var requestId;
        return BlockOneOracleClientTest.deployed()
            .request_EndOfDay.call("V0D.L", new Date().getTime())
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


});
