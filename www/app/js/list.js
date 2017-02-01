addListItem = function(logItemArgs) {
    // load new row from
    var actionbar = $("#list");
    actionbar.append( newRow );
    //maybe get the object?

    var objs = [newRow.find("#btn_join_analysis"), newRow.find("#btn_submit_analysis"), newRow.find("#btn_details_analysis")];
    var dataset = [
        { key:LogItemArgs[ LogRequestForRatingSubmitted.key] },
        { key:LogItemArgs[ LogRequestForRatingSubmitted.key] },
        {
            key:LogItemArgs[ LogRequestForRatingSubmitted.key],
            ipfsHash: logItemArgs[ LogRequestForRatingSubmitted.ipfsHash ],
            name: logItemArgs[ LogRequestForRatingSubmitted.name ],
            description: logItemArgs[ LogRequestForRatingSubmitted.description ],
            ric: logItemArgs[ LogRequestForRatingSubmitted.ric ],
            permid: logItemArgs[ LogRequestForRatingSubmitted.permid ],
            deadline: logItemArgs[ LogRequestForRatingSubmitted.deadlineStamp ].toNumber(),
            maxAuditors: logItemArgs[ LogRequestForRatingSubmitted.maxAuditors ].toNumber(),
            availableSlots: logItemArgs[ LogRequestForRatingSubmitted.maxAuditors ].toNumber(),
            joinedSlots: 0,
            submittedSlots: 0,
            reward: logItemArgs[ LogRequestForRatingSubmitted.rewardWei ].toString(10)
        }
    ];

    pushMultiDataHash(objs, dataset);

// left here for reference - to be removed
/*
        "<tr data-key=\"" + logItemArgs[ LogRequestForRatingSubmitted.key ] + "\">" +
            "<td class=\"name\"><a href='" + web3.toUtf8(logItemArgs[ LogRequestForRatingSubmitted.permid ]) + "'>" +
                logItemArgs[ LogRequestForRatingSubmitted.name ] + "</a></td>" +
        "<td class=\"ric\">" + logItemArgs[ LogRequestForRatingSubmitted.ric ] + "</td>" +
        "<td class=\"reward\">" + web3.fromWei(logItemArgs[ LogRequestForRatingSubmitted.rewardWei ]).toNumber() + " Ethers</td>" + 
        "<td class=\"available\">" + logItemArgs[ LogRequestForRatingSubmitted.maxAuditors ].toNumber() + "</td>" +
        "<td class=\"joined\">" + 0 + "</td>" +
        "<td class=\"submitted\">" + 0 + "</td>" +
        "<td class='action-cell text-center'></td>").find(".action-cell");
    var btn_join = $('<button/>', {
        text: 'Join analysis',
        //id: 'btn-join-analysis',
        class: 'btn btn-success btn-join-analysis',
        "data-key": logItemArgs[ LogRequestForRatingSubmitted.key ]
    });

    var btn_response = $('<button/>', {
        text: 'Submit analysis',
        id: 'btn-submit-analysis',
        class: 'btn btn-primary btn-submit-analysis',
        "data-toggle": 'modal',
        "data-target": '#responseModal',
        "data-key": logItemArgs[ LogRequestForRatingSubmitted.key ]
    });
    
    var btn_details = $('<button/>', {
        text: 'Details',
        id: 'btn-details-analysis',
        class: 'btn btn-success btn-details-analysis',
        "data-toggle": 'modal',
        "data-target": '#detailsModal',
        "data-key": logItemArgs[ LogRequestForRatingSubmitted.key ],
        "data-ipfsHash": logItemArgs[ LogRequestForRatingSubmitted.ipfsHash ],
        "data-name": logItemArgs[ LogRequestForRatingSubmitted.name ],
        "data-description": logItemArgs[ LogRequestForRatingSubmitted.description ],
        "data-ric": logItemArgs[ LogRequestForRatingSubmitted.ric ],
        "data-permid": logItemArgs[ LogRequestForRatingSubmitted.permid ],
        "data-deadline": logItemArgs[ LogRequestForRatingSubmitted.deadlineStamp ].toNumber(),
        "data-maxAuditors": logItemArgs[ LogRequestForRatingSubmitted.maxAuditors ].toNumber(),
        "data-availableSlots": logItemArgs[ LogRequestForRatingSubmitted.maxAuditors ].toNumber(),
        "data-joinedSlots": 0,
        "data-submittedSlots": 0,
        "data-reward": logItemArgs[ LogRequestForRatingSubmitted.rewardWei ].toString(10)
    });
*/  
        /*
        <button class='btn btn-success' id='btn-join-analysis' data-key='"+logItemArgs["key"]+"'>Join Analysis</button>
        <button type='button' class='btn btn-primary' data-toggle='modal' data-target='#responseModal' data-key='"+logItemArgs["key"]+"'>Submit analysis</button>
        <button class='btn btn-success' data-toggle='modal' data-target='#detailsModal'>DETAILS</button></td></tr>"
        */

//    actionbar.append(btn_join).append(btn_response).append(btn_details);
};

