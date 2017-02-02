// Helps forming the request for the blockone signup

var dappId = {
    "?investor": "com.b9lab.drating.investor",
    "?auditor": "com.b9lab.drating.auditor"
  }[window.location.search] || "com.b9lab.drating.auditor";
console.log(dappId);
  var network = "norsborg"

var G_account;

var G_walletBar;

$(document).on("networkSet", function() {
  G_walletBar = new WalletBar({
    dappNamespace: dappId,
    blockchain: network,
    callbacks: { signOut: function () { location.reload(); } }
  });
  fixUI();
  updateStatusUI();

  // var myContract;
  return G_walletBar.applyHook(web3)
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
    })
    .catch(function(err) {
      console.log(err);
    });
});

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

// Helper to update menu, etc according to user
function updateUI()
{
  // not used anymore
}

// UI only function to fixup the zindex and positioning
function fixUI() {
  $("#authBarPlaceHolder").css({
    "z-index": "1000",
    "position": "fixed",
    "top": "12px",
    "right": "12px"
  }).css
}

function updateStatusUI() {
  var td_client = $("#status_client");
  var td_network = $("#status_net");

  if(web3 && web3.isConnected()) {
    td_client.html("Connected").removeClass().addClass("status-success");
  } else {
    td_client.html("No connection").removeClass().addClass("status-fail");
  }

  if(web3 && web3.version.network=="16123") {
    td_network.html("Connected").removeClass().addClass("status-success");
  } else {
    td_network.html("Not connection").removeClass().addClass("status-fail");
  }
}