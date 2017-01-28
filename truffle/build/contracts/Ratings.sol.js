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
            "name": "permid",
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
          },
          {
            "name": "permid",
            "type": "string"
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
            "name": "permid",
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
    "unlinked_binary": "0x606060405234610000576040516040806121898339810160405280516020909101515b815b600160a060020a038116151561003957610000565b60008054600160a060020a031916600160a060020a0383161790555b5060028054600160a060020a031916600160a060020a0383161790555b50505b612105806100846000396000f300606060405236156100935763ffffffff60e060020a600035041663105b68f1811461009857806318bf9a42146101f857806351093ba71461024c57806369a75e4814610306578063775274a1146103255780637a02dc061461034957806397719429146105a2578063b3b200d61461060d578063bfde899414610636578063c809c3b81461065a578063cbaaa3ac1461067e575b610000565b6101e4600480803590602001908201803590602001908080601f0160208091040260200160405190810160405280939291908181526020018383808284375050604080516020601f89358b0180359182018390048302840183019094528083529799988101979196509182019450925082915084018382808284375050604080516020601f89358b0180359182018390048302840183019094528083529799988101979196509182019450925082915084018382808284375050604080516020601f89358b0180359182018390048302840183019094528083529799988101979196509182019450925082915084018382808284375050604080516020888301358a018035601f8101839004830284018301909452838352979989359980830135999198506060019650919450908101925081908401838280828437509496506106ed95505050505050565b604080519115158252519081900360200190f35b3461000057610208600435611088565b6040518087815260200186815260200185815260200184815260200183815260200182600281116100005760ff168152602001965050505050505060405180910390f35b3461000057610268600435600160a060020a03602435166110c5565b604080518515158152602080820186905283151560608301526080928201838152855193830193909352845191929160a084019186019080838382156102c9575b8051825260208311156102c957601f1990920191602091820191016102a9565b505050905090810190601f1680156102f55780820380516001836020036101000a031916815260200191505b509550505050505060405180910390f35b6101e46004356111b5565b604080519115158252519081900360200190f35b34610000576101e460043561133a565b604080519115158252519081900360200190f35b3461000057610359600435611540565b60405180806020018060200180602001806020018060200186810386528b8181518152602001915080519060200190808383600083146103b4575b8051825260208311156103b457601f199092019160209182019101610394565b505050905090810190601f1680156103e05780820380516001836020036101000a031916815260200191505b5086810385528a5181528a516020918201918c0190808383821561041f575b80518252602083111561041f57601f1990920191602091820191016103ff565b505050905090810190601f16801561044b5780820380516001836020036101000a031916815260200191505b5086810384528951815289516020918201918b0190808383821561048a575b80518252602083111561048a57601f19909201916020918201910161046a565b505050905090810190601f1680156104b65780820380516001836020036101000a031916815260200191505b5086810383528851815288516020918201918a019080838382156104f5575b8051825260208311156104f557601f1990920191602091820191016104d5565b505050905090810190601f1680156105215780820380516001836020036101000a031916815260200191505b5086810382528751815287516020918201918901908083838215610560575b80518252602083111561056057601f199092019160209182019101610540565b505050905090810190601f16801561058c5780820380516001836020036101000a031916815260200191505b509a505050505050505050505060405180910390f35b3461000057604080516020600460443581810135601f81018490048402850184019095528484526101e49482359460248035956064949293919092019181908401838280828437509496506118fa95505050505050565b604080519115158252519081900360200190f35b346100005761061a611bd4565b60408051600160a060020a039092168252519081900360200190f35b34610000576101e4600435611be3565b604080519115158252519081900360200190f35b34610000576101e4600435611e3b565b604080519115158252519081900360200190f35b346100005761061a600480803590602001908201803590602001908080601f01602080910402602001604051908101604052809392919081815260200183838082843750949650611fee95505050505050565b60408051600160a060020a039092168252519081900360200190f35b600060006000610732604060405190810160405280601a81526020017f636f6d2e62396c61622e64726174696e672e696e766573746f72000000000000815250611fee565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f11561000057505060405151151590506107ab57610000565b3415806107b6575084155b806107c057508351155b806107cb5750428611155b156107d557610000565b338a8a88348989436040518089600160a060020a0316600160a060020a03166c0100000000000000000000000002815260140188805190602001908083835b602083106108335780518252601f199092019160209182019101610814565b51815160209384036101000a60001901801990921691161790528a5191909301928a0191508083835b6020831061087b5780518252601f19909201916020918201910161085c565b51815160209384036101000a60001901801990921691161790529201888152808301889052604081018790528551606090910192860191508083835b602083106108d65780518252601f1990920191602091820191016108b7565b51815160209384036101000a600019018019909216911617905292019384525060408051938490038201909320600081815260019092529290208054929b5099505015965061092b9550505050505057610000565b600581600001818154818355818115116109c3576000838152602090206109c39181019083015b808211156109b057600081805460018160011615610100020316600290046000825580601f1061098257506109b4565b601f0160209004906000526020600020908101906109b491905b808211156109b0576000815560010161099c565b5090565b5b5050600101610952565b5090565b5b5050505083816000016000815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f10610a3057805160ff1916838001178555610a5d565b82800160010185558215610a5d579182015b82811115610a5d578251825591602001919060010190610a42565b5b50610a7e9291505b808211156109b0576000815560010161099c565b5090565b505089816000016001815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f10610ae857805160ff1916838001178555610b15565b82800160010185558215610b15579182015b82811115610b15578251825591602001919060010190610afa565b5b50610b369291505b808211156109b0576000815560010161099c565b5090565b505088816000016002815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f10610ba057805160ff1916838001178555610bcd565b82800160010185558215610bcd579182015b82811115610bcd578251825591602001919060010190610bb2565b5b50610bee9291505b808211156109b0576000815560010161099c565b5090565b505087816000016003815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f10610c5857805160ff1916838001178555610c85565b82800160010185558215610c85579182015b82811115610c85578251825591602001919060010190610c6a565b5b50610ca69291505b808211156109b0576000815560010161099c565b5090565b505086816000016004815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f10610d1057805160ff1916838001178555610d3d565b82800160010185558215610d3d579182015b82811115610d3d578251825591602001919060010190610d22565b5b50610d5e9291505b808211156109b0576000815560010161099c565b5090565b5050600180820187905534600283015560038201869055600060058301819055600683018190556008830180549192909160ff19169083021790555034600160008460001916600019168152602001908152602001600020600401600033600160a060020a0316600160a060020a031681526020019081526020016000208190555033600160a060020a031682600019167f7332583e40367a020551753fffdb500c9a44e697d4ad2950edf96a4b9e60216a868d8d8d8d8d8d3460405180806020018060200180602001806020018060200189815260200188815260200187815260200186810386528e818151815260200191508051906020019080838360008314610e85575b805182526020831115610e8557601f199092019160209182019101610e65565b505050905090810190601f168015610eb15780820380516001836020036101000a031916815260200191505b5086810385528d5181528d516020918201918f01908083838215610ef0575b805182526020831115610ef057601f199092019160209182019101610ed0565b505050905090810190601f168015610f1c5780820380516001836020036101000a031916815260200191505b5086810384528c5181528c516020918201918e01908083838215610f5b575b805182526020831115610f5b57601f199092019160209182019101610f3b565b505050905090810190601f168015610f875780820380516001836020036101000a031916815260200191505b5086810383528b5181528b516020918201918d01908083838215610fc6575b805182526020831115610fc657601f199092019160209182019101610fa6565b505050905090810190601f168015610ff25780820380516001836020036101000a031916815260200191505b5086810382528a5181528a516020918201918c01908083838215611031575b80518252602083111561103157601f199092019160209182019101611011565b505050905090810190601f16801561105d5780820380516001836020036101000a031916815260200191505b509d505050505050505050505050505060405180910390a3600192505b5b5050979650505050505050565b6001602081905260009182526040909120908101546002820154600383015460058401546006850154600890950154939492939192909160ff1686565b604080516020818101835260008083528581526001808352848220600160a060020a038716835260070183528482208054818301546003830154600280850180548b51601f98821615610100026000190190911692909204968701899004890282018901909a5285815295988998978997959660ff9586169694959294939092169291849183018282801561119b5780601f106111705761010080835404028352916020019161119b565b820191906000526020600020905b81548152906001019060200180831161117e57829003601f168201915b5050505050915094509450945094505b5092959194509250565b600060006111f8604060405190810160405280601a81526020017f636f6d2e62396c61622e64726174696e672e696e766573746f72000000000000815250611fee565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f115610000575050604051511515905061127157610000565b50600082815260016020526040902034158061128c57508054155b8061129a5750428160010154105b806112b557506000600882015460ff16600281116100005714155b156112bf57610000565b600281018054349081018255600160a060020a033316600081815260048501602090815260409182902080548501905593548151938452938301939093528251909286927f3c3e5cbebfd0ef81bf2f3fb207432b7c74d47759fa64a631c485184486211b0d929081900390910190a3600191505b5b50919050565b6000600060006000611381604060405190810160405280601a81526020017f636f6d2e62396c61622e64726174696e672e696e766573746f72000000000000815250611fee565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f11561000057505060405151151590506113fa57610000565b60008581526001602052604081209350600884015460ff16600281116100005714156114625742836001015410801561143557506006830154155b83549092501580611444575081155b1561144e57610000565b60088301805460ff19166001179055611484565b6001600884015460ff166002811161000057141561009357611484565b610000565b5b600160a060020a033316600090815260048401602052604090205415156114ab57610000565b50600160a060020a0333166000818152600484016020526040808220805490839055905190929183156108fc02918491818181858888f1935050505015156114f257610000565b604080518281529051600160a060020a0333169187917f4ae7c15cd04d8a5097b1f1fda073a122b3d11db2fa19a1d50b62e525bb165d159181900360200190a3600193505b5b505050919050565b6040805160208181018352600080835283518083018552818152845180840186528281528551808501875283815286518086018852848152888552600190955295832080549596929591949293909182919081101561000057906000526020600020900160005b50816000016001815481101561000057906000526020600020900160005b50826000016002815481101561000057906000526020600020900160005b50836000016003815481101561000057906000526020600020900160005b50846000016004815481101561000057906000526020600020900160005b508454604080516020601f600260001961010060018816150201909516949094049384018190048102820181019092528281529187918301828280156116a65780601f1061167b576101008083540402835291602001916116a6565b820191906000526020600020905b81548152906001019060200180831161168957829003601f168201915b5050875460408051602060026001851615610100026000190190941693909304601f8101849004840282018401909252818152959a50899450925084019050828280156117345780601f1061170957610100808354040283529160200191611734565b820191906000526020600020905b81548152906001019060200180831161171757829003601f168201915b5050865460408051602060026001851615610100026000190190941693909304601f8101849004840282018401909252818152959950889450925084019050828280156117c25780601f10611797576101008083540402835291602001916117c2565b820191906000526020600020905b8154815290600101906020018083116117a557829003601f168201915b5050855460408051602060026001851615610100026000190190941693909304601f8101849004840282018401909252818152959850879450925084019050828280156118505780601f1061182557610100808354040283529160200191611850565b820191906000526020600020905b81548152906001019060200180831161183357829003601f168201915b5050845460408051602060026001851615610100026000190190941693909304601f8101849004840282018401909252818152959750869450925084019050828280156118de5780601f106118b3576101008083540402835291602001916118de565b820191906000526020600020905b8154815290600101906020018083116118c157829003601f168201915b50505050509050955095509550955095505b5091939590929450565b60006000600061193f604060405190810160405280601981526020017f636f6d2e62396c61622e64726174696e672e61756469746f7200000000000000815250611fee565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f11561000057505060405151151590506119b857610000565b50506000848152600160209081526040808320600160a060020a033316845260078101909252909120815415806119f15750805460ff16155b806119ff5750428260010154105b80611a0957508351155b80611a2457506000600883015460ff16600281116100005714155b15611a2e57610000565b6002808201546000196101006001831615020116041515611a555760068201805460010190555b84816001018190555083816002019080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f10611aac57805160ff1916838001178555611ad9565b82800160010185558215611ad9579182015b82811115611ad9578251825591602001919060010190611abe565b5b50611afa9291505b808211156109b0576000815560010161099c565b5090565b505033600160a060020a031686600019167f561d692d608576714937a081b8dcd88b472f1781c31a856faddba126374d61a9878786600601546040518084815260200180602001838152602001828103825284818151815260200191508051906020019080838360008314611b8a575b805182526020831115611b8a57601f199092019160209182019101611b6a565b505050905090810190601f168015611bb65780820380516001836020036101000a031916815260200191505b5094505050505060405180910390a3600192505b5b50509392505050565b600254600160a060020a031681565b60006000600060006000611c2c604060405190810160405280601981526020017f636f6d2e62396c61622e64726174696e672e61756469746f7200000000000000815250611fee565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f1156100005750506040515115159050611ca557610000565b6000868152600160209081526040808320600160a060020a03331684526007810190925282209095509350600885015460ff1660028111610000571415611d39574284600101541080611cff575083600301548460060154145b84549092501580611d1257506006840154155b80611d1b575081155b15611d2557610000565b60088401805460ff19166002179055611d5b565b6002600885015460ff166002811161000057141561009357611d5b565b610000565b5b825460ff161580611d7f5750600280840154600019610100600183161502011604155b80611d8e5750600383015460ff165b15611d9857610000565b60038301805460ff19166001179055600684015460028501548115610000576040519190049150600160a060020a0333169082156108fc029083906000818181858888f193505050501515611dec57610000565b604080518281529051600160a060020a0333169188917f31bfdeff7497910d6af7611e390ea041175d3897520804a90d9d3c8d8c91c5d09181900360200190a3600194505b5b50505050919050565b600060006000611e80604060405190810160405280601981526020017f636f6d2e62396c61622e64726174696e672e61756469746f7200000000000000815250611fee565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f1156100005750506040515115159050611ef957610000565b50506000828152600160209081526040808320600160a060020a03331684526007810190925290912081541580611f37575081600301548260050154145b80611f435750805460ff165b80611f515750428260010154105b80611f6c57506000600883015460ff16600281116100005714155b15611f7657610000565b600160a060020a0333166000818152600784016020908152604091829020805460ff19166001908117909155600586018054909101908190558251908152915187927fc8350213f5030bd4e879cb2eeb4fa2f7f4d318e117772767d25c9c9bc4592e8e92908290030190a3600192505b5b5050919050565b6000805460408051602090810184905290517fdc5acb9000000000000000000000000000000000000000000000000000000000815260048101828152855160248301528551600160a060020a039094169363dc5acb909387938392604490910191850190808383821561207c575b80518252602083111561207c57601f19909201916020918201910161205c565b505050905090810190601f1680156120a85780820380516001836020036101000a031916815260200191505b5092505050602060405180830381600087803b156100005760325a03f115610000575050604051519150505b9190505600a165627a7a72305820bdc43763b1af33a12e5ad5343e888920ae07624bc7ead0041309a3f940e7ddae0029",
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
            "name": "permid",
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
    "updated_at": 1485634849722,
    "links": {},
    "address": "0xd870155b156328bd1e0e7d8e139c9b33d164bd84"
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
            "name": "permid",
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
          },
          {
            "name": "permid",
            "type": "string"
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
            "name": "permid",
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
    "unlinked_binary": "0x606060405234610000576040516040806121898339810160405280516020909101515b815b600160a060020a038116151561003957610000565b60008054600160a060020a031916600160a060020a0383161790555b5060028054600160a060020a031916600160a060020a0383161790555b50505b612105806100846000396000f300606060405236156100935763ffffffff60e060020a600035041663105b68f1811461009857806318bf9a42146101f857806351093ba71461024c57806369a75e4814610306578063775274a1146103255780637a02dc061461034957806397719429146105a2578063b3b200d61461060d578063bfde899414610636578063c809c3b81461065a578063cbaaa3ac1461067e575b610000565b6101e4600480803590602001908201803590602001908080601f0160208091040260200160405190810160405280939291908181526020018383808284375050604080516020601f89358b0180359182018390048302840183019094528083529799988101979196509182019450925082915084018382808284375050604080516020601f89358b0180359182018390048302840183019094528083529799988101979196509182019450925082915084018382808284375050604080516020601f89358b0180359182018390048302840183019094528083529799988101979196509182019450925082915084018382808284375050604080516020888301358a018035601f8101839004830284018301909452838352979989359980830135999198506060019650919450908101925081908401838280828437509496506106ed95505050505050565b604080519115158252519081900360200190f35b3461000057610208600435611088565b6040518087815260200186815260200185815260200184815260200183815260200182600281116100005760ff168152602001965050505050505060405180910390f35b3461000057610268600435600160a060020a03602435166110c5565b604080518515158152602080820186905283151560608301526080928201838152855193830193909352845191929160a084019186019080838382156102c9575b8051825260208311156102c957601f1990920191602091820191016102a9565b505050905090810190601f1680156102f55780820380516001836020036101000a031916815260200191505b509550505050505060405180910390f35b6101e46004356111b5565b604080519115158252519081900360200190f35b34610000576101e460043561133a565b604080519115158252519081900360200190f35b3461000057610359600435611540565b60405180806020018060200180602001806020018060200186810386528b8181518152602001915080519060200190808383600083146103b4575b8051825260208311156103b457601f199092019160209182019101610394565b505050905090810190601f1680156103e05780820380516001836020036101000a031916815260200191505b5086810385528a5181528a516020918201918c0190808383821561041f575b80518252602083111561041f57601f1990920191602091820191016103ff565b505050905090810190601f16801561044b5780820380516001836020036101000a031916815260200191505b5086810384528951815289516020918201918b0190808383821561048a575b80518252602083111561048a57601f19909201916020918201910161046a565b505050905090810190601f1680156104b65780820380516001836020036101000a031916815260200191505b5086810383528851815288516020918201918a019080838382156104f5575b8051825260208311156104f557601f1990920191602091820191016104d5565b505050905090810190601f1680156105215780820380516001836020036101000a031916815260200191505b5086810382528751815287516020918201918901908083838215610560575b80518252602083111561056057601f199092019160209182019101610540565b505050905090810190601f16801561058c5780820380516001836020036101000a031916815260200191505b509a505050505050505050505060405180910390f35b3461000057604080516020600460443581810135601f81018490048402850184019095528484526101e49482359460248035956064949293919092019181908401838280828437509496506118fa95505050505050565b604080519115158252519081900360200190f35b346100005761061a611bd4565b60408051600160a060020a039092168252519081900360200190f35b34610000576101e4600435611be3565b604080519115158252519081900360200190f35b34610000576101e4600435611e3b565b604080519115158252519081900360200190f35b346100005761061a600480803590602001908201803590602001908080601f01602080910402602001604051908101604052809392919081815260200183838082843750949650611fee95505050505050565b60408051600160a060020a039092168252519081900360200190f35b600060006000610732604060405190810160405280601a81526020017f636f6d2e62396c61622e64726174696e672e696e766573746f72000000000000815250611fee565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f11561000057505060405151151590506107ab57610000565b3415806107b6575084155b806107c057508351155b806107cb5750428611155b156107d557610000565b338a8a88348989436040518089600160a060020a0316600160a060020a03166c0100000000000000000000000002815260140188805190602001908083835b602083106108335780518252601f199092019160209182019101610814565b51815160209384036101000a60001901801990921691161790528a5191909301928a0191508083835b6020831061087b5780518252601f19909201916020918201910161085c565b51815160209384036101000a60001901801990921691161790529201888152808301889052604081018790528551606090910192860191508083835b602083106108d65780518252601f1990920191602091820191016108b7565b51815160209384036101000a600019018019909216911617905292019384525060408051938490038201909320600081815260019092529290208054929b5099505015965061092b9550505050505057610000565b600581600001818154818355818115116109c3576000838152602090206109c39181019083015b808211156109b057600081805460018160011615610100020316600290046000825580601f1061098257506109b4565b601f0160209004906000526020600020908101906109b491905b808211156109b0576000815560010161099c565b5090565b5b5050600101610952565b5090565b5b5050505083816000016000815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f10610a3057805160ff1916838001178555610a5d565b82800160010185558215610a5d579182015b82811115610a5d578251825591602001919060010190610a42565b5b50610a7e9291505b808211156109b0576000815560010161099c565b5090565b505089816000016001815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f10610ae857805160ff1916838001178555610b15565b82800160010185558215610b15579182015b82811115610b15578251825591602001919060010190610afa565b5b50610b369291505b808211156109b0576000815560010161099c565b5090565b505088816000016002815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f10610ba057805160ff1916838001178555610bcd565b82800160010185558215610bcd579182015b82811115610bcd578251825591602001919060010190610bb2565b5b50610bee9291505b808211156109b0576000815560010161099c565b5090565b505087816000016003815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f10610c5857805160ff1916838001178555610c85565b82800160010185558215610c85579182015b82811115610c85578251825591602001919060010190610c6a565b5b50610ca69291505b808211156109b0576000815560010161099c565b5090565b505086816000016004815481101561000057906000526020600020900160005b509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f10610d1057805160ff1916838001178555610d3d565b82800160010185558215610d3d579182015b82811115610d3d578251825591602001919060010190610d22565b5b50610d5e9291505b808211156109b0576000815560010161099c565b5090565b5050600180820187905534600283015560038201869055600060058301819055600683018190556008830180549192909160ff19169083021790555034600160008460001916600019168152602001908152602001600020600401600033600160a060020a0316600160a060020a031681526020019081526020016000208190555033600160a060020a031682600019167f7332583e40367a020551753fffdb500c9a44e697d4ad2950edf96a4b9e60216a868d8d8d8d8d8d3460405180806020018060200180602001806020018060200189815260200188815260200187815260200186810386528e818151815260200191508051906020019080838360008314610e85575b805182526020831115610e8557601f199092019160209182019101610e65565b505050905090810190601f168015610eb15780820380516001836020036101000a031916815260200191505b5086810385528d5181528d516020918201918f01908083838215610ef0575b805182526020831115610ef057601f199092019160209182019101610ed0565b505050905090810190601f168015610f1c5780820380516001836020036101000a031916815260200191505b5086810384528c5181528c516020918201918e01908083838215610f5b575b805182526020831115610f5b57601f199092019160209182019101610f3b565b505050905090810190601f168015610f875780820380516001836020036101000a031916815260200191505b5086810383528b5181528b516020918201918d01908083838215610fc6575b805182526020831115610fc657601f199092019160209182019101610fa6565b505050905090810190601f168015610ff25780820380516001836020036101000a031916815260200191505b5086810382528a5181528a516020918201918c01908083838215611031575b80518252602083111561103157601f199092019160209182019101611011565b505050905090810190601f16801561105d5780820380516001836020036101000a031916815260200191505b509d505050505050505050505050505060405180910390a3600192505b5b5050979650505050505050565b6001602081905260009182526040909120908101546002820154600383015460058401546006850154600890950154939492939192909160ff1686565b604080516020818101835260008083528581526001808352848220600160a060020a038716835260070183528482208054818301546003830154600280850180548b51601f98821615610100026000190190911692909204968701899004890282018901909a5285815295988998978997959660ff9586169694959294939092169291849183018282801561119b5780601f106111705761010080835404028352916020019161119b565b820191906000526020600020905b81548152906001019060200180831161117e57829003601f168201915b5050505050915094509450945094505b5092959194509250565b600060006111f8604060405190810160405280601a81526020017f636f6d2e62396c61622e64726174696e672e696e766573746f72000000000000815250611fee565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f115610000575050604051511515905061127157610000565b50600082815260016020526040902034158061128c57508054155b8061129a5750428160010154105b806112b557506000600882015460ff16600281116100005714155b156112bf57610000565b600281018054349081018255600160a060020a033316600081815260048501602090815260409182902080548501905593548151938452938301939093528251909286927f3c3e5cbebfd0ef81bf2f3fb207432b7c74d47759fa64a631c485184486211b0d929081900390910190a3600191505b5b50919050565b6000600060006000611381604060405190810160405280601a81526020017f636f6d2e62396c61622e64726174696e672e696e766573746f72000000000000815250611fee565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f11561000057505060405151151590506113fa57610000565b60008581526001602052604081209350600884015460ff16600281116100005714156114625742836001015410801561143557506006830154155b83549092501580611444575081155b1561144e57610000565b60088301805460ff19166001179055611484565b6001600884015460ff166002811161000057141561009357611484565b610000565b5b600160a060020a033316600090815260048401602052604090205415156114ab57610000565b50600160a060020a0333166000818152600484016020526040808220805490839055905190929183156108fc02918491818181858888f1935050505015156114f257610000565b604080518281529051600160a060020a0333169187917f4ae7c15cd04d8a5097b1f1fda073a122b3d11db2fa19a1d50b62e525bb165d159181900360200190a3600193505b5b505050919050565b6040805160208181018352600080835283518083018552818152845180840186528281528551808501875283815286518086018852848152888552600190955295832080549596929591949293909182919081101561000057906000526020600020900160005b50816000016001815481101561000057906000526020600020900160005b50826000016002815481101561000057906000526020600020900160005b50836000016003815481101561000057906000526020600020900160005b50846000016004815481101561000057906000526020600020900160005b508454604080516020601f600260001961010060018816150201909516949094049384018190048102820181019092528281529187918301828280156116a65780601f1061167b576101008083540402835291602001916116a6565b820191906000526020600020905b81548152906001019060200180831161168957829003601f168201915b5050875460408051602060026001851615610100026000190190941693909304601f8101849004840282018401909252818152959a50899450925084019050828280156117345780601f1061170957610100808354040283529160200191611734565b820191906000526020600020905b81548152906001019060200180831161171757829003601f168201915b5050865460408051602060026001851615610100026000190190941693909304601f8101849004840282018401909252818152959950889450925084019050828280156117c25780601f10611797576101008083540402835291602001916117c2565b820191906000526020600020905b8154815290600101906020018083116117a557829003601f168201915b5050855460408051602060026001851615610100026000190190941693909304601f8101849004840282018401909252818152959850879450925084019050828280156118505780601f1061182557610100808354040283529160200191611850565b820191906000526020600020905b81548152906001019060200180831161183357829003601f168201915b5050845460408051602060026001851615610100026000190190941693909304601f8101849004840282018401909252818152959750869450925084019050828280156118de5780601f106118b3576101008083540402835291602001916118de565b820191906000526020600020905b8154815290600101906020018083116118c157829003601f168201915b50505050509050955095509550955095505b5091939590929450565b60006000600061193f604060405190810160405280601981526020017f636f6d2e62396c61622e64726174696e672e61756469746f7200000000000000815250611fee565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f11561000057505060405151151590506119b857610000565b50506000848152600160209081526040808320600160a060020a033316845260078101909252909120815415806119f15750805460ff16155b806119ff5750428260010154105b80611a0957508351155b80611a2457506000600883015460ff16600281116100005714155b15611a2e57610000565b6002808201546000196101006001831615020116041515611a555760068201805460010190555b84816001018190555083816002019080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f10611aac57805160ff1916838001178555611ad9565b82800160010185558215611ad9579182015b82811115611ad9578251825591602001919060010190611abe565b5b50611afa9291505b808211156109b0576000815560010161099c565b5090565b505033600160a060020a031686600019167f561d692d608576714937a081b8dcd88b472f1781c31a856faddba126374d61a9878786600601546040518084815260200180602001838152602001828103825284818151815260200191508051906020019080838360008314611b8a575b805182526020831115611b8a57601f199092019160209182019101611b6a565b505050905090810190601f168015611bb65780820380516001836020036101000a031916815260200191505b5094505050505060405180910390a3600192505b5b50509392505050565b600254600160a060020a031681565b60006000600060006000611c2c604060405190810160405280601981526020017f636f6d2e62396c61622e64726174696e672e61756469746f7200000000000000815250611fee565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f1156100005750506040515115159050611ca557610000565b6000868152600160209081526040808320600160a060020a03331684526007810190925282209095509350600885015460ff1660028111610000571415611d39574284600101541080611cff575083600301548460060154145b84549092501580611d1257506006840154155b80611d1b575081155b15611d2557610000565b60088401805460ff19166002179055611d5b565b6002600885015460ff166002811161000057141561009357611d5b565b610000565b5b825460ff161580611d7f5750600280840154600019610100600183161502011604155b80611d8e5750600383015460ff165b15611d9857610000565b60038301805460ff19166001179055600684015460028501548115610000576040519190049150600160a060020a0333169082156108fc029083906000818181858888f193505050501515611dec57610000565b604080518281529051600160a060020a0333169188917f31bfdeff7497910d6af7611e390ea041175d3897520804a90d9d3c8d8c91c5d09181900360200190a3600194505b5b50505050919050565b600060006000611e80604060405190810160405280601981526020017f636f6d2e62396c61622e64726174696e672e61756469746f7200000000000000815250611fee565b600160a060020a0316639ce6582d336000604051602001526040518263ffffffff1660e060020a0281526004018082600160a060020a0316600160a060020a03168152602001915050602060405180830381600087803b156100005760325a03f1156100005750506040515115159050611ef957610000565b50506000828152600160209081526040808320600160a060020a03331684526007810190925290912081541580611f37575081600301548260050154145b80611f435750805460ff165b80611f515750428260010154105b80611f6c57506000600883015460ff16600281116100005714155b15611f7657610000565b600160a060020a0333166000818152600784016020908152604091829020805460ff19166001908117909155600586018054909101908190558251908152915187927fc8350213f5030bd4e879cb2eeb4fa2f7f4d318e117772767d25c9c9bc4592e8e92908290030190a3600192505b5b5050919050565b6000805460408051602090810184905290517fdc5acb9000000000000000000000000000000000000000000000000000000000815260048101828152855160248301528551600160a060020a039094169363dc5acb909387938392604490910191850190808383821561207c575b80518252602083111561207c57601f19909201916020918201910161205c565b505050905090810190601f1680156120a85780820380516001836020036101000a031916815260200191505b5092505050602060405180830381600087803b156100005760325a03f115610000575050604051519150505b9190505600a165627a7a72305820bdc43763b1af33a12e5ad5343e888920ae07624bc7ead0041309a3f940e7ddae0029",
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
            "name": "permid",
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
    "updated_at": 1485634870876,
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
