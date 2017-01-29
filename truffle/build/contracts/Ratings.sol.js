var Web3 = require("web3");
var SolidityEvent = require("web3/lib/web3/event.js");

(function() {
  // Planned for future features, logging, etc.
  function Provider(provider) {
    this.provider = provider;
  }

  Provider.prototype.send = function() {
    this.provider.send.apply(this.provider, arguments);
  };

  Provider.prototype.sendAsync = function() {
    this.provider.sendAsync.apply(this.provider, arguments);
  };

  var BigNumber = (new Web3()).toBigNumber(0).constructor;

  var Utils = {
    is_object: function(val) {
      return typeof val == "object" && !Array.isArray(val);
    },
    is_big_number: function(val) {
      if (typeof val != "object") return false;

      // Instanceof won't work because we have multiple versions of Web3.
      try {
        new BigNumber(val);
        return true;
      } catch (e) {
        return false;
      }
    },
    merge: function() {
      var merged = {};
      var args = Array.prototype.slice.call(arguments);

      for (var i = 0; i < args.length; i++) {
        var object = args[i];
        var keys = Object.keys(object);
        for (var j = 0; j < keys.length; j++) {
          var key = keys[j];
          var value = object[key];
          merged[key] = value;
        }
      }

      return merged;
    },
    promisifyFunction: function(fn, C) {
      var self = this;
      return function() {
        var instance = this;

        var args = Array.prototype.slice.call(arguments);
        var tx_params = {};
        var last_arg = args[args.length - 1];

        // It's only tx_params if it's an object and not a BigNumber.
        if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
          tx_params = args.pop();
        }

        tx_params = Utils.merge(C.class_defaults, tx_params);

        return new Promise(function(accept, reject) {
          var callback = function(error, result) {
            if (error != null) {
              reject(error);
            } else {
              accept(result);
            }
          };
          args.push(tx_params, callback);
          fn.apply(instance.contract, args);
        });
      };
    },
    synchronizeFunction: function(fn, instance, C) {
      var self = this;
      return function() {
        var args = Array.prototype.slice.call(arguments);
        var tx_params = {};
        var last_arg = args[args.length - 1];

        // It's only tx_params if it's an object and not a BigNumber.
        if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
          tx_params = args.pop();
        }

        tx_params = Utils.merge(C.class_defaults, tx_params);

        return new Promise(function(accept, reject) {

          var decodeLogs = function(logs) {
            return logs.map(function(log) {
              var logABI = C.events[log.topics[0]];

              if (logABI == null) {
                return null;
              }

              var decoder = new SolidityEvent(null, logABI, instance.address);
              return decoder.decode(log);
            }).filter(function(log) {
              return log != null;
            });
          };

          var callback = function(error, tx) {
            if (error != null) {
              reject(error);
              return;
            }

            var timeout = C.synchronization_timeout || 240000;
            var start = new Date().getTime();

            var make_attempt = function() {
              C.web3.eth.getTransactionReceipt(tx, function(err, receipt) {
                if (err) return reject(err);

                if (receipt != null) {
                  // If they've opted into next gen, return more information.
                  if (C.next_gen == true) {
                    return accept({
                      tx: tx,
                      receipt: receipt,
                      logs: decodeLogs(receipt.logs)
                    });
                  } else {
                    return accept(tx);
                  }
                }

                if (timeout > 0 && new Date().getTime() - start > timeout) {
                  return reject(new Error("Transaction " + tx + " wasn't processed in " + (timeout / 1000) + " seconds!"));
                }

                setTimeout(make_attempt, 1000);
              });
            };

            make_attempt();
          };

          args.push(tx_params, callback);
          fn.apply(self, args);
        });
      };
    }
  };

  function instantiate(instance, contract) {
    instance.contract = contract;
    var constructor = instance.constructor;

    // Provision our functions.
    for (var i = 0; i < instance.abi.length; i++) {
      var item = instance.abi[i];
      if (item.type == "function") {
        if (item.constant == true) {
          instance[item.name] = Utils.promisifyFunction(contract[item.name], constructor);
        } else {
          instance[item.name] = Utils.synchronizeFunction(contract[item.name], instance, constructor);
        }

        instance[item.name].call = Utils.promisifyFunction(contract[item.name].call, constructor);
        instance[item.name].sendTransaction = Utils.promisifyFunction(contract[item.name].sendTransaction, constructor);
        instance[item.name].request = contract[item.name].request;
        instance[item.name].estimateGas = Utils.promisifyFunction(contract[item.name].estimateGas, constructor);
      }

      if (item.type == "event") {
        instance[item.name] = contract[item.name];
      }
    }

    instance.allEvents = contract.allEvents;
    instance.address = contract.address;
    instance.transactionHash = contract.transactionHash;
  };

  // Use inheritance to create a clone of this contract,
  // and copy over contract's static functions.
  function mutate(fn) {
    var temp = function Clone() { return fn.apply(this, arguments); };

    Object.keys(fn).forEach(function(key) {
      temp[key] = fn[key];
    });

    temp.prototype = Object.create(fn.prototype);
    bootstrap(temp);
    return temp;
  };

  function bootstrap(fn) {
    fn.web3 = new Web3();
    fn.class_defaults  = fn.prototype.defaults || {};

    // Set the network iniitally to make default data available and re-use code.
    // Then remove the saved network id so the network will be auto-detected on first use.
    fn.setNetwork("default");
    fn.network_id = null;
    return fn;
  };

  // Accepts a contract object created with web3.eth.contract.
  // Optionally, if called without `new`, accepts a network_id and will
  // create a new version of the contract abstraction with that network_id set.
  function Contract() {
    if (this instanceof Contract) {
      instantiate(this, arguments[0]);
    } else {
      var C = mutate(Contract);
      var network_id = arguments.length > 0 ? arguments[0] : "default";
      C.setNetwork(network_id);
      return C;
    }
  };

  Contract.currentProvider = null;

  Contract.setProvider = function(provider) {
    var wrapped = new Provider(provider);
    this.web3.setProvider(wrapped);
    this.currentProvider = provider;
  };

  Contract.new = function() {
    if (this.currentProvider == null) {
      throw new Error("Ratings error: Please call setProvider() first before calling new().");
    }

    var args = Array.prototype.slice.call(arguments);

    if (!this.unlinked_binary) {
      throw new Error("Ratings error: contract binary not set. Can't deploy new instance.");
    }

    var regex = /__[^_]+_+/g;
    var unlinked_libraries = this.binary.match(regex);

    if (unlinked_libraries != null) {
      unlinked_libraries = unlinked_libraries.map(function(name) {
        // Remove underscores
        return name.replace(/_/g, "");
      }).sort().filter(function(name, index, arr) {
        // Remove duplicates
        if (index + 1 >= arr.length) {
          return true;
        }

        return name != arr[index + 1];
      }).join(", ");

      throw new Error("Ratings contains unresolved libraries. You must deploy and link the following libraries before you can deploy a new version of Ratings: " + unlinked_libraries);
    }

    var self = this;

    return new Promise(function(accept, reject) {
      var contract_class = self.web3.eth.contract(self.abi);
      var tx_params = {};
      var last_arg = args[args.length - 1];

      // It's only tx_params if it's an object and not a BigNumber.
      if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
        tx_params = args.pop();
      }

      tx_params = Utils.merge(self.class_defaults, tx_params);

      if (tx_params.data == null) {
        tx_params.data = self.binary;
      }

      // web3 0.9.0 and above calls new twice this callback twice.
      // Why, I have no idea...
      var intermediary = function(err, web3_instance) {
        if (err != null) {
          reject(err);
          return;
        }

        if (err == null && web3_instance != null && web3_instance.address != null) {
          accept(new self(web3_instance));
        }
      };

      args.push(tx_params, intermediary);
      contract_class.new.apply(contract_class, args);
    });
  };

  Contract.at = function(address) {
    if (address == null || typeof address != "string" || address.length != 42) {
      throw new Error("Invalid address passed to Ratings.at(): " + address);
    }

    var contract_class = this.web3.eth.contract(this.abi);
    var contract = contract_class.at(address);

    return new this(contract);
  };

  Contract.deployed = function() {
    if (!this.address) {
      throw new Error("Cannot find deployed address: Ratings not deployed or address not set.");
    }

    return this.at(this.address);
  };

  Contract.defaults = function(class_defaults) {
    if (this.class_defaults == null) {
      this.class_defaults = {};
    }

    if (class_defaults == null) {
      class_defaults = {};
    }

    var self = this;
    Object.keys(class_defaults).forEach(function(key) {
      var value = class_defaults[key];
      self.class_defaults[key] = value;
    });

    return this.class_defaults;
  };

  Contract.extend = function() {
    var args = Array.prototype.slice.call(arguments);

    for (var i = 0; i < arguments.length; i++) {
      var object = arguments[i];
      var keys = Object.keys(object);
      for (var j = 0; j < keys.length; j++) {
        var key = keys[j];
        var value = object[key];
        this.prototype[key] = value;
      }
    }
  };

  Contract.all_networks = {
  "16123": {
    "abi": [
      {
        "constant": false,
        "inputs": [
          {
            "name": "key",
            "type": "bytes32"
          },
          {
            "name": "permid",
            "type": "bytes32"
          }
        ],
        "name": "joinRating",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "",
            "type": "bytes32"
          }
        ],
        "name": "requestForRatings",
        "outputs": [
          {
            "name": "permid",
            "type": "bytes32"
          },
          {
            "name": "totalInteractions",
            "type": "uint256"
          },
          {
            "name": "deadline",
            "type": "uint256"
          },
          {
            "name": "reward",
            "type": "uint256"
          },
          {
            "name": "maxAuditors",
            "type": "uint256"
          },
          {
            "name": "auditorCount",
            "type": "uint256"
          },
          {
            "name": "submissionCount",
            "type": "uint256"
          },
          {
            "name": "status",
            "type": "uint8"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "requestId",
            "type": "uint256"
          },
          {
            "name": "reason",
            "type": "uint256"
          }
        ],
        "name": "respondError_EntityConnect",
        "outputs": [],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "key",
            "type": "bytes32"
          },
          {
            "name": "auditorAddr",
            "type": "address"
          }
        ],
        "name": "getAuditor",
        "outputs": [
          {
            "name": "joined",
            "type": "bool"
          },
          {
            "name": "rating",
            "type": "uint256"
          },
          {
            "name": "ipfsHash",
            "type": "string"
          },
          {
            "name": "paid",
            "type": "bool"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "key",
            "type": "bytes32"
          }
        ],
        "name": "contributeToRequestForRating",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "payable": true,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "key",
            "type": "bytes32"
          }
        ],
        "name": "requestRefund",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "key",
            "type": "bytes32"
          }
        ],
        "name": "getInfo",
        "outputs": [
          {
            "name": "ipfsHash",
            "type": "string"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "description",
            "type": "string"
          },
          {
            "name": "ric",
            "type": "string"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "registry",
        "outputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "name": "requests",
        "outputs": [
          {
            "name": "key",
            "type": "bytes32"
          },
          {
            "name": "auditorAddr",
            "type": "address"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "getOracle",
        "outputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "requestId",
            "type": "uint256"
          },
          {
            "name": "connections",
            "type": "uint256"
          }
        ],
        "name": "respondSuccess_EntityConnect",
        "outputs": [],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "key",
            "type": "bytes32"
          },
          {
            "name": "rating",
            "type": "uint256"
          },
          {
            "name": "ipfsHash",
            "type": "string"
          }
        ],
        "name": "submitRating",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "description",
            "type": "string"
          },
          {
            "name": "ric",
            "type": "string"
          },
          {
            "name": "permid",
            "type": "bytes32"
          },
          {
            "name": "deadline",
            "type": "uint256"
          },
          {
            "name": "maxAuditors",
            "type": "uint256"
          },
          {
            "name": "ipfsHash",
            "type": "string"
          }
        ],
        "name": "submitRequestForRating",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "payable": true,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "uri1",
            "type": "bytes32"
          },
          {
            "name": "uri2",
            "type": "bytes32"
          },
          {
            "name": "level",
            "type": "uint256"
          }
        ],
        "name": "request_EntityConnect",
        "outputs": [
          {
            "name": "requestId",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "ricUri",
        "outputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "key",
            "type": "bytes32"
          }
        ],
        "name": "requestPayout",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "name",
            "type": "string"
          }
        ],
        "name": "getEntitlement",
        "outputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "inputs": [
          {
            "name": "entitlementRegistry",
            "type": "address"
          },
          {
            "name": "ricUriAddress",
            "type": "address"
          }
        ],
        "payable": false,
        "type": "constructor"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "investor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "ipfsHash",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "name",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "description",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "ric",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "permid",
            "type": "bytes32"
          },
          {
            "indexed": false,
            "name": "deadline",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "maxAuditors",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "reward",
            "type": "uint256"
          }
        ],
        "name": "LogRequestForRatingSubmitted",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": false,
            "name": "totalInteractions",
            "type": "uint256"
          }
        ],
        "name": "LogRequestForRatingInteractionsUpdated",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "investor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "contribution",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "totalReward",
            "type": "uint256"
          }
        ],
        "name": "LogRequestForRatingContributed",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "auditor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "permid",
            "type": "bytes32"
          },
          {
            "indexed": false,
            "name": "auditorCount",
            "type": "uint256"
          }
        ],
        "name": "LogAuditorJoined",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "auditor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "rating",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "ipfsHash",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "submissionCount",
            "type": "uint256"
          }
        ],
        "name": "LogAuditorSubmitted",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "auditor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "totalConnections",
            "type": "uint256"
          }
        ],
        "name": "LogAuditorConnectionsUpdated",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "auditor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "reward",
            "type": "uint256"
          }
        ],
        "name": "LogAuditorPaid",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "investor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "contribution",
            "type": "uint256"
          }
        ],
        "name": "LogInvestorRefunded",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "requestId",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": false,
            "name": "auditorAddr",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "reason",
            "type": "uint256"
          }
        ],
        "name": "LogEntityConnect_onOracleFailure",
        "type": "event"
      }
    ],
    "unlinked_binary": "0x606060405234610000576040516040806123668339810160405280516020909101515b815b825b600160a060020a038116151561003b57610000565b60008054600160a060020a031916600160a060020a0383161790555b5060018054600160a060020a03191633600160a060020a03161790555b5060048054600160a060020a031916600160a060020a0383161790555b50505b6122c3806100a36000396000f300606060405236156100d55763ffffffff60e060020a6000350416630fa92d7281146100da57806318bf9a421461010157806320b084821461016b57806351093ba71461018057806369a75e481461023a578063775274a1146102595780637a02dc061461027d5780637b1039991461046557806381d12c581461048e578063833b1fce146104bf57806383d04ed4146104e857806397719429146104fd5780639ab1072914610568578063a0cf91f514610691578063b3b200d6146106b9578063bfde8994146106e2578063cbaaa3ac14610706575b610000565b34610000576100ed600435602435610775565b604080519115158252519081900360200190f35b3461000057610111600435610995565b60405180896000191660001916815260200188815260200187815260200186815260200185815260200184815260200183815260200182600281116100005760ff1681526020019850505050505050505060405180910390f35b346100005761017e6004356024356109df565b005b346100005761019c600435600160a060020a0360243516610a4a565b604080518515158152602080820186905283151560608301526080928201838152855193830193909352845191929160a084019186019080838382156101fd575b8051825260208311156101fd57601f1990920191602091820191016101dd565b505050905090810190601f1680156102295780820380516001836020036101000a031916815260200191505b509550505050505060405180910390f35b6100ed600435610b37565b604080519115158252519081900360200190f35b34610000576100ed600435610cbc565b604080519115158252519081900360200190f35b346100005761028d600435610ec2565b60405180806020018060200180602001806020018581038552898181518152602001915080519060200190808383600083146102e4575b8051825260208311156102e457601f1990920191602091820191016102c4565b505050905090810190601f1680156103105780820380516001836020036101000a031916815260200191505b5085810384528851815288516020918201918a0190808383821561034f575b80518252602083111561034f57601f19909201916020918201910161032f565b505050905090810190601f16801561037b5780820380516001836020036101000a031916815260200191505b50858103835287518152875160209182019189019080838382156103ba575b8051825260208311156103ba57601f19909201916020918201910161039a565b505050905090810190601f1680156103e65780820380516001836020036101000a031916815260200191505b5085810382528651815286516020918201918801908083838215610425575b80518252602083111561042557601f199092019160209182019101610405565b505050905090810190601f1680156104515780820380516001836020036101000a031916815260200191505b509850505050505050505060405180910390f35b34610000576104726111c1565b60408051600160a060020a039092168252519081900360200190f35b346100005761049e6004356111d0565b60408051928352600160a060020a0390911660208301528051918290030190f35b34610000576104726111f2565b60408051600160a060020a039092168252519081900360200190f35b346100005761017e600435602435611239565b005b3461000057604080516020600460443581810135601f81018490048402850184019095528484526100ed94823594602480359560649492939190920191819084018382808284375094965061134795505050505050565b604080519115158252519081900360200190f35b6100ed600480803590602001908201803590602001908080601f0160208091040260200160405190810160405280939291908181526020018383808284375050604080516020601f89358b0180359182018390048302840183019094528083529799988101979196509182019450925082915084018382808284375050604080516020601f89358b0180359182018390048302840183019094528083529799988101979196509182019450925082915084018382808284375050604080516020601f60608a01358b0180359182018390048302840183018552818452989a8a359a838101359a958101359950909750608001955091935091820191819084018382808284375094965061162495505050505050565b604080519115158252519081900360200190f35b34610000576106a7600435602435604435611ea9565b60408051918252519081900360200190f35b3461000057610472611f42565b60408051600160a060020a039092168252519081900360200190f35b34610000576100ed600435611f51565b604080519115158252519081900360200190f35b3461000057610472600480803590602001908201803590602001908080601f016020809104026020016040519081016040528093929190818152602001838380828437509496506121ac95505050505050565b60408051600160a060020a039092168252519081900360200190f35b60006000600060006107bc604060405190810160405280601981526020017f636f6d2e62396c61622e64726174696e672e61756469746f72000000000000008152506121ac565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f115610000575050604051511515905061083557610000565b6000868152600260209081526040808320600160a060020a033316845260098101909252909120815491945092501580610876575082600501548360070154145b806108825750815460ff165b806108905750428360030154105b806108ab57506000600a84015460ff16600281116100005714155b156108b557610000565b815460ff191660019081178355828101869055600784018054909101908190556040805187815260208101929092528051600160a060020a0333169289927f95da4141adb67f5e6115a397ab18effd384b61e1b6439828b280c972f77f2b6192918290030190a361092c8360010154866002611ea9565b60408051808201825288815233600160a060020a03908116602080840191825260008681526003909152939093209151825591516001918201805473ffffffffffffffffffffffffffffffffffffffff19169190931617909155945090505b5b50505092915050565b600260208190526000918252604090912060018101549181015460038201546004830154600584015460078501546008860154600a90960154949593949293919290919060ff1688565b60008281526003602090815260409182902080546001820154845187815293840191909152600160a060020a0316828401526060820184905291517f2ceea0c5abdb44d3a9d97bbdff7b4197935427d1205e06ed0b6334a0c4aef7e49181900360800190a15b505050565b604080516020808201835260008083528581526002808352848220600160a060020a038716835260090183528482208054600382015460058301546004840180548a516000196101006001841615020190911696909604601f8101899004890287018901909a5289865295988998978997959660ff95861696949590931692918491830182828015610b1d5780601f10610af257610100808354040283529160200191610b1d565b820191906000526020600020905b815481529060010190602001808311610b0057829003601f168201915b5050505050915094509450945094505b5092959194509250565b60006000610b7a604060405190810160405280601a81526020017f636f6d2e62396c61622e64726174696e672e696e766573746f720000000000008152506121ac565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f1156100005750506040515115159050610bf357610000565b506000828152600260205260409020341580610c0e57508054155b80610c1c5750428160030154105b80610c3757506000600a82015460ff16600281116100005714155b15610c4157610000565b600481018054349081018255600160a060020a033316600081815260068501602090815260409182902080548501905593548151938452938301939093528251909286927f3c3e5cbebfd0ef81bf2f3fb207432b7c74d47759fa64a631c485184486211b0d929081900390910190a3600191505b5b50919050565b6000600060006000610d03604060405190810160405280601a81526020017f636f6d2e62396c61622e64726174696e672e696e766573746f720000000000008152506121ac565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f1156100005750506040515115159050610d7c57610000565b60008581526002602052604081209350600a84015460ff1660028111610000571415610de457428360030154108015610db757506008830154155b83549092501580610dc6575081155b15610dd057610000565b600a8301805460ff19166001179055610e06565b6001600a84015460ff16600281116100005714156100d557610e06565b610000565b5b600160a060020a03331660009081526006840160205260409020541515610e2d57610000565b50600160a060020a0333166000818152600684016020526040808220805490839055905190929183156108fc02918491818181858888f193505050501515610e7457610000565b604080518281529051600160a060020a0333169187917f4ae7c15cd04d8a5097b1f1fda073a122b3d11db2fa19a1d50b62e525bb165d159181900360200190a3600193505b5b505050919050565b604080516020818101835260008083528351808301855281815284518084018652828152855180850187528381528784526002909452948220805494959194919392909182919081101561000057906000526020600020900160005b50816000016001815481101561000057906000526020600020900160005b50826000016002815481101561000057906000526020600020900160005b50836000016003815481101561000057906000526020600020900160005b508354604080516020601f60026000196101006001881615020190951694909404938401819004810282018101909252828152918691830182828015610fff5780601f10610fd457610100808354040283529160200191610fff565b820191906000526020600020905b815481529060010190602001808311610fe257829003601f168201915b5050865460408051602060026001851615610100026000190190941693909304601f81018490048402820184019092528181529599508894509250840190508282801561108d5780601f106110625761010080835404028352916020019161108d565b820191906000526020600020905b81548152906001019060200180831161107057829003601f168201915b5050855460408051602060026001851615610100026000190190941693909304601f81018490048402820184019092528181529598508794509250840190508282801561111b5780601f106110f05761010080835404028352916020019161111b565b820191906000526020600020905b8154815290600101906020018083116110fe57829003601f168201915b5050845460408051602060026001851615610100026000190190941693909304601f8101849004840282018401909252818152959750869450925084019050828280156111a95780601f1061117e576101008083540402835291602001916111a9565b820191906000526020600020905b81548152906001019060200180831161118c57829003601f168201915b5050505050905094509450945094505b509193509193565b600054600160a060020a031681565b60036020526000908152604090208054600190910154600160a060020a031682565b6000611233604060405190810160405280601281526020017f636f6d2e74722e6f7261636c652e6d61696e00000000000000000000000000008152506121ac565b90505b90565b60008281526003602090815260408083208054845260029092528220805491929091151561126657610000565b6001830154600160a060020a031615156112c257600282018490558254604080519182526020820186905280517f628bb69279bd65600574e8ddfa88d50be8bbda1cf43770a625bae887a8e234679281900390910190a161133f565b506001820154600160a060020a031660009081526009820160205260409020805460ff1615156112f157610000565b6002810184905560018301548354604080518781529051600160a060020a03909316927f366bf687a93739365a87108639fbb6111b51b4a5db092feef1ee0b934c23996d9181900360200190a35b5b5050505050565b60006000600061138c604060405190810160405280601981526020017f636f6d2e62396c61622e64726174696e672e61756469746f72000000000000008152506121ac565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f115610000575050604051511515905061140557610000565b50506000848152600260209081526040808320600160a060020a0333168452600981019092529091208154158061143e5750805460ff16155b8061144c5750428260030154105b8061145657508351155b8061147157506000600a83015460ff16600281116100005714155b1561147b57610000565b60048101546002600019610100600184161502019091160415156114a55760088201805460010190555b84816003018190555083816004019080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f106114fc57805160ff1916838001178555611529565b82800160010185558215611529579182015b8281111561152957825182559160200191906001019061150e565b5b5061154a9291505b808211156115465760008155600101611532565b5090565b505033600160a060020a031686600019167f561d692d608576714937a081b8dcd88b472f1781c31a856faddba126374d61a98787866008015460405180848152602001806020018381526020018281038252848181518152602001915080519060200190808383600083146115da575b8051825260208311156115da57601f1990920191602091820191016115ba565b505050905090810190601f1680156116065780820380516001836020036101000a031916815260200191505b5094505050505060405180910390a3600192505b5b50509392505050565b6000808080341580611634575085155b8061163e57508451155b806116495750428711155b1561165357610000565b338b8b8b8b8b348c8c43604051808b600160a060020a0316600160a060020a03166c010000000000000000000000000281526014018a805190602001908083835b602083106116b35780518252601f199092019160209182019101611694565b51815160209384036101000a60001901801990921691161790528c5191909301928c0191508083835b602083106116fb5780518252601f1990920191602091820191016116dc565b51815160209384036101000a60001901801990921691161790528b5191909301928b0191508083835b602083106117435780518252601f199092019160209182019101611724565b51815160209384036101000a6000190180199092169116179052920189815280830189905260408101889052606081018790528551608090910192860191508083835b602083106117a55780518252601f199092019160209182019101611786565b51815160209384036101000a600019018019909216911617905292019384525060408051938490038201909320600081815260029092529290208054929e509c50501598506117fc97505050505050505057610000565b60058260000181815481835581811511611894576000838152602090206118949181019083015b8082111561154657600081805460018160011615610100020316600290046000825580601f106118535750611885565b601f01602090049060005260206000209081019061188591905b808211156115465760008155600101611532565b5090565b5b5050600101611823565b5090565b5b5050505084826000016000815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061190157805160ff191683800117855561192e565b8280016001018555821561192e579182015b8281111561192e578251825591602001919060010190611913565b5b5061194f9291505b808211156115465760008155600101611532565b5090565b50508a826000016001815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f106119b957805160ff19168380011785556119e6565b828001600101855582156119e6579182015b828111156119e65782518255916020019190600101906119cb565b5b50611a079291505b808211156115465760008155600101611532565b5090565b505089826000016002815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f10611a7157805160ff1916838001178555611a9e565b82800160010185558215611a9e579182015b82811115611a9e578251825591602001919060010190611a83565b5b50611abf9291505b808211156115465760008155600101611532565b5090565b505088826000016003815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f10611b2957805160ff1916838001178555611b56565b82800160010185558215611b56579182015b82811115611b56578251825591602001919060010190611b3b565b5b50611b779291505b808211156115465760008155600101611532565b5090565b50506001808301899055600383018890553460048401556005830187905560006007840181905560088401819055600a840180549192909160ff19169083021790555034600260008560001916600019168152602001908152602001600020600601600033600160a060020a0316600160a060020a031681526020019081526020016000208190555033600160a060020a031683600019167fe71563df7df4537ddb6eddb7a4db12751ef8eda9232c907002245ea44a38b345878e8e8e8e8e8e346040518080602001806020018060200180602001896000191660001916815260200188815260200187815260200186815260200185810385528d818151815260200191508051906020019080838360008314611caf575b805182526020831115611caf57601f199092019160209182019101611c8f565b505050905090810190601f168015611cdb5780820380516001836020036101000a031916815260200191505b5085810384528c5181528c516020918201918e01908083838215611d1a575b805182526020831115611d1a57601f199092019160209182019101611cfa565b505050905090810190601f168015611d465780820380516001836020036101000a031916815260200191505b5085810383528b5181528b516020918201918d01908083838215611d85575b805182526020831115611d8557601f199092019160209182019101611d65565b505050905090810190601f168015611db15780820380516001836020036101000a031916815260200191505b5085810382528a5181528a516020918201918c01908083838215611df0575b805182526020831115611df057601f199092019160209182019101611dd0565b505050905090810190601f168015611e1c5780820380516001836020036101000a031916815260200191505b509c5050505050505050505050505060405180910390a3611e408860006001611ea9565b6040805180820182528581526000602080830182815285835260039091529290209051815590516001918201805473ffffffffffffffffffffffffffffffffffffffff1916600160a060020a03909216919091179055945090505b505050979650505050505050565b6000611eb36111f2565b604080516000602091820181905282517fa0cf91f50000000000000000000000000000000000000000000000000000000081526004810189905260248101889052604481018790529251600160a060020a03949094169363a0cf91f59360648082019493918390030190829087803b156100005760325a03f115610000575050604051519150505b9392505050565b600454600160a060020a031681565b60006000600060006000611f9a604060405190810160405280601981526020017f636f6d2e62396c61622e64726174696e672e61756469746f72000000000000008152506121ac565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f115610000575050604051511515905061201357610000565b6000868152600260209081526040808320600160a060020a03331684526009810190925282209095509350600a85015460ff16600281116100005714156120a757428460030154108061206d575083600501548460080154145b8454909250158061208057506008840154155b80612089575081155b1561209357610000565b600a8401805460ff191660021790556120c9565b6002600a85015460ff16600281116100005714156100d5576120c9565b610000565b5b825460ff1615806120f05750600483015460026000196101006001841615020190911604155b806120ff5750600583015460ff165b1561210957610000565b60058301805460ff19166001179055600884015460048501548115610000576040519190049150600160a060020a0333169082156108fc029083906000818181858888f19350505050151561215d57610000565b604080518281529051600160a060020a0333169188917f31bfdeff7497910d6af7611e390ea041175d3897520804a90d9d3c8d8c91c5d09181900360200190a3600194505b5b50505050919050565b6000805460408051602090810184905290517fdc5acb9000000000000000000000000000000000000000000000000000000000815260048101828152855160248301528551600160a060020a039094169363dc5acb909387938392604490910191850190808383821561223a575b80518252602083111561223a57601f19909201916020918201910161221a565b505050905090810190601f1680156122665780820380516001836020036101000a031916815260200191505b5092505050602060405180830381600087803b156100005760325a03f115610000575050604051519150505b9190505600a165627a7a72305820d607568a4ae6909d048c67bbced587e5ab36366dad0cb28c906535629cc747940029",
    "events": {
      "0x7332583e40367a020551753fffdb500c9a44e697d4ad2950edf96a4b9e60216a": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "investor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "ipfsHash",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "name",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "description",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "ric",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "uri",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "deadline",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "maxAuditors",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "reward",
            "type": "uint256"
          }
        ],
        "name": "LogRequestForRatingSubmitted",
        "type": "event"
      },
      "0x3c3e5cbebfd0ef81bf2f3fb207432b7c74d47759fa64a631c485184486211b0d": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "investor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "contribution",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "totalReward",
            "type": "uint256"
          }
        ],
        "name": "LogRequestForRatingContributed",
        "type": "event"
      },
      "0xc8350213f5030bd4e879cb2eeb4fa2f7f4d318e117772767d25c9c9bc4592e8e": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "auditor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "auditorCount",
            "type": "uint256"
          }
        ],
        "name": "LogAuditorJoined",
        "type": "event"
      },
      "0x561d692d608576714937a081b8dcd88b472f1781c31a856faddba126374d61a9": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "auditor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "rating",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "ipfsHash",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "submissionCount",
            "type": "uint256"
          }
        ],
        "name": "LogAuditorSubmitted",
        "type": "event"
      },
      "0x31bfdeff7497910d6af7611e390ea041175d3897520804a90d9d3c8d8c91c5d0": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "auditor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "reward",
            "type": "uint256"
          }
        ],
        "name": "LogAuditorPaid",
        "type": "event"
      },
      "0x4ae7c15cd04d8a5097b1f1fda073a122b3d11db2fa19a1d50b62e525bb165d15": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "investor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "contribution",
            "type": "uint256"
          }
        ],
        "name": "LogInvestorRefunded",
        "type": "event"
      },
      "0xe71563df7df4537ddb6eddb7a4db12751ef8eda9232c907002245ea44a38b345": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "investor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "ipfsHash",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "name",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "description",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "ric",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "permid",
            "type": "bytes32"
          },
          {
            "indexed": false,
            "name": "deadline",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "maxAuditors",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "reward",
            "type": "uint256"
          }
        ],
        "name": "LogRequestForRatingSubmitted",
        "type": "event"
      },
      "0x628bb69279bd65600574e8ddfa88d50be8bbda1cf43770a625bae887a8e23467": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": false,
            "name": "totalInteractions",
            "type": "uint256"
          }
        ],
        "name": "LogRequestForRatingInteractionsUpdated",
        "type": "event"
      },
      "0x95da4141adb67f5e6115a397ab18effd384b61e1b6439828b280c972f77f2b61": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "auditor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "permid",
            "type": "bytes32"
          },
          {
            "indexed": false,
            "name": "auditorCount",
            "type": "uint256"
          }
        ],
        "name": "LogAuditorJoined",
        "type": "event"
      },
      "0x366bf687a93739365a87108639fbb6111b51b4a5db092feef1ee0b934c23996d": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "auditor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "totalConnections",
            "type": "uint256"
          }
        ],
        "name": "LogAuditorConnectionsUpdated",
        "type": "event"
      },
      "0x2ceea0c5abdb44d3a9d97bbdff7b4197935427d1205e06ed0b6334a0c4aef7e4": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "requestId",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": false,
            "name": "auditorAddr",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "reason",
            "type": "uint256"
          }
        ],
        "name": "LogEntityConnect_onOracleFailure",
        "type": "event"
      }
    },
    "updated_at": 1485652632411,
    "links": {},
    "address": "0x86ee7167c4920504dd985b70e5e1db117460708a"
  },
  "default": {
    "abi": [
      {
        "constant": false,
        "inputs": [
          {
            "name": "key",
            "type": "bytes32"
          },
          {
            "name": "permid",
            "type": "bytes32"
          }
        ],
        "name": "joinRating",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "",
            "type": "bytes32"
          }
        ],
        "name": "requestForRatings",
        "outputs": [
          {
            "name": "permid",
            "type": "bytes32"
          },
          {
            "name": "totalInteractions",
            "type": "uint256"
          },
          {
            "name": "deadline",
            "type": "uint256"
          },
          {
            "name": "reward",
            "type": "uint256"
          },
          {
            "name": "maxAuditors",
            "type": "uint256"
          },
          {
            "name": "auditorCount",
            "type": "uint256"
          },
          {
            "name": "submissionCount",
            "type": "uint256"
          },
          {
            "name": "status",
            "type": "uint8"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "requestId",
            "type": "uint256"
          },
          {
            "name": "reason",
            "type": "uint256"
          }
        ],
        "name": "respondError_EntityConnect",
        "outputs": [],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "key",
            "type": "bytes32"
          },
          {
            "name": "auditorAddr",
            "type": "address"
          }
        ],
        "name": "getAuditor",
        "outputs": [
          {
            "name": "joined",
            "type": "bool"
          },
          {
            "name": "rating",
            "type": "uint256"
          },
          {
            "name": "ipfsHash",
            "type": "string"
          },
          {
            "name": "paid",
            "type": "bool"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "key",
            "type": "bytes32"
          }
        ],
        "name": "contributeToRequestForRating",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "payable": true,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "key",
            "type": "bytes32"
          }
        ],
        "name": "requestRefund",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "key",
            "type": "bytes32"
          }
        ],
        "name": "getInfo",
        "outputs": [
          {
            "name": "ipfsHash",
            "type": "string"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "description",
            "type": "string"
          },
          {
            "name": "ric",
            "type": "string"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "registry",
        "outputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "name": "requests",
        "outputs": [
          {
            "name": "key",
            "type": "bytes32"
          },
          {
            "name": "auditorAddr",
            "type": "address"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "getOracle",
        "outputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "requestId",
            "type": "uint256"
          },
          {
            "name": "connections",
            "type": "uint256"
          }
        ],
        "name": "respondSuccess_EntityConnect",
        "outputs": [],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "key",
            "type": "bytes32"
          },
          {
            "name": "rating",
            "type": "uint256"
          },
          {
            "name": "ipfsHash",
            "type": "string"
          }
        ],
        "name": "submitRating",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "description",
            "type": "string"
          },
          {
            "name": "ric",
            "type": "string"
          },
          {
            "name": "permid",
            "type": "bytes32"
          },
          {
            "name": "deadline",
            "type": "uint256"
          },
          {
            "name": "maxAuditors",
            "type": "uint256"
          },
          {
            "name": "ipfsHash",
            "type": "string"
          }
        ],
        "name": "submitRequestForRating",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "payable": true,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "uri1",
            "type": "bytes32"
          },
          {
            "name": "uri2",
            "type": "bytes32"
          },
          {
            "name": "level",
            "type": "uint256"
          }
        ],
        "name": "request_EntityConnect",
        "outputs": [
          {
            "name": "requestId",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "ricUri",
        "outputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "key",
            "type": "bytes32"
          }
        ],
        "name": "requestPayout",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "name",
            "type": "string"
          }
        ],
        "name": "getEntitlement",
        "outputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "inputs": [
          {
            "name": "entitlementRegistry",
            "type": "address"
          },
          {
            "name": "ricUriAddress",
            "type": "address"
          }
        ],
        "payable": false,
        "type": "constructor"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "investor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "ipfsHash",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "name",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "description",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "ric",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "permid",
            "type": "bytes32"
          },
          {
            "indexed": false,
            "name": "deadline",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "maxAuditors",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "reward",
            "type": "uint256"
          }
        ],
        "name": "LogRequestForRatingSubmitted",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": false,
            "name": "totalInteractions",
            "type": "uint256"
          }
        ],
        "name": "LogRequestForRatingInteractionsUpdated",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "investor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "contribution",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "totalReward",
            "type": "uint256"
          }
        ],
        "name": "LogRequestForRatingContributed",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "auditor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "permid",
            "type": "bytes32"
          },
          {
            "indexed": false,
            "name": "auditorCount",
            "type": "uint256"
          }
        ],
        "name": "LogAuditorJoined",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "auditor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "rating",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "ipfsHash",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "submissionCount",
            "type": "uint256"
          }
        ],
        "name": "LogAuditorSubmitted",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "auditor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "totalConnections",
            "type": "uint256"
          }
        ],
        "name": "LogAuditorConnectionsUpdated",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "auditor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "reward",
            "type": "uint256"
          }
        ],
        "name": "LogAuditorPaid",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "investor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "contribution",
            "type": "uint256"
          }
        ],
        "name": "LogInvestorRefunded",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "requestId",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": false,
            "name": "auditorAddr",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "reason",
            "type": "uint256"
          }
        ],
        "name": "LogEntityConnect_onOracleFailure",
        "type": "event"
      }
    ],
    "unlinked_binary": "0x606060405234610000576040516040806123668339810160405280516020909101515b815b825b600160a060020a038116151561003b57610000565b60008054600160a060020a031916600160a060020a0383161790555b5060018054600160a060020a03191633600160a060020a03161790555b5060048054600160a060020a031916600160a060020a0383161790555b50505b6122c3806100a36000396000f300606060405236156100d55763ffffffff60e060020a6000350416630fa92d7281146100da57806318bf9a421461010157806320b084821461016b57806351093ba71461018057806369a75e481461023a578063775274a1146102595780637a02dc061461027d5780637b1039991461046557806381d12c581461048e578063833b1fce146104bf57806383d04ed4146104e857806397719429146104fd5780639ab1072914610568578063a0cf91f514610691578063b3b200d6146106b9578063bfde8994146106e2578063cbaaa3ac14610706575b610000565b34610000576100ed600435602435610775565b604080519115158252519081900360200190f35b3461000057610111600435610995565b60405180896000191660001916815260200188815260200187815260200186815260200185815260200184815260200183815260200182600281116100005760ff1681526020019850505050505050505060405180910390f35b346100005761017e6004356024356109df565b005b346100005761019c600435600160a060020a0360243516610a4a565b604080518515158152602080820186905283151560608301526080928201838152855193830193909352845191929160a084019186019080838382156101fd575b8051825260208311156101fd57601f1990920191602091820191016101dd565b505050905090810190601f1680156102295780820380516001836020036101000a031916815260200191505b509550505050505060405180910390f35b6100ed600435610b37565b604080519115158252519081900360200190f35b34610000576100ed600435610cbc565b604080519115158252519081900360200190f35b346100005761028d600435610ec2565b60405180806020018060200180602001806020018581038552898181518152602001915080519060200190808383600083146102e4575b8051825260208311156102e457601f1990920191602091820191016102c4565b505050905090810190601f1680156103105780820380516001836020036101000a031916815260200191505b5085810384528851815288516020918201918a0190808383821561034f575b80518252602083111561034f57601f19909201916020918201910161032f565b505050905090810190601f16801561037b5780820380516001836020036101000a031916815260200191505b50858103835287518152875160209182019189019080838382156103ba575b8051825260208311156103ba57601f19909201916020918201910161039a565b505050905090810190601f1680156103e65780820380516001836020036101000a031916815260200191505b5085810382528651815286516020918201918801908083838215610425575b80518252602083111561042557601f199092019160209182019101610405565b505050905090810190601f1680156104515780820380516001836020036101000a031916815260200191505b509850505050505050505060405180910390f35b34610000576104726111c1565b60408051600160a060020a039092168252519081900360200190f35b346100005761049e6004356111d0565b60408051928352600160a060020a0390911660208301528051918290030190f35b34610000576104726111f2565b60408051600160a060020a039092168252519081900360200190f35b346100005761017e600435602435611239565b005b3461000057604080516020600460443581810135601f81018490048402850184019095528484526100ed94823594602480359560649492939190920191819084018382808284375094965061134795505050505050565b604080519115158252519081900360200190f35b6100ed600480803590602001908201803590602001908080601f0160208091040260200160405190810160405280939291908181526020018383808284375050604080516020601f89358b0180359182018390048302840183019094528083529799988101979196509182019450925082915084018382808284375050604080516020601f89358b0180359182018390048302840183019094528083529799988101979196509182019450925082915084018382808284375050604080516020601f60608a01358b0180359182018390048302840183018552818452989a8a359a838101359a958101359950909750608001955091935091820191819084018382808284375094965061162495505050505050565b604080519115158252519081900360200190f35b34610000576106a7600435602435604435611ea9565b60408051918252519081900360200190f35b3461000057610472611f42565b60408051600160a060020a039092168252519081900360200190f35b34610000576100ed600435611f51565b604080519115158252519081900360200190f35b3461000057610472600480803590602001908201803590602001908080601f016020809104026020016040519081016040528093929190818152602001838380828437509496506121ac95505050505050565b60408051600160a060020a039092168252519081900360200190f35b60006000600060006107bc604060405190810160405280601981526020017f636f6d2e62396c61622e64726174696e672e61756469746f72000000000000008152506121ac565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f115610000575050604051511515905061083557610000565b6000868152600260209081526040808320600160a060020a033316845260098101909252909120815491945092501580610876575082600501548360070154145b806108825750815460ff165b806108905750428360030154105b806108ab57506000600a84015460ff16600281116100005714155b156108b557610000565b815460ff191660019081178355828101869055600784018054909101908190556040805187815260208101929092528051600160a060020a0333169289927f95da4141adb67f5e6115a397ab18effd384b61e1b6439828b280c972f77f2b6192918290030190a361092c8360010154866002611ea9565b60408051808201825288815233600160a060020a03908116602080840191825260008681526003909152939093209151825591516001918201805473ffffffffffffffffffffffffffffffffffffffff19169190931617909155945090505b5b50505092915050565b600260208190526000918252604090912060018101549181015460038201546004830154600584015460078501546008860154600a90960154949593949293919290919060ff1688565b60008281526003602090815260409182902080546001820154845187815293840191909152600160a060020a0316828401526060820184905291517f2ceea0c5abdb44d3a9d97bbdff7b4197935427d1205e06ed0b6334a0c4aef7e49181900360800190a15b505050565b604080516020808201835260008083528581526002808352848220600160a060020a038716835260090183528482208054600382015460058301546004840180548a516000196101006001841615020190911696909604601f8101899004890287018901909a5289865295988998978997959660ff95861696949590931692918491830182828015610b1d5780601f10610af257610100808354040283529160200191610b1d565b820191906000526020600020905b815481529060010190602001808311610b0057829003601f168201915b5050505050915094509450945094505b5092959194509250565b60006000610b7a604060405190810160405280601a81526020017f636f6d2e62396c61622e64726174696e672e696e766573746f720000000000008152506121ac565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f1156100005750506040515115159050610bf357610000565b506000828152600260205260409020341580610c0e57508054155b80610c1c5750428160030154105b80610c3757506000600a82015460ff16600281116100005714155b15610c4157610000565b600481018054349081018255600160a060020a033316600081815260068501602090815260409182902080548501905593548151938452938301939093528251909286927f3c3e5cbebfd0ef81bf2f3fb207432b7c74d47759fa64a631c485184486211b0d929081900390910190a3600191505b5b50919050565b6000600060006000610d03604060405190810160405280601a81526020017f636f6d2e62396c61622e64726174696e672e696e766573746f720000000000008152506121ac565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f1156100005750506040515115159050610d7c57610000565b60008581526002602052604081209350600a84015460ff1660028111610000571415610de457428360030154108015610db757506008830154155b83549092501580610dc6575081155b15610dd057610000565b600a8301805460ff19166001179055610e06565b6001600a84015460ff16600281116100005714156100d557610e06565b610000565b5b600160a060020a03331660009081526006840160205260409020541515610e2d57610000565b50600160a060020a0333166000818152600684016020526040808220805490839055905190929183156108fc02918491818181858888f193505050501515610e7457610000565b604080518281529051600160a060020a0333169187917f4ae7c15cd04d8a5097b1f1fda073a122b3d11db2fa19a1d50b62e525bb165d159181900360200190a3600193505b5b505050919050565b604080516020818101835260008083528351808301855281815284518084018652828152855180850187528381528784526002909452948220805494959194919392909182919081101561000057906000526020600020900160005b50816000016001815481101561000057906000526020600020900160005b50826000016002815481101561000057906000526020600020900160005b50836000016003815481101561000057906000526020600020900160005b508354604080516020601f60026000196101006001881615020190951694909404938401819004810282018101909252828152918691830182828015610fff5780601f10610fd457610100808354040283529160200191610fff565b820191906000526020600020905b815481529060010190602001808311610fe257829003601f168201915b5050865460408051602060026001851615610100026000190190941693909304601f81018490048402820184019092528181529599508894509250840190508282801561108d5780601f106110625761010080835404028352916020019161108d565b820191906000526020600020905b81548152906001019060200180831161107057829003601f168201915b5050855460408051602060026001851615610100026000190190941693909304601f81018490048402820184019092528181529598508794509250840190508282801561111b5780601f106110f05761010080835404028352916020019161111b565b820191906000526020600020905b8154815290600101906020018083116110fe57829003601f168201915b5050845460408051602060026001851615610100026000190190941693909304601f8101849004840282018401909252818152959750869450925084019050828280156111a95780601f1061117e576101008083540402835291602001916111a9565b820191906000526020600020905b81548152906001019060200180831161118c57829003601f168201915b5050505050905094509450945094505b509193509193565b600054600160a060020a031681565b60036020526000908152604090208054600190910154600160a060020a031682565b6000611233604060405190810160405280601281526020017f636f6d2e74722e6f7261636c652e6d61696e00000000000000000000000000008152506121ac565b90505b90565b60008281526003602090815260408083208054845260029092528220805491929091151561126657610000565b6001830154600160a060020a031615156112c257600282018490558254604080519182526020820186905280517f628bb69279bd65600574e8ddfa88d50be8bbda1cf43770a625bae887a8e234679281900390910190a161133f565b506001820154600160a060020a031660009081526009820160205260409020805460ff1615156112f157610000565b6002810184905560018301548354604080518781529051600160a060020a03909316927f366bf687a93739365a87108639fbb6111b51b4a5db092feef1ee0b934c23996d9181900360200190a35b5b5050505050565b60006000600061138c604060405190810160405280601981526020017f636f6d2e62396c61622e64726174696e672e61756469746f72000000000000008152506121ac565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f115610000575050604051511515905061140557610000565b50506000848152600260209081526040808320600160a060020a0333168452600981019092529091208154158061143e5750805460ff16155b8061144c5750428260030154105b8061145657508351155b8061147157506000600a83015460ff16600281116100005714155b1561147b57610000565b60048101546002600019610100600184161502019091160415156114a55760088201805460010190555b84816003018190555083816004019080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f106114fc57805160ff1916838001178555611529565b82800160010185558215611529579182015b8281111561152957825182559160200191906001019061150e565b5b5061154a9291505b808211156115465760008155600101611532565b5090565b505033600160a060020a031686600019167f561d692d608576714937a081b8dcd88b472f1781c31a856faddba126374d61a98787866008015460405180848152602001806020018381526020018281038252848181518152602001915080519060200190808383600083146115da575b8051825260208311156115da57601f1990920191602091820191016115ba565b505050905090810190601f1680156116065780820380516001836020036101000a031916815260200191505b5094505050505060405180910390a3600192505b5b50509392505050565b6000808080341580611634575085155b8061163e57508451155b806116495750428711155b1561165357610000565b338b8b8b8b8b348c8c43604051808b600160a060020a0316600160a060020a03166c010000000000000000000000000281526014018a805190602001908083835b602083106116b35780518252601f199092019160209182019101611694565b51815160209384036101000a60001901801990921691161790528c5191909301928c0191508083835b602083106116fb5780518252601f1990920191602091820191016116dc565b51815160209384036101000a60001901801990921691161790528b5191909301928b0191508083835b602083106117435780518252601f199092019160209182019101611724565b51815160209384036101000a6000190180199092169116179052920189815280830189905260408101889052606081018790528551608090910192860191508083835b602083106117a55780518252601f199092019160209182019101611786565b51815160209384036101000a600019018019909216911617905292019384525060408051938490038201909320600081815260029092529290208054929e509c50501598506117fc97505050505050505057610000565b60058260000181815481835581811511611894576000838152602090206118949181019083015b8082111561154657600081805460018160011615610100020316600290046000825580601f106118535750611885565b601f01602090049060005260206000209081019061188591905b808211156115465760008155600101611532565b5090565b5b5050600101611823565b5090565b5b5050505084826000016000815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061190157805160ff191683800117855561192e565b8280016001018555821561192e579182015b8281111561192e578251825591602001919060010190611913565b5b5061194f9291505b808211156115465760008155600101611532565b5090565b50508a826000016001815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f106119b957805160ff19168380011785556119e6565b828001600101855582156119e6579182015b828111156119e65782518255916020019190600101906119cb565b5b50611a079291505b808211156115465760008155600101611532565b5090565b505089826000016002815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f10611a7157805160ff1916838001178555611a9e565b82800160010185558215611a9e579182015b82811115611a9e578251825591602001919060010190611a83565b5b50611abf9291505b808211156115465760008155600101611532565b5090565b505088826000016003815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f10611b2957805160ff1916838001178555611b56565b82800160010185558215611b56579182015b82811115611b56578251825591602001919060010190611b3b565b5b50611b779291505b808211156115465760008155600101611532565b5090565b50506001808301899055600383018890553460048401556005830187905560006007840181905560088401819055600a840180549192909160ff19169083021790555034600260008560001916600019168152602001908152602001600020600601600033600160a060020a0316600160a060020a031681526020019081526020016000208190555033600160a060020a031683600019167fe71563df7df4537ddb6eddb7a4db12751ef8eda9232c907002245ea44a38b345878e8e8e8e8e8e346040518080602001806020018060200180602001896000191660001916815260200188815260200187815260200186815260200185810385528d818151815260200191508051906020019080838360008314611caf575b805182526020831115611caf57601f199092019160209182019101611c8f565b505050905090810190601f168015611cdb5780820380516001836020036101000a031916815260200191505b5085810384528c5181528c516020918201918e01908083838215611d1a575b805182526020831115611d1a57601f199092019160209182019101611cfa565b505050905090810190601f168015611d465780820380516001836020036101000a031916815260200191505b5085810383528b5181528b516020918201918d01908083838215611d85575b805182526020831115611d8557601f199092019160209182019101611d65565b505050905090810190601f168015611db15780820380516001836020036101000a031916815260200191505b5085810382528a5181528a516020918201918c01908083838215611df0575b805182526020831115611df057601f199092019160209182019101611dd0565b505050905090810190601f168015611e1c5780820380516001836020036101000a031916815260200191505b509c5050505050505050505050505060405180910390a3611e408860006001611ea9565b6040805180820182528581526000602080830182815285835260039091529290209051815590516001918201805473ffffffffffffffffffffffffffffffffffffffff1916600160a060020a03909216919091179055945090505b505050979650505050505050565b6000611eb36111f2565b604080516000602091820181905282517fa0cf91f50000000000000000000000000000000000000000000000000000000081526004810189905260248101889052604481018790529251600160a060020a03949094169363a0cf91f59360648082019493918390030190829087803b156100005760325a03f115610000575050604051519150505b9392505050565b600454600160a060020a031681565b60006000600060006000611f9a604060405190810160405280601981526020017f636f6d2e62396c61622e64726174696e672e61756469746f72000000000000008152506121ac565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f115610000575050604051511515905061201357610000565b6000868152600260209081526040808320600160a060020a03331684526009810190925282209095509350600a85015460ff16600281116100005714156120a757428460030154108061206d575083600501548460080154145b8454909250158061208057506008840154155b80612089575081155b1561209357610000565b600a8401805460ff191660021790556120c9565b6002600a85015460ff16600281116100005714156100d5576120c9565b610000565b5b825460ff1615806120f05750600483015460026000196101006001841615020190911604155b806120ff5750600583015460ff165b1561210957610000565b60058301805460ff19166001179055600884015460048501548115610000576040519190049150600160a060020a0333169082156108fc029083906000818181858888f19350505050151561215d57610000565b604080518281529051600160a060020a0333169188917f31bfdeff7497910d6af7611e390ea041175d3897520804a90d9d3c8d8c91c5d09181900360200190a3600194505b5b50505050919050565b6000805460408051602090810184905290517fdc5acb9000000000000000000000000000000000000000000000000000000000815260048101828152855160248301528551600160a060020a039094169363dc5acb909387938392604490910191850190808383821561223a575b80518252602083111561223a57601f19909201916020918201910161221a565b505050905090810190601f1680156122665780820380516001836020036101000a031916815260200191505b5092505050602060405180830381600087803b156100005760325a03f115610000575050604051519150505b9190505600a165627a7a72305820f9a57eb35d33db35fcf54360a873840856d58e91fca104626c0d70fa849998d70029",
    "events": {
      "0xd88b47349affe2e2dca403cd1d45a5649172a5eaee469a5876eb6cef4841cbf1": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "investor",
            "type": "address"
          },
          {
            "indexed": true,
            "name": "ipfsHash",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "name",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "description",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "deadline",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "maxAuditors",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "reward",
            "type": "uint256"
          }
        ],
        "name": "LogRequestForRatingSubmitted",
        "type": "event"
      },
      "0x3c3e5cbebfd0ef81bf2f3fb207432b7c74d47759fa64a631c485184486211b0d": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "investor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "contribution",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "totalReward",
            "type": "uint256"
          }
        ],
        "name": "LogRequestForRatingContributed",
        "type": "event"
      },
      "0xc8350213f5030bd4e879cb2eeb4fa2f7f4d318e117772767d25c9c9bc4592e8e": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "auditor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "auditorCount",
            "type": "uint256"
          }
        ],
        "name": "LogAuditorJoined",
        "type": "event"
      },
      "0x561d692d608576714937a081b8dcd88b472f1781c31a856faddba126374d61a9": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "auditor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "rating",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "ipfsHash",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "submissionCount",
            "type": "uint256"
          }
        ],
        "name": "LogAuditorSubmitted",
        "type": "event"
      },
      "0x31bfdeff7497910d6af7611e390ea041175d3897520804a90d9d3c8d8c91c5d0": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "auditor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "reward",
            "type": "uint256"
          }
        ],
        "name": "LogAuditorPaid",
        "type": "event"
      },
      "0x4ae7c15cd04d8a5097b1f1fda073a122b3d11db2fa19a1d50b62e525bb165d15": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "investor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "contribution",
            "type": "uint256"
          }
        ],
        "name": "LogInvestorRefunded",
        "type": "event"
      },
      "0x89b54d16a0fd0921ec4884a402c5730b6946a12d729b59f9ebff9f8e67138f2f": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "investor",
            "type": "address"
          },
          {
            "indexed": true,
            "name": "ipfsHash",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "name",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "description",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "ric",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "deadline",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "maxAuditors",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "reward",
            "type": "uint256"
          }
        ],
        "name": "LogRequestForRatingSubmitted",
        "type": "event"
      },
      "0x7332583e40367a020551753fffdb500c9a44e697d4ad2950edf96a4b9e60216a": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "investor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "ipfsHash",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "name",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "description",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "ric",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "uri",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "deadline",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "maxAuditors",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "reward",
            "type": "uint256"
          }
        ],
        "name": "LogRequestForRatingSubmitted",
        "type": "event"
      },
      "0xe71563df7df4537ddb6eddb7a4db12751ef8eda9232c907002245ea44a38b345": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "investor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "ipfsHash",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "name",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "description",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "ric",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "permid",
            "type": "bytes32"
          },
          {
            "indexed": false,
            "name": "deadline",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "maxAuditors",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "reward",
            "type": "uint256"
          }
        ],
        "name": "LogRequestForRatingSubmitted",
        "type": "event"
      },
      "0x628bb69279bd65600574e8ddfa88d50be8bbda1cf43770a625bae887a8e23467": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": false,
            "name": "totalInteractions",
            "type": "uint256"
          }
        ],
        "name": "LogRequestForRatingInteractionsUpdated",
        "type": "event"
      },
      "0x2ceea0c5abdb44d3a9d97bbdff7b4197935427d1205e06ed0b6334a0c4aef7e4": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "requestId",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": false,
            "name": "auditorAddr",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "reason",
            "type": "uint256"
          }
        ],
        "name": "LogEntityConnect_onOracleFailure",
        "type": "event"
      },
      "0x95da4141adb67f5e6115a397ab18effd384b61e1b6439828b280c972f77f2b61": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "auditor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "permid",
            "type": "bytes32"
          },
          {
            "indexed": false,
            "name": "auditorCount",
            "type": "uint256"
          }
        ],
        "name": "LogAuditorJoined",
        "type": "event"
      },
      "0x366bf687a93739365a87108639fbb6111b51b4a5db092feef1ee0b934c23996d": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "auditor",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "totalConnections",
            "type": "uint256"
          }
        ],
        "name": "LogAuditorConnectionsUpdated",
        "type": "event"
      }
    },
    "updated_at": 1485652656335,
    "links": {},
    "address": "0x9f347f6d5391b21153d939bd56f78c1df18dad0a"
  }
};

  Contract.checkNetwork = function(callback) {
    var self = this;

    if (this.network_id != null) {
      return callback();
    }

    this.web3.version.network(function(err, result) {
      if (err) return callback(err);

      var network_id = result.toString();

      // If we have the main network,
      if (network_id == "1") {
        var possible_ids = ["1", "live", "default"];

        for (var i = 0; i < possible_ids.length; i++) {
          var id = possible_ids[i];
          if (Contract.all_networks[id] != null) {
            network_id = id;
            break;
          }
        }
      }

      if (self.all_networks[network_id] == null) {
        return callback(new Error(self.name + " error: Can't find artifacts for network id '" + network_id + "'"));
      }

      self.setNetwork(network_id);
      callback();
    })
  };

  Contract.setNetwork = function(network_id) {
    var network = this.all_networks[network_id] || {};

    this.abi             = this.prototype.abi             = network.abi;
    this.unlinked_binary = this.prototype.unlinked_binary = network.unlinked_binary;
    this.address         = this.prototype.address         = network.address;
    this.updated_at      = this.prototype.updated_at      = network.updated_at;
    this.links           = this.prototype.links           = network.links || {};
    this.events          = this.prototype.events          = network.events || {};

    this.network_id = network_id;
  };

  Contract.networks = function() {
    return Object.keys(this.all_networks);
  };

  Contract.link = function(name, address) {
    if (typeof name == "function") {
      var contract = name;

      if (contract.address == null) {
        throw new Error("Cannot link contract without an address.");
      }

      Contract.link(contract.contract_name, contract.address);

      // Merge events so this contract knows about library's events
      Object.keys(contract.events).forEach(function(topic) {
        Contract.events[topic] = contract.events[topic];
      });

      return;
    }

    if (typeof name == "object") {
      var obj = name;
      Object.keys(obj).forEach(function(name) {
        var a = obj[name];
        Contract.link(name, a);
      });
      return;
    }

    Contract.links[name] = address;
  };

  Contract.contract_name   = Contract.prototype.contract_name   = "Ratings";
  Contract.generated_with  = Contract.prototype.generated_with  = "3.2.0";

  // Allow people to opt-in to breaking changes now.
  Contract.next_gen = false;

  var properties = {
    binary: function() {
      var binary = Contract.unlinked_binary;

      Object.keys(Contract.links).forEach(function(library_name) {
        var library_address = Contract.links[library_name];
        var regex = new RegExp("__" + library_name + "_*", "g");

        binary = binary.replace(regex, library_address.replace("0x", ""));
      });

      return binary;
    }
  };

  Object.keys(properties).forEach(function(key) {
    var getter = properties[key];

    var definition = {};
    definition.enumerable = true;
    definition.configurable = false;
    definition.get = getter;

    Object.defineProperty(Contract, key, definition);
    Object.defineProperty(Contract.prototype, key, definition);
  });

  bootstrap(Contract);

  if (typeof module != "undefined" && typeof module.exports != "undefined") {
    module.exports = Contract;
  } else {
    // There will only be one version of this contract in the browser,
    // and we can use that.
    window.Ratings = Contract;
  }
})();
