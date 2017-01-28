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
            "name": "uri",
            "type": "string"
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
        "constant": false,
        "inputs": [
          {
            "name": "key",
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
      }
    ],
    "unlinked_binary": "0x606060405234610000576040516040806119a28339810160405280516020909101515b815b600160a060020a038116151561003957610000565b60008054600160a060020a031916600160a060020a0383161790555b5060028054600160a060020a031916600160a060020a0383161790555b50505b61191e806100846000396000f3006060604052361561007d5763ffffffff60e060020a600035041663105b68f1811461008257806318bf9a42146101e257806369a75e4814610236578063775274a1146102555780639771942914610279578063b3b200d6146102e4578063bfde89941461030d578063c809c3b814610331578063cbaaa3ac14610355575b610000565b6101ce600480803590602001908201803590602001908080601f0160208091040260200160405190810160405280939291908181526020018383808284375050604080516020601f89358b0180359182018390048302840183019094528083529799988101979196509182019450925082915084018382808284375050604080516020601f89358b0180359182018390048302840183019094528083529799988101979196509182019450925082915084018382808284375050604080516020601f89358b0180359182018390048302840183019094528083529799988101979196509182019450925082915084018382808284375050604080516020888301358a018035601f8101839004830284018301909452838352979989359980830135999198506060019650919450908101925081908401838280828437509496506103c495505050505050565b604080519115158252519081900360200190f35b34610000576101f2600435610d5f565b6040518087815260200186815260200185815260200184815260200183815260200182600281116100005760ff168152602001965050505050505060405180910390f35b6101ce600435610d9c565b604080519115158252519081900360200190f35b34610000576101ce600435610f21565b604080519115158252519081900360200190f35b3461000057604080516020600460443581810135601f81018490048402850184019095528484526101ce94823594602480359560649492939190920191819084018382808284375094965061112795505050505050565b604080519115158252519081900360200190f35b34610000576102f1611401565b60408051600160a060020a039092168252519081900360200190f35b34610000576101ce600435611410565b604080519115158252519081900360200190f35b34610000576101ce600435611668565b604080519115158252519081900360200190f35b34610000576102f1600480803590602001908201803590602001908080601f0160208091040260200160405190810160405280939291908181526020018383808284375094965061180795505050505050565b60408051600160a060020a039092168252519081900360200190f35b600060006000610409604060405190810160405280601a81526020017f636f6d2e62396c61622e64726174696e672e696e766573746f72000000000000815250611807565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f115610000575050604051511515905061048257610000565b34158061048d575084155b8061049757508351155b806104a25750428611155b156104ac57610000565b338a8a88348989436040518089600160a060020a0316600160a060020a03166c0100000000000000000000000002815260140188805190602001908083835b6020831061050a5780518252601f1990920191602091820191016104eb565b51815160209384036101000a60001901801990921691161790528a5191909301928a0191508083835b602083106105525780518252601f199092019160209182019101610533565b51815160209384036101000a60001901801990921691161790529201888152808301889052604081018790528551606090910192860191508083835b602083106105ad5780518252601f19909201916020918201910161058e565b51815160209384036101000a600019018019909216911617905292019384525060408051938490038201909320600081815260019092529290208054929b509950501596506106029550505050505057610000565b6005816000018181548183558181151161069a5760008381526020902061069a9181019083015b8082111561068757600081805460018160011615610100020316600290046000825580601f10610659575061068b565b601f01602090049060005260206000209081019061068b91905b808211156106875760008155600101610673565b5090565b5b5050600101610629565b5090565b5b5050505083816000016000815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061070757805160ff1916838001178555610734565b82800160010185558215610734579182015b82811115610734578251825591602001919060010190610719565b5b506107559291505b808211156106875760008155600101610673565b5090565b505089816000016001815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f106107bf57805160ff19168380011785556107ec565b828001600101855582156107ec579182015b828111156107ec5782518255916020019190600101906107d1565b5b5061080d9291505b808211156106875760008155600101610673565b5090565b505088816000016002815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061087757805160ff19168380011785556108a4565b828001600101855582156108a4579182015b828111156108a4578251825591602001919060010190610889565b5b506108c59291505b808211156106875760008155600101610673565b5090565b505087816000016003815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061092f57805160ff191683800117855561095c565b8280016001018555821561095c579182015b8281111561095c578251825591602001919060010190610941565b5b5061097d9291505b808211156106875760008155600101610673565b5090565b505086816000016004815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f106109e757805160ff1916838001178555610a14565b82800160010185558215610a14579182015b82811115610a145782518255916020019190600101906109f9565b5b50610a359291505b808211156106875760008155600101610673565b5090565b5050600180820187905534600283015560038201869055600060058301819055600683018190556008830180549192909160ff19169083021790555034600160008460001916600019168152602001908152602001600020600401600033600160a060020a0316600160a060020a031681526020019081526020016000208190555033600160a060020a031682600019167f7332583e40367a020551753fffdb500c9a44e697d4ad2950edf96a4b9e60216a868d8d8d8d8d8d3460405180806020018060200180602001806020018060200189815260200188815260200187815260200186810386528e818151815260200191508051906020019080838360008314610b5c575b805182526020831115610b5c57601f199092019160209182019101610b3c565b505050905090810190601f168015610b885780820380516001836020036101000a031916815260200191505b5086810385528d5181528d516020918201918f01908083838215610bc7575b805182526020831115610bc757601f199092019160209182019101610ba7565b505050905090810190601f168015610bf35780820380516001836020036101000a031916815260200191505b5086810384528c5181528c516020918201918e01908083838215610c32575b805182526020831115610c3257601f199092019160209182019101610c12565b505050905090810190601f168015610c5e5780820380516001836020036101000a031916815260200191505b5086810383528b5181528b516020918201918d01908083838215610c9d575b805182526020831115610c9d57601f199092019160209182019101610c7d565b505050905090810190601f168015610cc95780820380516001836020036101000a031916815260200191505b5086810382528a5181528a516020918201918c01908083838215610d08575b805182526020831115610d0857601f199092019160209182019101610ce8565b505050905090810190601f168015610d345780820380516001836020036101000a031916815260200191505b509d505050505050505050505050505060405180910390a3600192505b5b5050979650505050505050565b6001602081905260009182526040909120908101546002820154600383015460058401546006850154600890950154939492939192909160ff1686565b60006000610ddf604060405190810160405280601a81526020017f636f6d2e62396c61622e64726174696e672e696e766573746f72000000000000815250611807565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f1156100005750506040515115159050610e5857610000565b506000828152600160205260409020341580610e7357508054155b80610e815750428160010154105b80610e9c57506000600882015460ff16600281116100005714155b15610ea657610000565b600281018054349081018255600160a060020a033316600081815260048501602090815260409182902080548501905593548151938452938301939093528251909286927f3c3e5cbebfd0ef81bf2f3fb207432b7c74d47759fa64a631c485184486211b0d929081900390910190a3600191505b5b50919050565b6000600060006000610f68604060405190810160405280601a81526020017f636f6d2e62396c61622e64726174696e672e696e766573746f72000000000000815250611807565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f1156100005750506040515115159050610fe157610000565b60008581526001602052604081209350600884015460ff16600281116100005714156110495742836001015410801561101c57506006830154155b8354909250158061102b575081155b1561103557610000565b60088301805460ff1916600117905561106b565b6001600884015460ff166002811161000057141561007d5761106b565b610000565b5b600160a060020a0333166000908152600484016020526040902054151561109257610000565b50600160a060020a0333166000818152600484016020526040808220805490839055905190929183156108fc02918491818181858888f1935050505015156110d957610000565b604080518281529051600160a060020a0333169187917f4ae7c15cd04d8a5097b1f1fda073a122b3d11db2fa19a1d50b62e525bb165d159181900360200190a3600193505b5b505050919050565b60006000600061116c604060405190810160405280601981526020017f636f6d2e62396c61622e64726174696e672e61756469746f7200000000000000815250611807565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f11561000057505060405151151590506111e557610000565b50506000848152600160209081526040808320600160a060020a0333168452600781019092529091208154158061121e5750805460ff16155b8061122c5750428260010154105b8061123657508351155b8061125157506000600883015460ff16600281116100005714155b1561125b57610000565b60028082015460001961010060018316150201160415156112825760068201805460010190555b84816001018190555083816002019080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f106112d957805160ff1916838001178555611306565b82800160010185558215611306579182015b828111156113065782518255916020019190600101906112eb565b5b506113279291505b808211156106875760008155600101610673565b5090565b505033600160a060020a031686600019167f561d692d608576714937a081b8dcd88b472f1781c31a856faddba126374d61a98787866006015460405180848152602001806020018381526020018281038252848181518152602001915080519060200190808383600083146113b7575b8051825260208311156113b757601f199092019160209182019101611397565b505050905090810190601f1680156113e35780820380516001836020036101000a031916815260200191505b5094505050505060405180910390a3600192505b5b50509392505050565b600254600160a060020a031681565b60006000600060006000611459604060405190810160405280601981526020017f636f6d2e62396c61622e64726174696e672e61756469746f7200000000000000815250611807565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f11561000057505060405151151590506114d257610000565b6000868152600160209081526040808320600160a060020a03331684526007810190925282209095509350600885015460ff166002811161000057141561156657428460010154108061152c575083600301548460060154145b8454909250158061153f57506006840154155b80611548575081155b1561155257610000565b60088401805460ff19166002179055611588565b6002600885015460ff166002811161000057141561007d57611588565b610000565b5b825460ff1615806115ac5750600280840154600019610100600183161502011604155b806115bb5750600383015460ff165b156115c557610000565b60038301805460ff19166001179055600684015460028501548115610000576040519190049150600160a060020a0333169082156108fc029083906000818181858888f19350505050151561161957610000565b604080518281529051600160a060020a0333169188917f31bfdeff7497910d6af7611e390ea041175d3897520804a90d9d3c8d8c91c5d09181900360200190a3600194505b5b50505050919050565b6000600060006116ad604060405190810160405280601981526020017f636f6d2e62396c61622e64726174696e672e61756469746f7200000000000000815250611807565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f115610000575050604051511515905061172657610000565b50506000828152600160209081526040808320600160a060020a03331684526007810190925290912081541580611764575081600301548260050154145b806117705750805460ff165b8061177e5750428260010154105b8061179957506000600883015460ff16600281116100005714155b156117a357610000565b600160a060020a033316600081905260078301602090815260058401805460010190819055604080519182525187927fc8350213f5030bd4e879cb2eeb4fa2f7f4d318e117772767d25c9c9bc4592e8e928290030190a3600192505b5b5050919050565b6000805460408051602090810184905290517fdc5acb9000000000000000000000000000000000000000000000000000000000815260048101828152855160248301528551600160a060020a039094169363dc5acb9093879383926044909101918501908083838215611895575b80518252602083111561189557601f199092019160209182019101611875565b505050905090810190601f1680156118c15780820380516001836020036101000a031916815260200191505b5092505050602060405180830381600087803b156100005760325a03f115610000575050604051519150505b9190505600a165627a7a723058203509fdb0fd6ff74f2946ce249a6a6ac65d49b70ee69cc51a8908fcae9795c1770029",
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
      }
    },
    "updated_at": 1485628339714,
    "links": {},
    "address": "0x6fcb71a7f1deabc00631da6aee17e3340acd5768"
  },
  "default": {
    "abi": [
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
            "name": "uri",
            "type": "string"
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
        "constant": false,
        "inputs": [
          {
            "name": "key",
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
        "constant": true,
        "inputs": [],
        "name": "getAppName",
        "outputs": [
          {
            "name": "",
            "type": "string"
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
      }
    ],
<<<<<<< Updated upstream
    "unlinked_binary": "0x606060405234610000576040516040806119a28339810160405280516020909101515b815b600160a060020a038116151561003957610000565b60008054600160a060020a031916600160a060020a0383161790555b5060028054600160a060020a031916600160a060020a0383161790555b50505b61191e806100846000396000f3006060604052361561007d5763ffffffff60e060020a600035041663105b68f1811461008257806318bf9a42146101e257806369a75e4814610236578063775274a1146102555780639771942914610279578063b3b200d6146102e4578063bfde89941461030d578063c809c3b814610331578063cbaaa3ac14610355575b610000565b6101ce600480803590602001908201803590602001908080601f0160208091040260200160405190810160405280939291908181526020018383808284375050604080516020601f89358b0180359182018390048302840183019094528083529799988101979196509182019450925082915084018382808284375050604080516020601f89358b0180359182018390048302840183019094528083529799988101979196509182019450925082915084018382808284375050604080516020601f89358b0180359182018390048302840183019094528083529799988101979196509182019450925082915084018382808284375050604080516020888301358a018035601f8101839004830284018301909452838352979989359980830135999198506060019650919450908101925081908401838280828437509496506103c495505050505050565b604080519115158252519081900360200190f35b34610000576101f2600435610d5f565b6040518087815260200186815260200185815260200184815260200183815260200182600281116100005760ff168152602001965050505050505060405180910390f35b6101ce600435610d9c565b604080519115158252519081900360200190f35b34610000576101ce600435610f21565b604080519115158252519081900360200190f35b3461000057604080516020600460443581810135601f81018490048402850184019095528484526101ce94823594602480359560649492939190920191819084018382808284375094965061112795505050505050565b604080519115158252519081900360200190f35b34610000576102f1611401565b60408051600160a060020a039092168252519081900360200190f35b34610000576101ce600435611410565b604080519115158252519081900360200190f35b34610000576101ce600435611668565b604080519115158252519081900360200190f35b34610000576102f1600480803590602001908201803590602001908080601f0160208091040260200160405190810160405280939291908181526020018383808284375094965061180795505050505050565b60408051600160a060020a039092168252519081900360200190f35b600060006000610409604060405190810160405280601a81526020017f636f6d2e62396c61622e64726174696e672e696e766573746f72000000000000815250611807565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f115610000575050604051511515905061048257610000565b34158061048d575084155b8061049757508351155b806104a25750428611155b156104ac57610000565b338a8a88348989436040518089600160a060020a0316600160a060020a03166c0100000000000000000000000002815260140188805190602001908083835b6020831061050a5780518252601f1990920191602091820191016104eb565b51815160209384036101000a60001901801990921691161790528a5191909301928a0191508083835b602083106105525780518252601f199092019160209182019101610533565b51815160209384036101000a60001901801990921691161790529201888152808301889052604081018790528551606090910192860191508083835b602083106105ad5780518252601f19909201916020918201910161058e565b51815160209384036101000a600019018019909216911617905292019384525060408051938490038201909320600081815260019092529290208054929b509950501596506106029550505050505057610000565b6005816000018181548183558181151161069a5760008381526020902061069a9181019083015b8082111561068757600081805460018160011615610100020316600290046000825580601f10610659575061068b565b601f01602090049060005260206000209081019061068b91905b808211156106875760008155600101610673565b5090565b5b5050600101610629565b5090565b5b5050505083816000016000815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061070757805160ff1916838001178555610734565b82800160010185558215610734579182015b82811115610734578251825591602001919060010190610719565b5b506107559291505b808211156106875760008155600101610673565b5090565b505089816000016001815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f106107bf57805160ff19168380011785556107ec565b828001600101855582156107ec579182015b828111156107ec5782518255916020019190600101906107d1565b5b5061080d9291505b808211156106875760008155600101610673565b5090565b505088816000016002815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061087757805160ff19168380011785556108a4565b828001600101855582156108a4579182015b828111156108a4578251825591602001919060010190610889565b5b506108c59291505b808211156106875760008155600101610673565b5090565b505087816000016003815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061092f57805160ff191683800117855561095c565b8280016001018555821561095c579182015b8281111561095c578251825591602001919060010190610941565b5b5061097d9291505b808211156106875760008155600101610673565b5090565b505086816000016004815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f106109e757805160ff1916838001178555610a14565b82800160010185558215610a14579182015b82811115610a145782518255916020019190600101906109f9565b5b50610a359291505b808211156106875760008155600101610673565b5090565b5050600180820187905534600283015560038201869055600060058301819055600683018190556008830180549192909160ff19169083021790555034600160008460001916600019168152602001908152602001600020600401600033600160a060020a0316600160a060020a031681526020019081526020016000208190555033600160a060020a031682600019167f7332583e40367a020551753fffdb500c9a44e697d4ad2950edf96a4b9e60216a868d8d8d8d8d8d3460405180806020018060200180602001806020018060200189815260200188815260200187815260200186810386528e818151815260200191508051906020019080838360008314610b5c575b805182526020831115610b5c57601f199092019160209182019101610b3c565b505050905090810190601f168015610b885780820380516001836020036101000a031916815260200191505b5086810385528d5181528d516020918201918f01908083838215610bc7575b805182526020831115610bc757601f199092019160209182019101610ba7565b505050905090810190601f168015610bf35780820380516001836020036101000a031916815260200191505b5086810384528c5181528c516020918201918e01908083838215610c32575b805182526020831115610c3257601f199092019160209182019101610c12565b505050905090810190601f168015610c5e5780820380516001836020036101000a031916815260200191505b5086810383528b5181528b516020918201918d01908083838215610c9d575b805182526020831115610c9d57601f199092019160209182019101610c7d565b505050905090810190601f168015610cc95780820380516001836020036101000a031916815260200191505b5086810382528a5181528a516020918201918c01908083838215610d08575b805182526020831115610d0857601f199092019160209182019101610ce8565b505050905090810190601f168015610d345780820380516001836020036101000a031916815260200191505b509d505050505050505050505050505060405180910390a3600192505b5b5050979650505050505050565b6001602081905260009182526040909120908101546002820154600383015460058401546006850154600890950154939492939192909160ff1686565b60006000610ddf604060405190810160405280601a81526020017f636f6d2e62396c61622e64726174696e672e696e766573746f72000000000000815250611807565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f1156100005750506040515115159050610e5857610000565b506000828152600160205260409020341580610e7357508054155b80610e815750428160010154105b80610e9c57506000600882015460ff16600281116100005714155b15610ea657610000565b600281018054349081018255600160a060020a033316600081815260048501602090815260409182902080548501905593548151938452938301939093528251909286927f3c3e5cbebfd0ef81bf2f3fb207432b7c74d47759fa64a631c485184486211b0d929081900390910190a3600191505b5b50919050565b6000600060006000610f68604060405190810160405280601a81526020017f636f6d2e62396c61622e64726174696e672e696e766573746f72000000000000815250611807565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f1156100005750506040515115159050610fe157610000565b60008581526001602052604081209350600884015460ff16600281116100005714156110495742836001015410801561101c57506006830154155b8354909250158061102b575081155b1561103557610000565b60088301805460ff1916600117905561106b565b6001600884015460ff166002811161000057141561007d5761106b565b610000565b5b600160a060020a0333166000908152600484016020526040902054151561109257610000565b50600160a060020a0333166000818152600484016020526040808220805490839055905190929183156108fc02918491818181858888f1935050505015156110d957610000565b604080518281529051600160a060020a0333169187917f4ae7c15cd04d8a5097b1f1fda073a122b3d11db2fa19a1d50b62e525bb165d159181900360200190a3600193505b5b505050919050565b60006000600061116c604060405190810160405280601981526020017f636f6d2e62396c61622e64726174696e672e61756469746f7200000000000000815250611807565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f11561000057505060405151151590506111e557610000565b50506000848152600160209081526040808320600160a060020a0333168452600781019092529091208154158061121e5750805460ff16155b8061122c5750428260010154105b8061123657508351155b8061125157506000600883015460ff16600281116100005714155b1561125b57610000565b60028082015460001961010060018316150201160415156112825760068201805460010190555b84816001018190555083816002019080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f106112d957805160ff1916838001178555611306565b82800160010185558215611306579182015b828111156113065782518255916020019190600101906112eb565b5b506113279291505b808211156106875760008155600101610673565b5090565b505033600160a060020a031686600019167f561d692d608576714937a081b8dcd88b472f1781c31a856faddba126374d61a98787866006015460405180848152602001806020018381526020018281038252848181518152602001915080519060200190808383600083146113b7575b8051825260208311156113b757601f199092019160209182019101611397565b505050905090810190601f1680156113e35780820380516001836020036101000a031916815260200191505b5094505050505060405180910390a3600192505b5b50509392505050565b600254600160a060020a031681565b60006000600060006000611459604060405190810160405280601981526020017f636f6d2e62396c61622e64726174696e672e61756469746f7200000000000000815250611807565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f11561000057505060405151151590506114d257610000565b6000868152600160209081526040808320600160a060020a03331684526007810190925282209095509350600885015460ff166002811161000057141561156657428460010154108061152c575083600301548460060154145b8454909250158061153f57506006840154155b80611548575081155b1561155257610000565b60088401805460ff19166002179055611588565b6002600885015460ff166002811161000057141561007d57611588565b610000565b5b825460ff1615806115ac5750600280840154600019610100600183161502011604155b806115bb5750600383015460ff165b156115c557610000565b60038301805460ff19166001179055600684015460028501548115610000576040519190049150600160a060020a0333169082156108fc029083906000818181858888f19350505050151561161957610000565b604080518281529051600160a060020a0333169188917f31bfdeff7497910d6af7611e390ea041175d3897520804a90d9d3c8d8c91c5d09181900360200190a3600194505b5b50505050919050565b6000600060006116ad604060405190810160405280601981526020017f636f6d2e62396c61622e64726174696e672e61756469746f7200000000000000815250611807565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f115610000575050604051511515905061172657610000565b50506000828152600160209081526040808320600160a060020a03331684526007810190925290912081541580611764575081600301548260050154145b806117705750805460ff165b8061177e5750428260010154105b8061179957506000600883015460ff16600281116100005714155b156117a357610000565b600160a060020a033316600081905260078301602090815260058401805460010190819055604080519182525187927fc8350213f5030bd4e879cb2eeb4fa2f7f4d318e117772767d25c9c9bc4592e8e928290030190a3600192505b5b5050919050565b6000805460408051602090810184905290517fdc5acb9000000000000000000000000000000000000000000000000000000000815260048101828152855160248301528551600160a060020a039094169363dc5acb9093879383926044909101918501908083838215611895575b80518252602083111561189557601f199092019160209182019101611875565b505050905090810190601f1680156118c15780820380516001836020036101000a031916815260200191505b5092505050602060405180830381600087803b156100005760325a03f115610000575050604051519150505b9190505600a165627a7a72305820b3c88e6dba690c4a9aed960c76cab676fc1dc629dfb32ef347502287ab0773a00029",
=======
    "unlinked_binary": "0x606060405234610000576040516040806119a28339810160405280516020909101515b815b600160a060020a038116151561003957610000565b60008054600160a060020a031916600160a060020a0383161790555b5060028054600160a060020a031916600160a060020a0383161790555b50505b61191e806100846000396000f3006060604052361561007d5763ffffffff60e060020a600035041663105b68f1811461008257806318bf9a42146101e257806369a75e4814610236578063775274a1146102555780639771942914610279578063b3b200d6146102e4578063bfde89941461030d578063c809c3b814610331578063cbaaa3ac14610355575b610000565b6101ce600480803590602001908201803590602001908080601f0160208091040260200160405190810160405280939291908181526020018383808284375050604080516020601f89358b0180359182018390048302840183019094528083529799988101979196509182019450925082915084018382808284375050604080516020601f89358b0180359182018390048302840183019094528083529799988101979196509182019450925082915084018382808284375050604080516020601f89358b0180359182018390048302840183019094528083529799988101979196509182019450925082915084018382808284375050604080516020888301358a018035601f8101839004830284018301909452838352979989359980830135999198506060019650919450908101925081908401838280828437509496506103c495505050505050565b604080519115158252519081900360200190f35b34610000576101f2600435610d5f565b6040518087815260200186815260200185815260200184815260200183815260200182600281116100005760ff168152602001965050505050505060405180910390f35b6101ce600435610d9c565b604080519115158252519081900360200190f35b34610000576101ce600435610f21565b604080519115158252519081900360200190f35b3461000057604080516020600460443581810135601f81018490048402850184019095528484526101ce94823594602480359560649492939190920191819084018382808284375094965061112795505050505050565b604080519115158252519081900360200190f35b34610000576102f1611401565b60408051600160a060020a039092168252519081900360200190f35b34610000576101ce600435611410565b604080519115158252519081900360200190f35b34610000576101ce600435611668565b604080519115158252519081900360200190f35b34610000576102f1600480803590602001908201803590602001908080601f0160208091040260200160405190810160405280939291908181526020018383808284375094965061180795505050505050565b60408051600160a060020a039092168252519081900360200190f35b600060006000610409604060405190810160405280601a81526020017f636f6d2e62396c61622e64726174696e672e696e766573746f72000000000000815250611807565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f115610000575050604051511515905061048257610000565b34158061048d575084155b8061049757508351155b806104a25750428611155b156104ac57610000565b338a8a88348989436040518089600160a060020a0316600160a060020a03166c0100000000000000000000000002815260140188805190602001908083835b6020831061050a5780518252601f1990920191602091820191016104eb565b51815160209384036101000a60001901801990921691161790528a5191909301928a0191508083835b602083106105525780518252601f199092019160209182019101610533565b51815160209384036101000a60001901801990921691161790529201888152808301889052604081018790528551606090910192860191508083835b602083106105ad5780518252601f19909201916020918201910161058e565b51815160209384036101000a600019018019909216911617905292019384525060408051938490038201909320600081815260019092529290208054929b509950501596506106029550505050505057610000565b6005816000018181548183558181151161069a5760008381526020902061069a9181019083015b8082111561068757600081805460018160011615610100020316600290046000825580601f10610659575061068b565b601f01602090049060005260206000209081019061068b91905b808211156106875760008155600101610673565b5090565b5b5050600101610629565b5090565b5b5050505083816000016000815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061070757805160ff1916838001178555610734565b82800160010185558215610734579182015b82811115610734578251825591602001919060010190610719565b5b506107559291505b808211156106875760008155600101610673565b5090565b505089816000016001815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f106107bf57805160ff19168380011785556107ec565b828001600101855582156107ec579182015b828111156107ec5782518255916020019190600101906107d1565b5b5061080d9291505b808211156106875760008155600101610673565b5090565b505088816000016002815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061087757805160ff19168380011785556108a4565b828001600101855582156108a4579182015b828111156108a4578251825591602001919060010190610889565b5b506108c59291505b808211156106875760008155600101610673565b5090565b505087816000016003815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061092f57805160ff191683800117855561095c565b8280016001018555821561095c579182015b8281111561095c578251825591602001919060010190610941565b5b5061097d9291505b808211156106875760008155600101610673565b5090565b505086816000016004815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f106109e757805160ff1916838001178555610a14565b82800160010185558215610a14579182015b82811115610a145782518255916020019190600101906109f9565b5b50610a359291505b808211156106875760008155600101610673565b5090565b5050600180820187905534600283015560038201869055600060058301819055600683018190556008830180549192909160ff19169083021790555034600160008460001916600019168152602001908152602001600020600401600033600160a060020a0316600160a060020a031681526020019081526020016000208190555033600160a060020a031682600019167f7332583e40367a020551753fffdb500c9a44e697d4ad2950edf96a4b9e60216a868d8d8d8d8d8d3460405180806020018060200180602001806020018060200189815260200188815260200187815260200186810386528e818151815260200191508051906020019080838360008314610b5c575b805182526020831115610b5c57601f199092019160209182019101610b3c565b505050905090810190601f168015610b885780820380516001836020036101000a031916815260200191505b5086810385528d5181528d516020918201918f01908083838215610bc7575b805182526020831115610bc757601f199092019160209182019101610ba7565b505050905090810190601f168015610bf35780820380516001836020036101000a031916815260200191505b5086810384528c5181528c516020918201918e01908083838215610c32575b805182526020831115610c3257601f199092019160209182019101610c12565b505050905090810190601f168015610c5e5780820380516001836020036101000a031916815260200191505b5086810383528b5181528b516020918201918d01908083838215610c9d575b805182526020831115610c9d57601f199092019160209182019101610c7d565b505050905090810190601f168015610cc95780820380516001836020036101000a031916815260200191505b5086810382528a5181528a516020918201918c01908083838215610d08575b805182526020831115610d0857601f199092019160209182019101610ce8565b505050905090810190601f168015610d345780820380516001836020036101000a031916815260200191505b509d505050505050505050505050505060405180910390a3600192505b5b5050979650505050505050565b6001602081905260009182526040909120908101546002820154600383015460058401546006850154600890950154939492939192909160ff1686565b60006000610ddf604060405190810160405280601a81526020017f636f6d2e62396c61622e64726174696e672e696e766573746f72000000000000815250611807565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f1156100005750506040515115159050610e5857610000565b506000828152600160205260409020341580610e7357508054155b80610e815750428160010154105b80610e9c57506000600882015460ff16600281116100005714155b15610ea657610000565b600281018054349081018255600160a060020a033316600081815260048501602090815260409182902080548501905593548151938452938301939093528251909286927f3c3e5cbebfd0ef81bf2f3fb207432b7c74d47759fa64a631c485184486211b0d929081900390910190a3600191505b5b50919050565b6000600060006000610f68604060405190810160405280601a81526020017f636f6d2e62396c61622e64726174696e672e696e766573746f72000000000000815250611807565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f1156100005750506040515115159050610fe157610000565b60008581526001602052604081209350600884015460ff16600281116100005714156110495742836001015410801561101c57506006830154155b8354909250158061102b575081155b1561103557610000565b60088301805460ff1916600117905561106b565b6001600884015460ff166002811161000057141561007d5761106b565b610000565b5b600160a060020a0333166000908152600484016020526040902054151561109257610000565b50600160a060020a0333166000818152600484016020526040808220805490839055905190929183156108fc02918491818181858888f1935050505015156110d957610000565b604080518281529051600160a060020a0333169187917f4ae7c15cd04d8a5097b1f1fda073a122b3d11db2fa19a1d50b62e525bb165d159181900360200190a3600193505b5b505050919050565b60006000600061116c604060405190810160405280601981526020017f636f6d2e62396c61622e64726174696e672e61756469746f7200000000000000815250611807565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f11561000057505060405151151590506111e557610000565b50506000848152600160209081526040808320600160a060020a0333168452600781019092529091208154158061121e5750805460ff16155b8061122c5750428260010154105b8061123657508351155b8061125157506000600883015460ff16600281116100005714155b1561125b57610000565b60028082015460001961010060018316150201160415156112825760068201805460010190555b84816001018190555083816002019080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f106112d957805160ff1916838001178555611306565b82800160010185558215611306579182015b828111156113065782518255916020019190600101906112eb565b5b506113279291505b808211156106875760008155600101610673565b5090565b505033600160a060020a031686600019167f561d692d608576714937a081b8dcd88b472f1781c31a856faddba126374d61a98787866006015460405180848152602001806020018381526020018281038252848181518152602001915080519060200190808383600083146113b7575b8051825260208311156113b757601f199092019160209182019101611397565b505050905090810190601f1680156113e35780820380516001836020036101000a031916815260200191505b5094505050505060405180910390a3600192505b5b50509392505050565b600254600160a060020a031681565b60006000600060006000611459604060405190810160405280601981526020017f636f6d2e62396c61622e64726174696e672e61756469746f7200000000000000815250611807565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f11561000057505060405151151590506114d257610000565b6000868152600160209081526040808320600160a060020a03331684526007810190925282209095509350600885015460ff166002811161000057141561156657428460010154108061152c575083600301548460060154145b8454909250158061153f57506006840154155b80611548575081155b1561155257610000565b60088401805460ff19166002179055611588565b6002600885015460ff166002811161000057141561007d57611588565b610000565b5b825460ff1615806115ac5750600280840154600019610100600183161502011604155b806115bb5750600383015460ff165b156115c557610000565b60038301805460ff19166001179055600684015460028501548115610000576040519190049150600160a060020a0333169082156108fc029083906000818181858888f19350505050151561161957610000565b604080518281529051600160a060020a0333169188917f31bfdeff7497910d6af7611e390ea041175d3897520804a90d9d3c8d8c91c5d09181900360200190a3600194505b5b50505050919050565b6000600060006116ad604060405190810160405280601981526020017f636f6d2e62396c61622e64726174696e672e61756469746f7200000000000000815250611807565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f115610000575050604051511515905061172657610000565b50506000828152600160209081526040808320600160a060020a03331684526007810190925290912081541580611764575081600301548260050154145b806117705750805460ff165b8061177e5750428260010154105b8061179957506000600883015460ff16600281116100005714155b156117a357610000565b600160a060020a033316600081905260078301602090815260058401805460010190819055604080519182525187927fc8350213f5030bd4e879cb2eeb4fa2f7f4d318e117772767d25c9c9bc4592e8e928290030190a3600192505b5b5050919050565b6000805460408051602090810184905290517fdc5acb9000000000000000000000000000000000000000000000000000000000815260048101828152855160248301528551600160a060020a039094169363dc5acb9093879383926044909101918501908083838215611895575b80518252602083111561189557601f199092019160209182019101611875565b505050905090810190601f1680156118c15780820380516001836020036101000a031916815260200191505b5092505050602060405180830381600087803b156100005760325a03f115610000575050604051519150505b9190505600a165627a7a72305820c18fa08587c367f6eab16c2cf74075154f57cc6bf2ab843b021a6c0627cf07b60029",
>>>>>>> Stashed changes
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
      }
    },
<<<<<<< Updated upstream
<<<<<<< Updated upstream
    "updated_at": 1485636215791,
=======
    "updated_at": 1485628537333,
>>>>>>> Stashed changes
    "links": {},
    "address": "0x9f347f6d5391b21153d939bd56f78c1df18dad0a"
=======
    "updated_at": 1485621487855
>>>>>>> Stashed changes
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
