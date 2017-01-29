// Helps forming the request for the blockone signup

var dappInvestorId = "com.b9lab.drating.investor";
var dappAuditorId = "com.b9lab.drating.auditor";
var network = "norsborg"

var G_blockone_auth = false;
var G_account_type;

$(document).on("networkSet", function() {
  checkAccount()
    .then(function (accountType) {
      console.log("accountType", accountType);
      G_account_type = accountType;
      triggerAuth();
      updateUI();
    });
});

// Returns a Promise with the account type.
function checkAccount() {
  console.log("checking");
  if(!web3) {
    console.log("no web3");
    return null;
  }

  return web3.eth.getAccountsPromise()
    .then(function(accounts) {
      account = accounts[0];

      return Promise.all([
        Ratings.deployed().getEntitlement("com.b9lab.drating.investor"),
        Ratings.deployed().getEntitlement("com.b9lab.drating.auditor")
      ]);
      
    })
    .then(function(entitlementAddrs) {
      return Promise.all([
          Entitlement.at(entitlementAddrs[0]).isEntitled(account),
          Entitlement.at(entitlementAddrs[1]).isEntitled(account)
        ]);
    })
    .then(function(isIndeeds) {
      console.log("check entitlement", isIndeeds);
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

  var walletBar = new WalletBar({
    dappNamespace: dappId,
    blockchain: network,
    callbacks: { signOut: function () { location.reload(); } }
  });

  var web3 = web3 || new Web3(); // CHECK!
  // var myContract;
  return walletBar.applyHook(web3)
    .then(function(value) {
      console.log("value", value);
      //document.getElementById("app").style.display="";
      G_blockone_auth = true;
  // myContract = web3.eth.contract(abi).at(contractAddress);

    })
    .catch(function(err) {
      console.log(err);
    });
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