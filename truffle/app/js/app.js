var accounts;
var account;

var entitlementAddresses = {
    "3": "0x6216e07ba072ca4451f35bdfa2326f46d3f99dbe",
    "norsborg": "0x995bef79dfa2e666de2c6e5f751b4483b6d05cd8",
    "default": "0x995bef79dfa2e666de2c6e5f751b4483b6d05cd8",
    "test": EntitlementRegistryMock.address
};

// For all events: .watch(function (err, value) {
// })

// value.args = {
//         bytes32 indexed key,
//         address indexed investor,
//         string indexed ipfsHash,
//         string name,
//         string description,
//         uint deadline,
//         uint maxAuditors,
//         uint reward
// }
var logRequestForRatingSubmitted;

// value.args = {
//         bytes32 indexed key,
//         address indexed investor,
//         uint contribution,
//         uint totalReward    
// }
var logRequestForRatingContributed;

// value.args = {
//         bytes32 indexed key,
//         address indexed auditor,
//         uint auditorCount    
// }
var logAuditorJoined;

// value.args = {
//         bytes32 indexed key,
//         address indexed auditor,
//         uint rating,
//         string ipfsHash,
//         uint submissionCount
// }
var logAuditorSubmitted;

// value.args = {
//         bytes32 indexed key,
//         address indexed auditor,
//         uint reward   
// }
var logAuditorPaid;

// value.args = {
//         bytes32 indexed key,
//         address indexed investor,
//         uint contribution    
// }
var logInvestorRefunded;

function setupSolidityEventExamples() {
    logRequestForRatingSubmitted = Ratings.deployed().LogRequestForRatingSubmitted(
        {}, { fromBlock: 0 });
    logRequestForRatingContributed = Ratings.deployed().LogRequestForRatingContributed(
        { key: keyToWatch }, { fromBlock: 0 });
}

window.onload = function() {
    init(web3);
    web3.eth.getAccounts(function(err, accs) {
        if (err != null) {
            alert("There was an error fetching your accounts.");
            return;
        }

        if (accs.length == 0) {
            console("Couldn't get any accounts! Make sure your Ethereum client is configured correctly.");
            return;
        }

        accounts = accs;
        account = accounts[0];
    });
    web3.version.getNetworkPromise()
        .then(function(network) {
            [ Ratings, RicUri ].forEach(function (contract) {
                if (contract.networks().indexOf(network) > -1) {
                    contract.setNetwork(network);
                }
            });
            $.event.trigger({ type: "networkSet"});
        });
}
