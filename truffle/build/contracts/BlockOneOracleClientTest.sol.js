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
      throw new Error("BlockOneOracleClientTest error: Please call setProvider() first before calling new().");
    }

    var args = Array.prototype.slice.call(arguments);

    if (!this.unlinked_binary) {
      throw new Error("BlockOneOracleClientTest error: contract binary not set. Can't deploy new instance.");
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

      throw new Error("BlockOneOracleClientTest contains unresolved libraries. You must deploy and link the following libraries before you can deploy a new version of BlockOneOracleClientTest: " + unlinked_libraries);
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
      throw new Error("Invalid address passed to BlockOneOracleClientTest.at(): " + address);
    }

    var contract_class = this.web3.eth.contract(this.abi);
    var contract = contract_class.at(address);

    return new this(contract);
  };

  Contract.deployed = function() {
    if (!this.address) {
      throw new Error("Cannot find deployed address: BlockOneOracleClientTest not deployed or address not set.");
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
  "default": {
    "abi": [
      {
        "constant": false,
        "inputs": [
          {
            "name": "requestId",
            "type": "uint256"
          },
          {
            "name": "timestamp",
            "type": "uint256"
          },
          {
            "name": "symbol",
            "type": "bytes32"
          },
          {
            "name": "price",
            "type": "uint256"
          },
          {
            "name": "bid",
            "type": "uint256"
          },
          {
            "name": "ask",
            "type": "uint256"
          },
          {
            "name": "volume",
            "type": "uint256"
          }
        ],
        "name": "respondSuccess_IntraDay",
        "outputs": [],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "symbol",
            "type": "bytes32"
          },
          {
            "name": "timestamp",
            "type": "uint256"
          }
        ],
        "name": "request_IntraDay",
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
        "constant": false,
        "inputs": [
          {
            "name": "requestId",
            "type": "uint256"
          },
          {
            "name": "timestamp",
            "type": "uint256"
          },
          {
            "name": "symbol",
            "type": "bytes32"
          },
          {
            "name": "price",
            "type": "uint256"
          },
          {
            "name": "bid",
            "type": "uint256"
          },
          {
            "name": "ask",
            "type": "uint256"
          },
          {
            "name": "volume",
            "type": "uint256"
          }
        ],
        "name": "respondSuccess_EndOfDay",
        "outputs": [],
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
        "name": "respondError_EndOfDay",
        "outputs": [],
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
        "name": "respondError_IntraDay",
        "outputs": [],
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
        "constant": false,
        "inputs": [
          {
            "name": "symbol",
            "type": "bytes32"
          },
          {
            "name": "timestamp",
            "type": "uint256"
          }
        ],
        "name": "request_EndOfDay",
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
          }
        ],
        "payable": false,
        "type": "constructor"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "requestId",
            "type": "uint256"
          }
        ],
        "name": "BlockOneOracleClientTest_onOracleResponse",
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
            "name": "reason",
            "type": "uint256"
          }
        ],
        "name": "BlockOneOracleClientTest_onOracleFailure",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "requestId",
            "type": "uint256"
          }
        ],
        "name": "BlockOneOracleClientTest_requested_IntraDay",
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
            "name": "timestamp",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "symbol",
            "type": "bytes32"
          },
          {
            "indexed": false,
            "name": "price",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "bid",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "ask",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "volume",
            "type": "uint256"
          }
        ],
        "name": "BlockOneOracleClientTest_respond_IntraDay",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "requestId",
            "type": "uint256"
          }
        ],
        "name": "BlockOneOracleClientTest_requested_EndOfDay",
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
            "name": "timestamp",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "symbol",
            "type": "bytes32"
          },
          {
            "indexed": false,
            "name": "price",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "bid",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "ask",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "volume",
            "type": "uint256"
          }
        ],
        "name": "BlockOneOracleClientTest_respond_EndOfDay",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "requestId",
            "type": "uint256"
          }
        ],
        "name": "BlockOneOracleClientTest_requested_EntityConnect",
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
            "name": "connections",
            "type": "uint256"
          }
        ],
        "name": "BlockOneOracleClientTest_respond_EntityConnect",
        "type": "event"
      }
    ],
    "unlinked_binary": "0x6060604052346100005760405160208061093a83398101604052515b805b805b600160a060020a038116151561003457610000565b60008054600160a060020a031916600160a060020a0383161790555b5060018054600160a060020a03191633600160a060020a03161790555b505b505b6108ba806100806000396000f3006060604052361561009e5763ffffffff60e060020a6000350416630c51402681146100a357806315226e14146100c757806317a96e5e146100ec57806320b08482146101105780636fda1150146101105780637c6a595114610110578063833b1fce1461014f57806383d04ed414610178578063a0cf91f51461018d578063cbaaa3ac146101b5578063d185e2cd14610224578063fe80dc3814610249575b610000565b34610000576100c560043560243560443560643560843560a43560c4356102d6565b005b34610000576100da60043560243561033c565b60408051918252519081900360200190f35b34610000576100c560043560243560443560643560843560a43560c435610386565b005b34610000576100c56004356024356103ec565b005b34610000576100c56004356024356103ec565b005b34610000576100c56004356024356103ec565b005b346100005761015c6104ac565b60408051600160a060020a039092168252519081900360200190f35b34610000576100c56004356024356104f3565b005b34610000576100da600435602435604435610533565b60408051918252519081900360200190f35b346100005761015c600480803590602001908201803590602001908080601f0160208091040260200160405190810160405280939291908181526020018383808284375094965061057f95505050505050565b60408051600160a060020a039092168252519081900360200190f35b34610000576100da60043560243561066a565b60408051918252519081900360200190f35b34610000576102566106b4565b60408051602080825283518183015283519192839290830191850190808383821561029c575b80518252602083111561029c57601f19909201916020918201910161027c565b505050905090810190601f1680156102c85780820380516001836020036101000a031916815260200191505b509250505060405180910390f35b6040805188815260208101889052808201879052606081018690526080810185905260a0810184905260c0810183905290517f22884df0d5b5279f371d4e62c09a39d8949263624148338cf7101a35c9dfa82e9181900360e00190a15b50505050505050565b600061034883836106f9565b6040805182815290519192507f93b88a2969f23d4db3228f80ab79d8665fe82fb014f430e92fa8b9bbb6247cac919081900360200190a15b92915050565b6040805188815260208101889052808201879052606081018690526080810185905260a0810184905260c0810183905290517fdd184b3e7a312e9f821669373834128810cdded53b1eadbdb699e8c9e78a55849181900360e00190a15b50505050505050565b604080518381526020810183905281517f128f9becc8bee8161d289ec19f2f13730dfcb614e03f81c17623d186241849be929181900390910190a15b5050565b604080518381526020810183905281517f128f9becc8bee8161d289ec19f2f13730dfcb614e03f81c17623d186241849be929181900390910190a15b5050565b604080518381526020810183905281517f128f9becc8bee8161d289ec19f2f13730dfcb614e03f81c17623d186241849be929181900390910190a15b5050565b60006104ed604060405190810160405280601281526020017f636f6d2e74722e6f7261636c652e6d61696e000000000000000000000000000081525061057f565b90505b90565b604080518381526020810183905281517f4d92bae7a66a63f8707f63c99d43ff45132be5c5fb0ced21d061041b3a2f2ddb929181900390910190a15b5050565b6000610540848484610777565b6040805182815290519192507f04f4809a2498e814c9d8b482ab9781e5c8ba5933a69e97ad53835118110cfb28919081900360200190a15b9392505050565b6000805460408051602090810184905290517fdc5acb9000000000000000000000000000000000000000000000000000000000815260048101828152855160248301528551600160a060020a039094169363dc5acb909387938392604490910191850190808383821561060d575b80518252602083111561060d57601f1990920191602091820191016105ed565b505050905090810190601f1680156106395780820380516001836020036101000a031916815260200191505b5092505050602060405180830381600087803b156100005760325a03f115610000575050604051519150505b919050565b60006106768383610810565b6040805182815290519192507fe554cce36fbdeba6fb46d90d34f96262fd4a0775aa7d0f5d081264a6c2d0654f919081900360200190a15b92915050565b604080516020818101835260009091528151808301909252601582527f636f6d2e62396c61622e6f7261636c652e746573740000000000000000000000908201525b90565b60006107036104ac565b600160a060020a03166315226e1484846000604051602001526040518363ffffffff1660e060020a02815260040180836000191660001916815260200182815260200192505050602060405180830381600087803b156100005760325a03f115610000575050604051519150505b92915050565b60006107816104ac565b604080516000602091820181905282517fa0cf91f50000000000000000000000000000000000000000000000000000000081526004810189905260248101889052604481018790529251600160a060020a03949094169363a0cf91f59360648082019493918390030190829087803b156100005760325a03f115610000575050604051519150505b9392505050565b600061081a6104ac565b600160a060020a031663d185e2cd84846000604051602001526040518363ffffffff1660e060020a02815260040180836000191660001916815260200182815260200192505050602060405180830381600087803b156100005760325a03f115610000575050604051519150505b929150505600a165627a7a72305820f543e242c2d2a9ca68d58f665bf4f96bdea912afd37e9a9cce4ae22e51caa8b30029",
    "events": {
      "0x68385462c45956b3bd1196a090705283c21cb02a3a231b1e0957fa5113252b53": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "requestId",
            "type": "uint256"
          }
        ],
        "name": "BlockOneOracleClientTest_onOracleResponse",
        "type": "event"
      },
      "0x128f9becc8bee8161d289ec19f2f13730dfcb614e03f81c17623d186241849be": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "requestId",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "reason",
            "type": "uint256"
          }
        ],
        "name": "BlockOneOracleClientTest_onOracleFailure",
        "type": "event"
      },
      "0x93b88a2969f23d4db3228f80ab79d8665fe82fb014f430e92fa8b9bbb6247cac": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "requestId",
            "type": "uint256"
          }
        ],
        "name": "BlockOneOracleClientTest_requested_IntraDay",
        "type": "event"
      },
      "0x22884df0d5b5279f371d4e62c09a39d8949263624148338cf7101a35c9dfa82e": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "requestId",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "timestamp",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "symbol",
            "type": "bytes32"
          },
          {
            "indexed": false,
            "name": "price",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "bid",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "ask",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "volume",
            "type": "uint256"
          }
        ],
        "name": "BlockOneOracleClientTest_respond_IntraDay",
        "type": "event"
      },
      "0xe554cce36fbdeba6fb46d90d34f96262fd4a0775aa7d0f5d081264a6c2d0654f": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "requestId",
            "type": "uint256"
          }
        ],
        "name": "BlockOneOracleClientTest_requested_EndOfDay",
        "type": "event"
      },
      "0xdd184b3e7a312e9f821669373834128810cdded53b1eadbdb699e8c9e78a5584": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "requestId",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "timestamp",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "symbol",
            "type": "bytes32"
          },
          {
            "indexed": false,
            "name": "price",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "bid",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "ask",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "volume",
            "type": "uint256"
          }
        ],
        "name": "BlockOneOracleClientTest_respond_EndOfDay",
        "type": "event"
      },
      "0x04f4809a2498e814c9d8b482ab9781e5c8ba5933a69e97ad53835118110cfb28": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "requestId",
            "type": "uint256"
          }
        ],
        "name": "BlockOneOracleClientTest_requested_EntityConnect",
        "type": "event"
      },
      "0x4d92bae7a66a63f8707f63c99d43ff45132be5c5fb0ced21d061041b3a2f2ddb": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "requestId",
            "type": "uint256"
          },
          {
<<<<<<< Updated upstream
=======
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
        "constant": false,
        "inputs": [
          {
            "name": "symbol",
            "type": "bytes32"
          },
          {
            "name": "timestamp",
            "type": "uint256"
          }
        ],
        "name": "request_EndOfDay",
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
            "indexed": false,
            "name": "requestId",
            "type": "uint256"
          }
        ],
        "name": "BlockOneOracleClientTest_onOracleResponse",
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
            "name": "reason",
            "type": "uint256"
          }
        ],
        "name": "BlockOneOracleClientTest_onOracleFailure",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "requestId",
            "type": "uint256"
          }
        ],
        "name": "BlockOneOracleClientTest_requested_IntraDay",
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
            "name": "timestamp",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "symbol",
            "type": "bytes32"
          },
          {
            "indexed": false,
            "name": "price",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "bid",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "ask",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "volume",
            "type": "uint256"
          }
        ],
        "name": "BlockOneOracleClientTest_respond_IntraDay",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "requestId",
            "type": "uint256"
          }
        ],
        "name": "BlockOneOracleClientTest_requested_EndOfDay",
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
            "name": "timestamp",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "symbol",
            "type": "bytes32"
          },
          {
            "indexed": false,
            "name": "price",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "bid",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "ask",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "volume",
            "type": "uint256"
          }
        ],
        "name": "BlockOneOracleClientTest_respond_EndOfDay",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "requestId",
            "type": "uint256"
          }
        ],
        "name": "BlockOneOracleClientTest_requested_EntityConnect",
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
            "name": "connections",
            "type": "uint256"
          }
        ],
        "name": "BlockOneOracleClientTest_respond_EntityConnect",
        "type": "event"
      }
    ],
    "unlinked_binary": "0x6060604052346100005760405160208061085d83398101604052515b805b805b600160a060020a038116151561003457610000565b60008054600160a060020a031916600160a060020a0383161790555b5060018054600160a060020a03191633600160a060020a03161790555b505b505b6107dd806100806000396000f300606060405236156100935763ffffffff60e060020a6000350416630c514026811461009857806315226e14146100bc57806317a96e5e146100e157806320b08482146101055780636fda1150146101055780637c6a595114610105578063833b1fce1461014457806383d04ed41461016d578063a0cf91f514610182578063cbaaa3ac146101aa578063d185e2cd14610219575b610000565b34610000576100ba60043560243560443560643560843560a43560c43561023e565b005b34610000576100cf6004356024356102a4565b60408051918252519081900360200190f35b34610000576100ba60043560243560443560643560843560a43560c4356102ee565b005b34610000576100ba600435602435610354565b005b34610000576100ba600435602435610354565b005b34610000576100ba600435602435610354565b005b3461000057610151610414565b60408051600160a060020a039092168252519081900360200190f35b34610000576100ba60043560243561045b565b005b34610000576100cf60043560243560443561049b565b60408051918252519081900360200190f35b3461000057610151600480803590602001908201803590602001908080601f016020809104026020016040519081016040528093929190818152602001838380828437509496506104e795505050505050565b60408051600160a060020a039092168252519081900360200190f35b34610000576100cf6004356024356105d2565b60408051918252519081900360200190f35b6040805188815260208101889052808201879052606081018690526080810185905260a0810184905260c0810183905290517f22884df0d5b5279f371d4e62c09a39d8949263624148338cf7101a35c9dfa82e9181900360e00190a15b50505050505050565b60006102b0838361061c565b6040805182815290519192507f93b88a2969f23d4db3228f80ab79d8665fe82fb014f430e92fa8b9bbb6247cac919081900360200190a15b92915050565b6040805188815260208101889052808201879052606081018690526080810185905260a0810184905260c0810183905290517fdd184b3e7a312e9f821669373834128810cdded53b1eadbdb699e8c9e78a55849181900360e00190a15b50505050505050565b604080518381526020810183905281517f128f9becc8bee8161d289ec19f2f13730dfcb614e03f81c17623d186241849be929181900390910190a15b5050565b604080518381526020810183905281517f128f9becc8bee8161d289ec19f2f13730dfcb614e03f81c17623d186241849be929181900390910190a15b5050565b604080518381526020810183905281517f128f9becc8bee8161d289ec19f2f13730dfcb614e03f81c17623d186241849be929181900390910190a15b5050565b6000610455604060405190810160405280601281526020017f636f6d2e74722e6f7261636c652e6d61696e00000000000000000000000000008152506104e7565b90505b90565b604080518381526020810183905281517f4d92bae7a66a63f8707f63c99d43ff45132be5c5fb0ced21d061041b3a2f2ddb929181900390910190a15b5050565b60006104a884848461069a565b6040805182815290519192507f04f4809a2498e814c9d8b482ab9781e5c8ba5933a69e97ad53835118110cfb28919081900360200190a15b9392505050565b6000805460408051602090810184905290517fdc5acb9000000000000000000000000000000000000000000000000000000000815260048101828152855160248301528551600160a060020a039094169363dc5acb9093879383926044909101918501908083838215610575575b80518252602083111561057557601f199092019160209182019101610555565b505050905090810190601f1680156105a15780820380516001836020036101000a031916815260200191505b5092505050602060405180830381600087803b156100005760325a03f115610000575050604051519150505b919050565b60006105de8383610733565b6040805182815290519192507fe554cce36fbdeba6fb46d90d34f96262fd4a0775aa7d0f5d081264a6c2d0654f919081900360200190a15b92915050565b6000610626610414565b600160a060020a03166315226e1484846000604051602001526040518363ffffffff1660e060020a02815260040180836000191660001916815260200182815260200192505050602060405180830381600087803b156100005760325a03f115610000575050604051519150505b92915050565b60006106a4610414565b604080516000602091820181905282517fa0cf91f50000000000000000000000000000000000000000000000000000000081526004810189905260248101889052604481018790529251600160a060020a03949094169363a0cf91f59360648082019493918390030190829087803b156100005760325a03f115610000575050604051519150505b9392505050565b600061073d610414565b600160a060020a031663d185e2cd84846000604051602001526040518363ffffffff1660e060020a02815260040180836000191660001916815260200182815260200192505050602060405180830381600087803b156100005760325a03f115610000575050604051519150505b929150505600a165627a7a72305820570d17bdd71d80f5e8fede1f2283af139e288d26ec826696abe5376f4f6d8a730029",
    "events": {
      "0x68385462c45956b3bd1196a090705283c21cb02a3a231b1e0957fa5113252b53": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "requestId",
            "type": "uint256"
          }
        ],
        "name": "BlockOneOracleClientTest_onOracleResponse",
        "type": "event"
      },
      "0x128f9becc8bee8161d289ec19f2f13730dfcb614e03f81c17623d186241849be": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "requestId",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "reason",
            "type": "uint256"
          }
        ],
        "name": "BlockOneOracleClientTest_onOracleFailure",
        "type": "event"
      },
      "0x22884df0d5b5279f371d4e62c09a39d8949263624148338cf7101a35c9dfa82e": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "requestId",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "timestamp",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "symbol",
            "type": "bytes32"
          },
          {
            "indexed": false,
            "name": "price",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "bid",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "ask",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "volume",
            "type": "uint256"
          }
        ],
        "name": "BlockOneOracleClientTest_respond_IntraDay",
        "type": "event"
      },
      "0xdd184b3e7a312e9f821669373834128810cdded53b1eadbdb699e8c9e78a5584": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "requestId",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "timestamp",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "symbol",
            "type": "bytes32"
          },
          {
            "indexed": false,
            "name": "price",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "bid",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "ask",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "volume",
            "type": "uint256"
          }
        ],
        "name": "BlockOneOracleClientTest_respond_EndOfDay",
        "type": "event"
      },
      "0x4d92bae7a66a63f8707f63c99d43ff45132be5c5fb0ced21d061041b3a2f2ddb": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "requestId",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "connections",
            "type": "uint256"
          }
        ],
        "name": "BlockOneOracleClientTest_respond_EntityConnect",
        "type": "event"
      }
    },
    "updated_at": 1485628537305,
    "address": "0xbc2afb10a399b35d1fd490d801323b989ef53355",
    "links": {}
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

  Contract.contract_name   = Contract.prototype.contract_name   = "BlockOneOracleClientTest";
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
    window.BlockOneOracleClientTest = Contract;
  }
})();
