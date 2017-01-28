addListItem = function(logItemArgs) {
	$("#list").append("<tr><td><a href='"+logItemArgs["uri"]+"'>"+logItemArgs["name"]+"</a></td><td>"+logItemArgs["ric"]+"</td><td>"+logItemArgs["reward"]+"</td><td class='text-center'><i class='fa fa-check fa-2x' aria-hidden='true'></i></td><td class='text-center'><button class='btn btn-success' data-toggle='modal' data-target='#issuerDetailModal'>DETAILS</button></td></tr>");
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
});