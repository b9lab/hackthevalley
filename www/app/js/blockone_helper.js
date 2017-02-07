// Helps forming the request for the blockone signup

var dappId = {
    "?investor": "com.b9lab.drating.investor",
    "?auditor": "com.b9lab.drating.auditor"
  }[window.location.search] || "com.b9lab.drating.auditor";
console.log(dappId);
var network = "norsborg";
var publicGethHost = 'http://geth.b9lab.com:8550';
var publicGeth;

const MAIN_NETWORK_ID = 1;
const ROPSTEN_NETWORK_ID = 3;
const NORSBORG_NETWORK_ID = 16123;

var G_account;

var G_walletBar;

window.onload = function() {
    init(web3);
    return web3.version.getNetworkPromise()
        .catch(function(err) {
            // Failed locally, let's try the public Geth
            publicGeth = new Web3.providers.HttpProvider(publicGethHost);
            web3.setProvider(publicGeth);
            return web3.version.getNetworkPromise();
        })
        .catch(function(err) {
            updateStatusUI(false);
            throw "Failed to connect";
        })
        .then(function(networkId) {
            updateStatusUI(true);
            updateNetworkUI(networkId);
            [ Ratings, RicUri, Migrations ].forEach(function (contract) {
                contract.setProvider(web3.currentProvider);
                if (contract.networks().indexOf(networkId) > -1) {
                    contract.setNetwork(networkId);
                }
            });
            G_walletBar = new WalletBar({
                dappNamespace: dappId,
                blockchain: network,
                callbacks: { signOut: function () { location.reload(); } }
            });
            fixUI();
            $.event.trigger({ type: "onContractsInitialised" });
            return G_walletBar.applyHook(web3);
        })
        .then(function() {
            return waitPromise(2000);
        })
        .then(function() {
            G_account = G_walletBar.getCurrentAccount()
            if (!G_account) {
                alert("You need to log in to transact, " + G_account);
            }
            console.log("account", G_account);
            return checkAccount(G_account);
        })
        .then(function () {
            updateUI();
            $.event.trigger({ type: "onWalletInitialised" });
        })
        .catch(function(err) {
            console.log(err);
        });
}

function testTx() {
  G_walletBar.createSecureSigner();
  return web3.eth.sendTransactionPromise({
    from: G_account,
    to: "0x5398d9454cb30778cc768253c7389dbab0f84587",
    value: 1,
    gas: 100000 })
  .then(console.log)
  .catch(console.error);
}

// Returns a Promise 
function checkAccount(account) {
  console.log("checking", account);
  if(!web3) {
    console.log("no web3");
    return null;
  }

  return Ratings.deployed().getEntitlement(dappId)
    .then(function(entitlementAddr) {
      console.log("entitlementAddr", entitlementAddr)
      return Entitlement.at(entitlementAddr).isEntitled(account);
    })
    .then(function(isIndeed) {
      console.log("isIndeed", isIndeed);
      if (!isIndeed) {
        alert("Your account is not entitled with " + dappId);
      }
    });
}

// UI only function to fixup the zindex and positioning
function fixUI() {
    $("#authBarPlaceHolder").css({
        "z-index": "1000",
        "position": "fixed",
        "top": "12px",
        "right": "64px"
    }).css
}

function updateStatusUI(isConnected) {
    var td_client = $("#status_client");

    if(isConnected) {
        td_client.html("Connected").removeClass().addClass("alert-success");
    } else {
        td_client.html("No connection").removeClass().addClass("alert-danger");
        updateNetworkUI(0);
    }
}

function updateNetworkUI(networkId) {
    var td_network = $("#status_net");

    if(networkId == NORSBORG_NETWORK_ID) {
        if (typeof publicGeth != "undefined" && publicGeth.host == publicGethHost) {
            td_network.html("Connected to " + publicGethHost).removeClass().addClass("alert-success");
        } else {
            td_network.html("Connected").removeClass().addClass("alert-success");
        }
    } else {
        td_network.html("No connection").removeClass().addClass("alert-danger");
    }
}