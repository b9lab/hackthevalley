promisify = function (web3) {
    // Pipes values from a Web3 callback.
    var callbackToResolve = function (resolve, reject) {
        return function (error, value) {
                if (error) {
                    reject(error);
                } else {
                    resolve(value);
                }
            };
    };

    // List synchronous functions masquerading as values.
    var syncGetters = {
        db: [],
        eth: [ "accounts", "blockNumber", "coinbase", "gasPrice", "hashrate",
            "mining", "protocolVersion", "syncing" ],
        net: [ "listening", "peerCount" ],
        personal: [ "listAccounts" ],
        shh: [],
        version: [ "ethereum", "network", "node", "whisper" ]
    };

    Object.keys(syncGetters).forEach(function(group) {
        Object.keys(web3[group]).forEach(function (method) {
            if (syncGetters[group].indexOf(method) > -1) {
                // Skip
            } else if (typeof web3[group][method] === "function") {
                web3[group][method + "Promise"] = function () {
                    var args = arguments;
                    return new Promise(function (resolve, reject) {
                        args[args.length] = callbackToResolve(resolve, reject);
                        args.length++;
                        web3[group][method].apply(web3[group], args);
                    });
                };
            }
        });
    });
}

init = function (web3) {
    promisify(web3);
    
    // From https://gist.github.com/xavierlepretre/88682e871f4ad07be4534ae560692ee6
    web3.eth.getTransactionReceiptMined = function (txnHash, interval) {
        var transactionReceiptAsync;
        interval = interval ? interval : 500;
        transactionReceiptAsync = function(txnHash, resolve, reject) {
            try {
                web3.eth.getTransactionReceiptPromise(txnHash)
                    .then(function (receipt) {
                        if (receipt == null) {
                            setTimeout(function () {
                                transactionReceiptAsync(txnHash, resolve, reject);
                            }, interval);
                        } else {
                            resolve(receipt);
                        }
                    });
            } catch(e) {
                reject(e);
            }
        };

        if (Array.isArray(txnHash)) {
            var promises = [];
            txnHash.forEach(function (oneTxHash) {
                promises.push(web3.eth.getTransactionReceiptMined(oneTxHash, interval));
            });
            return Promise.all(promises);
        } else {
            return new Promise(function (resolve, reject) {
                    transactionReceiptAsync(txnHash, resolve, reject);
                });
        }
    };
};

waitPromise = function (timeOut, toPassOn) {
    timeOut = timeOut ? timeOut : 1000;
    return new Promise(function (resolve, reject) {
        setTimeout(function () {
                resolve(toPassOn);
            }, timeOut);
    });
};
