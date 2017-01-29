addListItem = function(logItemArgs) {
    $("#list").append("<tr><td><a href='"+logItemArgs["uri"]+"'>"+logItemArgs["name"]+"</a></td><td>"+logItemArgs["ric"]+"</td><td>"+logItemArgs["reward"]+"</td><td class='text-center'><i class='fa fa-check fa-2x' aria-hidden='true'></i></td><td class='text-center'><button class='btn btn-success' data-toggle='modal' data-target='#detailsModal'>DETAILS</button></td></tr>");
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
});

setModalHandler = function() {
  $("#detailsModal").on("show.bs.modal", function(e) {
    var r_source = $(e.relatedTarget);
    var r_modal = $(e.target);
    var $modalBody = $("#detailsModal").find(".modal-body");
    $modalBody.load("templates/list-details.html", function(e) {
      setListDetails(r_modal, r_source);
    });
  });
}
