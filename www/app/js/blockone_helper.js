// Helps forming the request for the blockone signup

var contractInvestorAddress = "";
var contractAuditorAddress = "";
var dappInvestorId = "com.b9lab.drating.investor";
var dappAuditorId = "com.b9lab.drating.auditor";
var network = "norsborg"

function triggerSignup(userType)
{
  var contractAddress;
  var dappId;

  if (userType == "investor") {
  	contractAddress = contractInvestorAddress;
  	dappId = dappInvestorId;
  } else if (userType == "auditor") {
  	contractAddress = contractAuditorAddress;
  	dappId = dappAuditorId;
  } else {
  	alert("error: unknown user Type (" + userType + ")");
  }

  var walletBar = new WalletBar({
    dappNamespace: dappId,
    blockchain: network,
    callbacks: { signOut: function () { location.reload(); } }
  });

  var web3 = new Web3();
  // var myContract;
  walletBar.applyHook(web3)
    .then(function() {
      document.getElementById("app").style.display="";
  // myContract = web3.eth.contract(abi).at(contractAddress);

      setInterval( function () {
        //alert("done"); 
      }, 1000);
    })
  .catch(function(err) {
    console.log(err);
  });
}