buildInitialList = function(initialBlock, lastBlock) {
    return filterGetPromise(Ratings.deployed()
            .LogRequestForRatingSubmitted(
                {},
                { fromBlock: initialBlock, toBlock: lastBlock }))
        .then(function (logs) {
            for(var i = 0; i < logs.length; i++) {
                addListItem(logs[i].args);
            }
            return logs;
        });
};

updateRequestInteractions = function (logItemArgs) {
    // TODO
};

updateRequestInteractionsList = function(initialBlock, lastBlock) {
    return filterGetPromise(Ratings.deployed()
            .LogRequestForRatingInteractionsUpdated(
                {},
                { fromBlock: initialBlock, toBlock: lastBlock }))
        .then(function (logs) {
            for (var i = 0; i < logs.length; i++) {
                updateRequestInteractions(logs[i].args);
            }
            return logs;
        });
};

updateRequestContributed = function (logItemArgs) {
    var row = $("#list").find("[data-key=\"" + logItemArgs[ LogRequestForRatingContributed.key ] + "\"]");
    row.find("td.reward").html(
        web3.fromWei(logItemArgs[ LogRequestForRatingContributed.totalReward ]).toNumber());
    row.find("button.btn-details-analysis").attr(
        "data-reward",
        logItemArgs[ LogRequestForRatingContributed.totalReward ].toString(10));
};

updateRequestContributedList = function (initialBlock, lastBlock) {
    return filterGetPromise(Ratings.deployed()
            .LogRequestForRatingContributed(
                {},
                { fromBlock: initialBlock, toBlock: lastBlock }))
        .then(function (logs) {
            for (var i = 0; i < logs.length; i++) {
                updateRequestContributed(logs[i].args);
            }
            return logs;            
        });
};

updateAuditorJoined = function (logItemArgs) {
    // TODO
};

updateAuditorJoinedList = function (initialBlock, lastBlock) {
    return filterGetPromise(Ratings.deployed()
            .LogAuditorJoined(
                {},
                { fromBlock: initialBlock, toBlock: lastBlock }))
        .then(function (logs) {
            for (var i = 0; i < logs.length; i++) {
                updateAuditorJoined(logs[i].args);
            }
            return logs;            
        });
};

updateAuditorSubmitted = function (logItemArgs) {
    // TODO
};

updateAuditorSubmittedList = function (initialBlock, lastBlock) {
    return filterGetPromise(Ratings.deployed()
            .LogAuditorSubmitted(
                {},
                { fromBlock: initialBlock, toBlock: lastBlock }))
        .then(function (logs) {
            for (var i = 0; i < logs.length; i++) {
                updateAuditorSubmitted(logs[i].args);
            }
            return logs;            
        });
};

updateAuditorConnections = function (logItemArgs) {
    // TODO
};

updateAuditorConnectionsList = function (initialBlock, lastBlock) {
    return filterGetPromise(Ratings.deployed()
            .LogAuditorConnectionsUpdated(
                {},
                { fromBlock: initialBlock, toBlock: lastBlock }))
        .then(function (logs) {
            for (var i = 0; i < logs.length; i++) {
                updateAuditorConnections(logs[i].args);
            }
            return logs;            
        });
};

