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
    "unlinked_binary": "0x6060604052346100005760405160208061198883398101604052515b805b600160a060020a038116151561003257610000565b60008054600160a060020a031916600160a060020a0383161790555b505b505b611927806100616000396000f300606060405236156100725763ffffffff60e060020a600035041663105b68f1811461007757806318bf9a42146101d757806369a75e481461022b578063775274a11461024a578063977194291461026e578063bfde8994146102d9578063c809c3b8146102fd578063cbaaa3ac14610321575b610000565b6101c3600480803590602001908201803590602001908080601f0160208091040260200160405190810160405280939291908181526020018383808284375050604080516020601f89358b0180359182018390048302840183019094528083529799988101979196509182019450925082915084018382808284375050604080516020601f89358b0180359182018390048302840183019094528083529799988101979196509182019450925082915084018382808284375050604080516020601f89358b0180359182018390048302840183019094528083529799988101979196509182019450925082915084018382808284375050604080516020888301358a018035601f81018390048302840183019094528383529799893599808301359991985060600196509194509081019250819084018382808284375094965061039095505050505050565b604080519115158252519081900360200190f35b34610000576101e7600435610c89565b6040518087815260200186815260200185815260200184815260200183815260200182600281116100005760ff168152602001965050505050505060405180910390f35b6101c3600435610cc6565b604080519115158252519081900360200190f35b34610000576101c3600435610e7b565b604080519115158252519081900360200190f35b3461000057604080516020600460443581810135601f81018490048402850184019095528484526101c39482359460248035956064949293919092019181908401838280828437509496506110b095505050505050565b604080519115158252519081900360200190f35b34610000576101c36004356113ba565b604080519115158252519081900360200190f35b34610000576101c3600435611641565b604080519115158252519081900360200190f35b3461000057610374600480803590602001908201803590602001908080601f0160208091040260200160405190810160405280939291908181526020018383808284375094965061181095505050505050565b60408051600160a060020a039092168252519081900360200190f35b6000600060006103d5604060405190810160405280601a81526020017f636f6d2e62396c61622e64726174696e672e696e766573746f72000000000000815250611810565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f115610000575050604051511515905061044e57610000565b341580610459575084155b8061046357508351155b8061046e5750428611155b1561047857610000565b338a8a88348989436040518089600160a060020a0316600160a060020a03166c0100000000000000000000000002815260140188805190602001908083835b602083106104d65780518252601f1990920191602091820191016104b7565b51815160209384036101000a60001901801990921691161790528a5191909301928a0191508083835b6020831061051e5780518252601f1990920191602091820191016104ff565b51815160209384036101000a60001901801990921691161790529201888152808301889052604081018790528551606090910192860191508083835b602083106105795780518252601f19909201916020918201910161055a565b51815160209384036101000a600019018019909216911617905292019384525060408051938490038201909320600081815260019092529281208054939c5099509750508610159450610000935050505057906000526020600020900160005b505460026000196101006001841615020190911604156105f857610000565b50600081815260016020526040812080549091859183919081101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061066f57805160ff191683800117855561069c565b8280016001018555821561069c579182015b8281111561069c578251825591602001919060010190610681565b5b506106bd9291505b808211156106b957600081556001016106a5565b5090565b505089816000016001815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061072757805160ff1916838001178555610754565b82800160010185558215610754579182015b82811115610754578251825591602001919060010190610739565b5b506107759291505b808211156106b957600081556001016106a5565b5090565b505088816000016002815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f106107df57805160ff191683800117855561080c565b8280016001018555821561080c579182015b8281111561080c5782518255916020019190600101906107f1565b5b5061082d9291505b808211156106b957600081556001016106a5565b5090565b505087816000016003815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061089757805160ff19168380011785556108c4565b828001600101855582156108c4579182015b828111156108c45782518255916020019190600101906108a9565b5b506108e59291505b808211156106b957600081556001016106a5565b5090565b505086816000016004815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061094f57805160ff191683800117855561097c565b8280016001018555821561097c579182015b8281111561097c578251825591602001919060010190610961565b5b5061099d9291505b808211156106b957600081556001016106a5565b5090565b505060018181018790553460028301819055600383018790556000600584018190556006840181905560088401805460ff191690558481526020928352604080822033600160a060020a031683526004018452908190209190915551855186928291908401908083835b60208310610a265780518252601f199092019160209182019101610a07565b6001836020036101000a038019825116818451168082178552505050505050905001915050604051809103902033600160a060020a031683600019167f7332583e40367a020551753fffdb500c9a44e697d4ad2950edf96a4b9e60216a8d8d8d8d8d8d34604051808060200180602001806020018060200188815260200187815260200186815260200185810385528c818151815260200191508051906020019080838360008314610af3575b805182526020831115610af357601f199092019160209182019101610ad3565b505050905090810190601f168015610b1f5780820380516001836020036101000a031916815260200191505b5085810384528b5181528b516020918201918d01908083838215610b5e575b805182526020831115610b5e57601f199092019160209182019101610b3e565b505050905090810190601f168015610b8a5780820380516001836020036101000a031916815260200191505b5085810383528a5181528a516020918201918c01908083838215610bc9575b805182526020831115610bc957601f199092019160209182019101610ba9565b505050905090810190601f168015610bf55780820380516001836020036101000a031916815260200191505b5085810382528951815289516020918201918b01908083838215610c34575b805182526020831115610c3457601f199092019160209182019101610c14565b505050905090810190601f168015610c605780820380516001836020036101000a031916815260200191505b509b50505050505050505050505060405180910390a4600192505b5b5050979650505050505050565b6001602081905260009182526040909120908101546002820154600383015460058401546006850154600890950154939492939192909160ff1686565b60006000610d09604060405190810160405280601a81526020017f636f6d2e62396c61622e64726174696e672e696e766573746f72000000000000815250611810565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f1156100005750506040515115159050610d8257610000565b506000828152600160205260409020341580610dcd5750806000016000815481101561000057906000526020600020900160005b505460026000196101006001841615020190911604155b80610ddb5750428160010154105b80610df657506000600882015460ff16600281116100005714155b15610e0057610000565b600281018054349081018255600160a060020a033316600081815260048501602090815260409182902080548501905593548151938452938301939093528251909286927f3c3e5cbebfd0ef81bf2f3fb207432b7c74d47759fa64a631c485184486211b0d929081900390910190a3600191505b5b50919050565b6000600060006000610ec2604060405190810160405280601a81526020017f636f6d2e62396c61622e64726174696e672e696e766573746f72000000000000815250611810565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f1156100005750506040515115159050610f3b57610000565b60008581526001602052604081209350600884015460ff1660028111610000571415610fd257428360010154108015610f7657506006830154155b9150826000016000815481101561000057906000526020600020900160005b5054600260001961010060018416150201909116041580610fb4575081155b15610fbe57610000565b60088301805460ff19166001179055610ff4565b6001600884015460ff166002811161000057141561007257610ff4565b610000565b5b600160a060020a0333166000908152600484016020526040902054151561101b57610000565b50600160a060020a0333166000818152600484016020526040808220805490839055905190929183156108fc02918491818181858888f19350505050151561106257610000565b604080518281529051600160a060020a0333169187917f4ae7c15cd04d8a5097b1f1fda073a122b3d11db2fa19a1d50b62e525bb165d159181900360200190a3600193505b5b505050919050565b6000600060006110f5604060405190810160405280601981526020017f636f6d2e62396c61622e64726174696e672e61756469746f7200000000000000815250611810565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f115610000575050604051511515905061116e57610000565b50506000848152600160209081526040808320600160a060020a033316845260078101909252822081549192909183919081101561000057906000526020600020900160005b50546002600019610100600184161502019091160415806111d75750805460ff16155b806111e55750428260010154105b806111ef57508351155b8061120a57506000600883015460ff16600281116100005714155b1561121457610000565b600280820154600019610100600183161502011604151561123b5760068201805460010190555b84816001018190555083816002019080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061129257805160ff19168380011785556112bf565b828001600101855582156112bf579182015b828111156112bf5782518255916020019190600101906112a4565b5b506112e09291505b808211156106b957600081556001016106a5565b5090565b505033600160a060020a031686600019167f561d692d608576714937a081b8dcd88b472f1781c31a856faddba126374d61a9878786600601546040518084815260200180602001838152602001828103825284818151815260200191508051906020019080838360008314611370575b80518252602083111561137057601f199092019160209182019101611350565b505050905090810190601f16801561139c5780820380516001836020036101000a031916815260200191505b5094505050505060405180910390a3600192505b5b50509392505050565b60006000600060006000611403604060405190810160405280601981526020017f636f6d2e62396c61622e64726174696e672e61756469746f7200000000000000815250611810565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f115610000575050604051511515905061147c57610000565b6000868152600160209081526040808320600160a060020a03331684526007810190925282209095509350600885015460ff166002811161000057141561153f5742846001015410806114d6575083600301548460060154145b9150836000016000815481101561000057906000526020600020900160005b505460026000196101006001841615020190911604158061151857506006840154155b80611521575081155b1561152b57610000565b60088401805460ff19166002179055611561565b6002600885015460ff166002811161000057141561007257611561565b610000565b5b825460ff1615806115855750600280840154600019610100600183161502011604155b806115945750600383015460ff165b1561159e57610000565b60038301805460ff19166001179055600684015460028501548115610000576040519190049150600160a060020a0333169082156108fc029083906000818181858888f1935050505015156115f257610000565b604080518281529051600160a060020a0333169188917f31bfdeff7497910d6af7611e390ea041175d3897520804a90d9d3c8d8c91c5d09181900360200190a3600194505b5b50505050919050565b600060006000611686604060405190810160405280601981526020017f636f6d2e62396c61622e64726174696e672e61756469746f7200000000000000815250611810565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f11561000057505060405151151590506116ff57610000565b50506000828152600160209081526040808320600160a060020a033316845260078101909252822081549192909183919081101561000057906000526020600020900160005b505460026000196101006001841615020190911604158061176d575081600301548260050154145b806117795750805460ff165b806117875750428260010154105b806117a257506000600883015460ff16600281116100005714155b156117ac57610000565b600160a060020a033316600081905260078301602090815260058401805460010190819055604080519182525187927fc8350213f5030bd4e879cb2eeb4fa2f7f4d318e117772767d25c9c9bc4592e8e928290030190a3600192505b5b5050919050565b6000805460408051602090810184905290517fdc5acb9000000000000000000000000000000000000000000000000000000000815260048101828152855160248301528551600160a060020a039094169363dc5acb909387938392604490910191850190808383821561189e575b80518252602083111561189e57601f19909201916020918201910161187e565b505050905090810190601f1680156118ca5780820380516001836020036101000a031916815260200191505b5092505050602060405180830381600087803b156100005760325a03f115610000575050604051519150505b9190505600a165627a7a72305820fea23c85110bc983712e4b3def997c5efb594c93df3b12a2346cb25edb899b8b0029",
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
    "updated_at": 1485621262215,
    "links": {},
    "address": "0xcffb7109c83746d7b8e6f82237314169e2903ba1"
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
    "unlinked_binary": "0x6060604052346100005760405160208061198883398101604052515b805b600160a060020a038116151561003257610000565b60008054600160a060020a031916600160a060020a0383161790555b505b505b611927806100616000396000f300606060405236156100725763ffffffff60e060020a600035041663105b68f1811461007757806318bf9a42146101d757806369a75e481461022b578063775274a11461024a578063977194291461026e578063bfde8994146102d9578063c809c3b8146102fd578063cbaaa3ac14610321575b610000565b6101c3600480803590602001908201803590602001908080601f0160208091040260200160405190810160405280939291908181526020018383808284375050604080516020601f89358b0180359182018390048302840183019094528083529799988101979196509182019450925082915084018382808284375050604080516020601f89358b0180359182018390048302840183019094528083529799988101979196509182019450925082915084018382808284375050604080516020601f89358b0180359182018390048302840183019094528083529799988101979196509182019450925082915084018382808284375050604080516020888301358a018035601f81018390048302840183019094528383529799893599808301359991985060600196509194509081019250819084018382808284375094965061039095505050505050565b604080519115158252519081900360200190f35b34610000576101e7600435610c89565b6040518087815260200186815260200185815260200184815260200183815260200182600281116100005760ff168152602001965050505050505060405180910390f35b6101c3600435610cc6565b604080519115158252519081900360200190f35b34610000576101c3600435610e7b565b604080519115158252519081900360200190f35b3461000057604080516020600460443581810135601f81018490048402850184019095528484526101c39482359460248035956064949293919092019181908401838280828437509496506110b095505050505050565b604080519115158252519081900360200190f35b34610000576101c36004356113ba565b604080519115158252519081900360200190f35b34610000576101c3600435611641565b604080519115158252519081900360200190f35b3461000057610374600480803590602001908201803590602001908080601f0160208091040260200160405190810160405280939291908181526020018383808284375094965061181095505050505050565b60408051600160a060020a039092168252519081900360200190f35b6000600060006103d5604060405190810160405280601a81526020017f636f6d2e62396c61622e64726174696e672e696e766573746f72000000000000815250611810565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f115610000575050604051511515905061044e57610000565b341580610459575084155b8061046357508351155b8061046e5750428611155b1561047857610000565b338a8a88348989436040518089600160a060020a0316600160a060020a03166c0100000000000000000000000002815260140188805190602001908083835b602083106104d65780518252601f1990920191602091820191016104b7565b51815160209384036101000a60001901801990921691161790528a5191909301928a0191508083835b6020831061051e5780518252601f1990920191602091820191016104ff565b51815160209384036101000a60001901801990921691161790529201888152808301889052604081018790528551606090910192860191508083835b602083106105795780518252601f19909201916020918201910161055a565b51815160209384036101000a600019018019909216911617905292019384525060408051938490038201909320600081815260019092529281208054939c5099509750508610159450610000935050505057906000526020600020900160005b505460026000196101006001841615020190911604156105f857610000565b50600081815260016020526040812080549091859183919081101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061066f57805160ff191683800117855561069c565b8280016001018555821561069c579182015b8281111561069c578251825591602001919060010190610681565b5b506106bd9291505b808211156106b957600081556001016106a5565b5090565b505089816000016001815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061072757805160ff1916838001178555610754565b82800160010185558215610754579182015b82811115610754578251825591602001919060010190610739565b5b506107759291505b808211156106b957600081556001016106a5565b5090565b505088816000016002815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f106107df57805160ff191683800117855561080c565b8280016001018555821561080c579182015b8281111561080c5782518255916020019190600101906107f1565b5b5061082d9291505b808211156106b957600081556001016106a5565b5090565b505087816000016003815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061089757805160ff19168380011785556108c4565b828001600101855582156108c4579182015b828111156108c45782518255916020019190600101906108a9565b5b506108e59291505b808211156106b957600081556001016106a5565b5090565b505086816000016004815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061094f57805160ff191683800117855561097c565b8280016001018555821561097c579182015b8281111561097c578251825591602001919060010190610961565b5b5061099d9291505b808211156106b957600081556001016106a5565b5090565b505060018181018790553460028301819055600383018790556000600584018190556006840181905560088401805460ff191690558481526020928352604080822033600160a060020a031683526004018452908190209190915551855186928291908401908083835b60208310610a265780518252601f199092019160209182019101610a07565b6001836020036101000a038019825116818451168082178552505050505050905001915050604051809103902033600160a060020a031683600019167f7332583e40367a020551753fffdb500c9a44e697d4ad2950edf96a4b9e60216a8d8d8d8d8d8d34604051808060200180602001806020018060200188815260200187815260200186815260200185810385528c818151815260200191508051906020019080838360008314610af3575b805182526020831115610af357601f199092019160209182019101610ad3565b505050905090810190601f168015610b1f5780820380516001836020036101000a031916815260200191505b5085810384528b5181528b516020918201918d01908083838215610b5e575b805182526020831115610b5e57601f199092019160209182019101610b3e565b505050905090810190601f168015610b8a5780820380516001836020036101000a031916815260200191505b5085810383528a5181528a516020918201918c01908083838215610bc9575b805182526020831115610bc957601f199092019160209182019101610ba9565b505050905090810190601f168015610bf55780820380516001836020036101000a031916815260200191505b5085810382528951815289516020918201918b01908083838215610c34575b805182526020831115610c3457601f199092019160209182019101610c14565b505050905090810190601f168015610c605780820380516001836020036101000a031916815260200191505b509b50505050505050505050505060405180910390a4600192505b5b5050979650505050505050565b6001602081905260009182526040909120908101546002820154600383015460058401546006850154600890950154939492939192909160ff1686565b60006000610d09604060405190810160405280601a81526020017f636f6d2e62396c61622e64726174696e672e696e766573746f72000000000000815250611810565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f1156100005750506040515115159050610d8257610000565b506000828152600160205260409020341580610dcd5750806000016000815481101561000057906000526020600020900160005b505460026000196101006001841615020190911604155b80610ddb5750428160010154105b80610df657506000600882015460ff16600281116100005714155b15610e0057610000565b600281018054349081018255600160a060020a033316600081815260048501602090815260409182902080548501905593548151938452938301939093528251909286927f3c3e5cbebfd0ef81bf2f3fb207432b7c74d47759fa64a631c485184486211b0d929081900390910190a3600191505b5b50919050565b6000600060006000610ec2604060405190810160405280601a81526020017f636f6d2e62396c61622e64726174696e672e696e766573746f72000000000000815250611810565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f1156100005750506040515115159050610f3b57610000565b60008581526001602052604081209350600884015460ff1660028111610000571415610fd257428360010154108015610f7657506006830154155b9150826000016000815481101561000057906000526020600020900160005b5054600260001961010060018416150201909116041580610fb4575081155b15610fbe57610000565b60088301805460ff19166001179055610ff4565b6001600884015460ff166002811161000057141561007257610ff4565b610000565b5b600160a060020a0333166000908152600484016020526040902054151561101b57610000565b50600160a060020a0333166000818152600484016020526040808220805490839055905190929183156108fc02918491818181858888f19350505050151561106257610000565b604080518281529051600160a060020a0333169187917f4ae7c15cd04d8a5097b1f1fda073a122b3d11db2fa19a1d50b62e525bb165d159181900360200190a3600193505b5b505050919050565b6000600060006110f5604060405190810160405280601981526020017f636f6d2e62396c61622e64726174696e672e61756469746f7200000000000000815250611810565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f115610000575050604051511515905061116e57610000565b50506000848152600160209081526040808320600160a060020a033316845260078101909252822081549192909183919081101561000057906000526020600020900160005b50546002600019610100600184161502019091160415806111d75750805460ff16155b806111e55750428260010154105b806111ef57508351155b8061120a57506000600883015460ff16600281116100005714155b1561121457610000565b600280820154600019610100600183161502011604151561123b5760068201805460010190555b84816001018190555083816002019080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061129257805160ff19168380011785556112bf565b828001600101855582156112bf579182015b828111156112bf5782518255916020019190600101906112a4565b5b506112e09291505b808211156106b957600081556001016106a5565b5090565b505033600160a060020a031686600019167f561d692d608576714937a081b8dcd88b472f1781c31a856faddba126374d61a9878786600601546040518084815260200180602001838152602001828103825284818151815260200191508051906020019080838360008314611370575b80518252602083111561137057601f199092019160209182019101611350565b505050905090810190601f16801561139c5780820380516001836020036101000a031916815260200191505b5094505050505060405180910390a3600192505b5b50509392505050565b60006000600060006000611403604060405190810160405280601981526020017f636f6d2e62396c61622e64726174696e672e61756469746f7200000000000000815250611810565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f115610000575050604051511515905061147c57610000565b6000868152600160209081526040808320600160a060020a03331684526007810190925282209095509350600885015460ff166002811161000057141561153f5742846001015410806114d6575083600301548460060154145b9150836000016000815481101561000057906000526020600020900160005b505460026000196101006001841615020190911604158061151857506006840154155b80611521575081155b1561152b57610000565b60088401805460ff19166002179055611561565b6002600885015460ff166002811161000057141561007257611561565b610000565b5b825460ff1615806115855750600280840154600019610100600183161502011604155b806115945750600383015460ff165b1561159e57610000565b60038301805460ff19166001179055600684015460028501548115610000576040519190049150600160a060020a0333169082156108fc029083906000818181858888f1935050505015156115f257610000565b604080518281529051600160a060020a0333169188917f31bfdeff7497910d6af7611e390ea041175d3897520804a90d9d3c8d8c91c5d09181900360200190a3600194505b5b50505050919050565b600060006000611686604060405190810160405280601981526020017f636f6d2e62396c61622e64726174696e672e61756469746f7200000000000000815250611810565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f11561000057505060405151151590506116ff57610000565b50506000828152600160209081526040808320600160a060020a033316845260078101909252822081549192909183919081101561000057906000526020600020900160005b505460026000196101006001841615020190911604158061176d575081600301548260050154145b806117795750805460ff165b806117875750428260010154105b806117a257506000600883015460ff16600281116100005714155b156117ac57610000565b600160a060020a033316600081905260078301602090815260058401805460010190819055604080519182525187927fc8350213f5030bd4e879cb2eeb4fa2f7f4d318e117772767d25c9c9bc4592e8e928290030190a3600192505b5b5050919050565b6000805460408051602090810184905290517fdc5acb9000000000000000000000000000000000000000000000000000000000815260048101828152855160248301528551600160a060020a039094169363dc5acb909387938392604490910191850190808383821561189e575b80518252602083111561189e57601f19909201916020918201910161187e565b505050905090810190601f1680156118ca5780820380516001836020036101000a031916815260200191505b5092505050602060405180830381600087803b156100005760325a03f115610000575050604051519150505b9190505600a165627a7a723058209d8158c3aef431ec6b5c782a3aa35113b8cf49c592eef0298eb9a7e2b95106cd0029",
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
    "updated_at": 1485620694292
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
