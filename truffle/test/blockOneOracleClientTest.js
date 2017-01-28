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
                var requests = Extensions.makeSureHasAtLeast(
                    user,
                    [ user ],
                    web3.toWei(1));
                return web3.eth.getTransactionReceiptMined(requests);
            });
    });

    it("should get an end of day", function() {
        return BlockOneOracleClientTest.deployed()
            .request_EndOfDay.call("V0D.L", new Date().getTime())
            .then(function (requestId) {
                assert.isAtLeast(requestId.toNumber(), 3, "should not be the first request");
                return BlockOneOracleClientTest.deployed()
                    .request_EndOfDay.sendTransaction("V0D.L", new Date().getTime(), { from: user });
            })
            .then(function (txHash) {
                return web3.eth.getTransactionReceiptMined(txHash);
            })
            .then(function (receipt) {
                var formattedEvent = BlockOneOracleClientTest.deployed()
                    .BlockOneOracleClientTest_respond_EndOfDay()
                    .formatter(receipt.logs[0]);
                console.log(formattedEvent.args.requestId.toString(10));
                console.log(formattedEvent.args.timestamp.toString(10));
                console.log(web3.toUtf8(formattedEvent.args.symbol));
                console.log(formattedEvent.args.price.toString(10));
                console.log(formattedEvent.args.bid.toString(10));
                console.log(formattedEvent.args.ask.toString(10));
                console.log(formattedEvent.args.volume.toString(10));
                assert.strictEqual(web3.toUtf8(formattedEvent.args.symbol), "", "should be something else");
                // assert.strictEqual(formattedEvent.args.symbol, "0x00000000000000000000000000000000000000000000000000000159e496c0d4", "should be hex");
                assert.isAtLeast(formattedEvent.args.requestId.toNumber(), 3, "should not be the first request");
            })
    });


});