updateAuditorPaid = function (logItemArgs) {
    // TODO
};

updateAuditorPaidList = function (initialBlock, lastBlock) {
    return filterGetPromise(Ratings.deployed()
            .LogAuditorPaid(
                {},
                { fromBlock: initialBlock, toBlock: lastBlock }))
        .then(function (logs) {
            for (var i = 0; i < logs.length; i++) {
                updateAuditorPaid(logs[i].args);
            }
            return logs;            
        });
};

updateInvestorRefunded = function (logItemArgs) {
    // TODO
};

updateInvestorRefundedList = function (initialBlock, lastBlock) {
    return filterGetPromise(Ratings.deployed()
            .LogInvestorRefunded(
                {},
                { fromBlock: initialBlock, toBlock: lastBlock }))
        .then(function (logs) {
            for (var i = 0; i < logs.length; i++) {
                updateInvestorRefunded(logs[i].args);
            }
            return logs;            
        });
};

updateEntityConnectFailure = function (logItemArgs) {
    // TODO
};

updateEntityConnectFailureList = function (initialBlock, lastBlock) {
    return filterGetPromise(Ratings.deployed()
            .LogEntityConnect_onOracleFailure(
                {},
                { fromBlock: initialBlock, toBlock: lastBlock }))
        .then(function (logs) {
            for (var i = 0; i < logs.length; i++) {
                updateEntityConnectFailure(logs[i].args);
            }
            return logs;            
        });
};

$(document).on("networkSet", function() {
    var initialBlock = 0;
    var blockNumber;
    /*return*/ web3.eth.getBlockNumberPromise()
        .then(function (_blockNumber) {
            blockNumber = _blockNumber;
            return buildInitialList(initialBlock, blockNumber);
        })
        .then(function (logs) {
            Ratings.deployed().LogRequestForRatingSubmitted(
                    {}, { fromBlock: blockNumber + 1, toBlock: 'latest' })
                .watch(function(error, log) {
                    addListItem(log.args);
                    bindEvents(); // TODO remove when jQuery can inject live
                });
            return updateRequestInteractionsList(initialBlock, blockNumber);
        })
        .then(function (logs) {
            Ratings.deployed().LogRequestForRatingInteractionsUpdated(
                    {}, { fromBlock: blockNumber + 1, toBlock: 'latest' })
                .watch(function (error, log) {
                    updateRequestInteractions(log.args);
                    bindEvents(); // TODO remove when jQuery can inject live
                });
            return updateRequestContributedList(initialBlock, blockNumber);
        })
        .then(function (logs) {
            Ratings.deployed().LogRequestForRatingContributed(
                    {}, { fromBlock: blockNumber + 1, toBlock: 'latest' })
                .watch(function (error, log) {
                    updateRequestContributed(log.args);
                    bindEvents(); // TODO remove when jQuery can inject live
                });
            return updateAuditorJoinedList(initialBlock, blockNumber);
        })
        .then(function (logs) {
            Ratings.deployed().LogAuditorJoined(
                    {}, { fromBlock: blockNumber + 1, toBlock: 'latest' })
                .watch(function (error, log) {
                    updateAuditorJoined(log.args);
                    bindEvents(); // TODO remove when jQuery can inject live
                });
            return updateAuditorSubmittedList(initialBlock, blockNumber);
        })
        .then(function (logs) {
            Ratings.deployed().LogAuditorSubmitted(
                    {}, { fromBlock: blockNumber + 1, toBlock: 'latest' })
                .watch(function (error, log) {
                    updateAuditorSubmitted(log.args);
                    bindEvents(); // TODO remove when jQuery can inject live
                });
            return updateAuditorConnectionsList(initialBlock, blockNumber);
        })
        .then(function (logs) {
            Ratings.deployed().LogAuditorConnectionsUpdated(
                    {}, { fromBlock: blockNumber + 1, toBlock: 'latest' })
                .watch(function (error, log) {
                    updateAuditorConnections(log.args);
                    bindEvents(); // TODO remove when jQuery can inject live
                });
            return updateAuditorPaidList(initialBlock, blockNumber);
        })
        .then(function (logs) {
            Ratings.deployed().LogAuditorPaid(
                    {}, { fromBlock: blockNumber + 1, toBlock: 'latest' })
                .watch(function (error, log) {
                    updateAuditorPaid(log.args);
                    bindEvents(); // TODO remove when jQuery can inject live
                });
            return updateInvestorRefundedList(initialBlock, blockNumber);
        })
        .then(function (logs) {
            Ratings.deployed().LogInvestorRefunded(
                    {}, { fromBlock: blockNumber + 1, toBlock: 'latest' })
                .watch(function (error, log) {
                    updateInvestorRefunded(log.args);
                    bindEvents(); // TODO remove when jQuery can inject live
                });
            return updateEntityConnectFailureList(initialBlock, blockNumber);
        })
        .then(function (logs) {
            Ratings.deployed().LogEntityConnect_onOracleFailure(
                    {}, { fromBlock: blockNumber + 1, toBlock: 'latest' })
                .watch(function (error, log) {
                    updateEntityConnectFailure(log.args);
                    bindEvents(); // TODO remove when jQuery can inject live
                });
        });

    setModalHandler();
    bindEvents();
});

