addListItem = function(logItemArgs) {
    var actionbar = $("#list").append("<tr><td><a href='"+logItemArgs["uri"]+"'>"+logItemArgs["name"]+"</a></td><td>"+logItemArgs["ric"]+"</td><td>"+logItemArgs["reward"]+"</td><td class='action-cell text-center'></td>").find(".action-cell");
    var btn_join = $('<button/>', {
        text: 'Join analysis',
        id: 'btn-join-analysis',
        class: 'btn btn-success',
        "data-key": logItemArgs["key"]
    });

    var btn_response = $('<button/>', {
        text: 'Submit analysis',
        id: 'btn-submit-analysis',
        class: 'btn btn-primary',
        "data-toggle": 'modal',
        "data-target": '#responseModal',
        "data-key": logItemArgs["key"]
    });
    
    var btn_details = $('<button/>', {
        text: 'Details',
        id: 'btn-details-analysis',
        class: 'btn btn-success',
        "data-toggle": 'modal',
        "data-target": '#detailsModal',
        "data-key": logItemArgs["key"],
        "data-ipfsHash": logItemArgs["ipfsHash"],
        "data-name": logItemArgs["name"],
        "data-description": logItemArgs["description"],
        "data-ric": logItemArgs["ric"],
        "data-permid": logItemArgs["permid"],
        "data-deadline": logItemArgs["deadline"],
        "data-maxAuditors": logItemArgs["maxAuditors"],
        "data-reward": logItemArgs["reward"]
    });
    
        /*
        <button class='btn btn-success' id='btn-join-analysis' data-key='"+logItemArgs["key"]+"'>Join Analysis</button>
        <button type='button' class='btn btn-primary' data-toggle='modal' data-target='#responseModal' data-key='"+logItemArgs["key"]+"'>Submit analysis</button>
        <button class='btn btn-success' data-toggle='modal' data-target='#detailsModal'>DETAILS</button></td></tr>"
        */

    actionbar.append(btn_join).append(btn_response).append(btn_details);
}

buildList = function() {
    Ratings.deployed().LogRequestForRatingSubmitted({}, { fromBlock: 0 }).get(function(error, logs) {
        console.log(logs);
        for(var i = 0; i < logs.length; i++) {
            addListItem(logs[i].args);
        }
    })
}

$(document).on("networkSet", function() {
    buildList();

    Ratings.deployed().LogRequestForRatingSubmitted({}, {fromBlock: 'latest'}).watch(function(error, log) {
        addListItem(log.args);
    })

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
    $("#btn-join-analysis").click(function() {
        return Ratings.deployed().joinRequest.call(
            $("#btn-join-analysis").data("key"),
            { from: account, value: 0 })
            .then(function (success) {
                if (!success) {
                    console.log("Cannot join. key:", $("#btn-join-analysis").data("key"));
                    // TODO inform user that it failed
                    throw "Cannot join";
                }
                return Ratings.deployed().joinRequest.sendTransaction(
                    $("#btn-join-analysis").data("key"),
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