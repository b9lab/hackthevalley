// Helps forming the request for the blockone signup

var dappInvestorId = "com.b9lab.drating.investor";
var dappAuditorId = "com.b9lab.drating.auditor";
var network = "norsborg"

var G_blockone_auth = false;
var G_account_type;
var G_account;

var G_walletBar;

$(document).on("networkSet", function() {
  G_walletBar = new WalletBar({
    dappNamespace: dappInvestorId,
    blockchain: network,
    callbacks: { signOut: function () { location.reload(); } }
  });

  // var myContract;
  return G_walletBar.applyHook(web3)
    .then(function() {
      return waitPromise(1000);
    })
    .then(function() {
      G_account = G_walletBar.getCurrentAccount()
      if (!G_account) {
        alert("You need to log in to transact, " + G_account);
      }
      console.log("account", G_account);
      G_blockone_auth = true;
      return checkAccount(G_account);
    })
    .then(function (accountType) {
      console.log("accountType", accountType);
      G_account_type = accountType;
      triggerAuth();
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


// Returns a Promise with the account type.
function checkAccount(account) {
  console.log("checking", account);
  if(!web3) {
    console.log("no web3");
    return null;
  }

  return Promise.all([
      Ratings.deployed().getEntitlement("com.b9lab.drating.investor"),
      Ratings.deployed().getEntitlement("com.b9lab.drating.auditor")
    ])
    .then(function(entitlementAddrs) {
      console.log("entitlementAddrs", entitlementAddrs)
      return Promise.all([
          Entitlement.at(entitlementAddrs[0]).isEntitled(account),
          Entitlement.at(entitlementAddrs[1]).isEntitled(account)
        ]);
    })
    .then(function(isIndeeds) {
      console.log("isIndeeds", isIndeeds);
      if (isIndeeds[0]) {
        return "investor";
      } else if (isIndeeds[1]) {
        return "auditor";
      } else {
        return "unknown";
      }
    });
}

function triggerAuth(userType) {
  var contractAddress;
  var dappId;
  if (!userType && G_account_type)
  {
    console.log("no user type set, fetching from account type");
    userType = G_account_type;
  }

  contractAddress = Ratings.deployed().address;
  if (userType == "investor") {
  	dappId = dappInvestorId;
  } else if (userType == "auditor") {
  	dappId = dappAuditorId;
  } else {
    console.log("no user - allow signup");
    // no user - allow signup
  	//alert("error: unknown user Type (" + userType + ")");
    dappId = dappInvestorId;
  }

}

// Helper to update menu, etc according to user
function updateUI()
{
  console.log("update ui. Account type: " + G_account_type);

  btn_login = $("#M_log_in");
  btn_signup_i = $("#M_signup_investor");
  btn_signup_a = $("#M_signup_auditor");
  btn_logout = $("#M_log_out");
  lbl_info = $("#M_info_label")

  if(G_account_type == "investor" || G_account_type == "auditor") {
    btn_login.hide();
    btn_signup_a.hide();
    btn_signup_i.hide();
  } else if (G_account_type == "unknown") {
    btn_login.hide();
    btn_logout.hide();
  } else {
    btn_login.hide();
    btn_signup_a.hide();
    btn_signup_i.hide();
    btn_logout.hide();
    lbl_info.show();
  }
}