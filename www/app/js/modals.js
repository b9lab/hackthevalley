$(document).ready(function() {
    $("#submit-request").click(function() {
    	console.log("Request filed")

        nameInput = $("#nameInput").val(),
        urlInput = $("#urlInput").val(),
        ricInput = $("#ricInput").val(),
        hashInput = $("#hashInput").val(),
        descriptionInput = $("#descriptionInput").val(),
        amount = $("#etherInput").val()

        // TODO fetch deadline
        // TODO fetch maxAuditors
        // TODO feetch ipfsHash
        var deadline = new Date().getTime() + 86400;
        var maxAuditors = 3;
        var ipfsHash = "Qmwhateves";
        return Ratings.deployed().submitRequestForRating.call(
            nameInput, descriptionInput, ricInput,
            urlInput, deadline, maxAuditors, ipfsHash,
            { from: account, value: web3.toWei(amount) })
            .then(function (success) {
                if (!success) {
                    console.log("Cannot submitRequestForRating. nameInput:", nameInput,
                        ", descriptionInput", descriptionInput, ", ricInput", ricInput,
                        ", urlInput", urlInput, ", deadline", deadline,
                        ", maxAuditors", maxAuditors, ", ipfsHash", ipfsHash,
                        ", account", account, ", ether", amount);
                    // TODO inform user that it failed
                    throw "Cannot submitRequestForRating";
                }
                return Ratings.deployed().submitRequestForRating.sendTransaction(
                    nameInput, descriptionInput, ricInput,
                    urlInput, deadline, maxAuditors, ipfsHash,
                    { from: account, value: web3.toWei(amount) });
            })
            .then(function (txHash) {
            	$(".modal").modal("hide")
            	
                // TODO update screen to inform it is on the way
                return web3.eth.getTransactionReceiptMined(txHash);
            })
            .then(function (receipt) {
                // TODO update screen
            });
    })
})