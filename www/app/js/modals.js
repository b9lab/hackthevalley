$(document).ready(function() {
    $("#submit-request").click(function() {
    	console.log("Request filed")

        nameInput = $("#nameInput").val();
        urlInput = $("#urlInput").val();
        ricInput = $("#ricInput").val();
        hashInput = $("#hashInput").val();
        descriptionInput = $("#descriptionInput").val();
        amount = $("#etherInput").val();
        maxAuditors = $("#maxAuditors").val();

        // TODO fetch deadline
        var deadline = new Date().getTime() + 86400;
        // TODO remove overwrite maxAuditors
        var maxAuditors = 3;
        G_walletBar.createSecureSigner();
        console.log(G_account);
        console.log(Ratings.deployed())
        var data = Ratings.deployed().contract.submitRequestForRating.getData(
                    nameInput, descriptionInput, ricInput,
                    urlInput, deadline, maxAuditors, hashInput);
        console.log(data);
        // return Ratings.deployed().submitRequestForRating.call(
        //     nameInput, descriptionInput, ricInput,
        //     urlInput, deadline, maxAuditors, hashInput,
        //     { from: G_account, value: web3.toWei(amount) })
        //     .then(function (success) {
        //         if (!success) {
        //             console.log("Cannot submitRequestForRating. nameInput:", nameInput,
        //                 ", descriptionInput", descriptionInput, ", ricInput", ricInput,
        //                 ", urlInput", urlInput, ", deadline", deadline,
        //                 ", maxAuditors", maxAuditors, ", ipfsHash", hashInput,
        //                 ", account", G_account, ", ether", amount);
        //             // TODO inform user that it failed
        //             throw "Cannot submitRequestForRating";
        //         }
                // return Ratings.deployed().submitRequestForRating.sendTransaction(
                //     nameInput, descriptionInput, ricInput,
                //     urlInput, deadline, maxAuditors, hashInput,
                //     { from: G_account, value: web3.toWei(amount) })
            // })
        return web3.eth.sendTransactionPromise({
                from: G_account,
                to: Ratings.deployed().address,
                value: web3.toWei(amount),
                data: data,
                gas: 3000000
            })
            .then(function (txHash) {
            	$(".modal").modal("hide");

                // TODO update screen to inform it is on the way
                return web3.eth.getTransactionReceiptMined(txHash);
            })
            .then(function (receipt) {
                // TODO update screen
            });
    })
})