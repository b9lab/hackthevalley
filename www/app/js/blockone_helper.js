// Helps forming the request for the blockone signup

var contractInvestorAddress = "";
var contractAuditorAddress = "";
var dappInvestorId = "com.b9lab.drating.investor";
var dappAuditorId = "com.b9lab.drating.auditor";
var network = "norsborg"

var G_blockone_auth = false;
var G_account_type;

$(document).on("networkSet", function() {
  checkAccount();
  triggerAuth();
  updateUI();
});

function checkAccount(callback) {

  
  if(!web3) {
    updateUI();
    return false;
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
      console.log("check entitlement");
      if (isIndeeds[0]) {
        G_account_type = "investor";
        updateUI();
        return true;
      } else if (isIndeeds[1]) {
        G_account_type = "auditor";
        updateUI();
        return true;
      } else {
        G_account_type = "unknown";
        updateUI();
        return false;
      }
    })
}

function triggerAuth(userType)
{
  var contractAddress;
  var dappId;
  if (!userType && G_account_type)
  {
    console.log("no user type set, fetching from account type");
    userType = G_account_type;
  }

  if (userType == "investor") {
  	contractAddress = contractInvestorAddress;
  	dappId = dappInvestorId;
  } else if (userType == "auditor") {
  	contractAddress = contractAuditorAddress;
  	dappId = dappAuditorId;
  } else {

    // no user - allow signup
  	//alert("error: unknown user Type (" + userType + ")");
    contractAddress = contractInvestorAddress;
    dappId = dappInvestorId;
  }

  var walletBar = new WalletBar({
    dappNamespace: dappId,
    blockchain: network,
    callbacks: { signOut: function () { location.reload(); } }
  });

  var web3 = web3 || new Web3(); // CHECK!
  // var myContract;
  walletBar.applyHook(web3)
    .then(function() {
      //document.getElementById("app").style.display="";
      G_blockone_auth = true;
  // myContract = web3.eth.contract(abi).at(contractAddress);

      setInterval( function () {
        //alert("done"); 
      }, 1000);
    })
  .catch(function(err) {
    console.log(err);
  });
}

// Helper to update menu, etc according to user
function updateUI()
{
  console.log("update ui. Account type: " + G_account_type);
}