setModalHandler = function() {
  $("#detailsModal").on("show.bs.modal", function(e) {
    var r_source = $(e.relatedTarget);
    var r_modal = $(e.target);
    var $modalBody = r_modal.find(".modal-body");
    $modalBody.load("templates/list-details.html", function(e) {
      setListDetails(r_modal, r_source);
    });
  });

  $("#responseModal").on("show.bs.modal", function(e) {
    var r_source = $(e.relatedTarget);
    var r_modal = $(e.target);
    
    r_modal.find("#submit-request").data("key") = r_source.data("key");
    console.log("set data key:" + r_source.data("key"));
  });

  $("#requestModal").on("show.bs.modal", function(e) {
    var r_source = $(e.relatedTarget);
    var r_modal = $(e.target);
    
    //r_modal.find("#submit-request").data("key") = r_source.data("key");
    //console.log("set data key:" + r_source.data("key"));
    var $modalBody = r_modal.find(".modal-body");
    $modalBody.load("templates/submit-request.html", function(e) {
      // nop
    });
  });
}

bindEvents = function() {
    $(".btn-join-analysis").click(function() {
        console.log("in button");
        var key = $("#btn-join-analysis").data("key");
        // TODO get it from account or contract
        var permid = "http://permid.org/1-4295884772"
        // We need to hack this for BlockOne
        var data = Ratings.deployed().contract.joinRequest.getData(
            key, permid)
        G_walletBar.createSecureSigner();
        return web3.eth.sendTransactionPromise({
                from: G_account,
                to: Ratings.deployed().address,
                data: data,
                value: 0,
                gas: 3000000 }) 
            .then(function (txHash) {
                // TODO update screen to inform it is on the way
                return web3.eth.getTransactionReceiptMined(txHash);
            })
            .then(function (receipt) {
                // TODO update screen
            });
    })

    $("#btn-submit-response").click(function() {
        key = $("#btn-submit-response").data("key")
        ipfsHash = $("#responseHashInput").val()
        score = $("#scoreInput").val()
        return Ratings.deployed().submitResponse.call(
            key, score, ipfsHash,
            { from: account, value: 0 })
            .then(function (success) {
                if (!success) {
                    console.log("Cannot join. key:", $("#btn-join-analysis").data("key"));
                    // TODO inform user that it failed
                    throw "Cannot join";
                }
                return Ratings.deployed().submitResponse.sendTransaction(
                    key, score, ipfsHash,
                    { from: account, value: 0 });
            })
            .then(function (txHash) {
                // TODO update screen to inform it is on the way
                return web3.eth.getTransactionReceiptMined(txHash);
            })
            .then(function (receipt) {
                // TODO update screen
            });
    })
}