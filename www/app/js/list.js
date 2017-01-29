addListItem = function(logItemArgs) {
    $("#list").append("<tr><td><a href='"+logItemArgs["uri"]+"'>"+logItemArgs["name"]+"</a></td><td>"+logItemArgs["ric"]+"</td><td>"+logItemArgs["reward"]+"</td><td class='text-center'><i class='fa fa-check fa-2x' aria-hidden='true'></i></td><td class='text-center'><button class='btn btn-success' data-toggle='modal' data-target='#detailsModal'>DETAILS</button></td><td class='text-center'><button class='btn btn-success' id='btn-join-analysis' data-key='"+logItemArgs["key"]+"'>Join Analysis</button></td></tr>");
}

buildList = function() {
    Ratings.deployed().LogRequestForRatingSubmitted({}, {fromBlock: 0}).get(function(error, logs) {
        console.log(logs);
        for(var i=0; i<=logs.length; i++) {
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

setModalHandler = function(itemId) {
    console.log("show");
  $("#detailsModal").on("show.bs.modal", function(e) {
    var link = $(e.relatedTarget);
    var $modalBody = $("#detailsModal").find(".modal-body");
    $modalBody.load("templates/list-details.html");
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
}