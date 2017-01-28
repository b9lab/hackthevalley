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
      throw new Error("RicUri error: Please call setProvider() first before calling new().");
    }

    var args = Array.prototype.slice.call(arguments);

    if (!this.unlinked_binary) {
      throw new Error("RicUri error: contract binary not set. Can't deploy new instance.");
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

      throw new Error("RicUri contains unresolved libraries. You must deploy and link the following libraries before you can deploy a new version of RicUri: " + unlinked_libraries);
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
      throw new Error("Invalid address passed to RicUri.at(): " + address);
    }

    var contract_class = this.web3.eth.contract(this.abi);
    var contract = contract_class.at(address);

    return new this(contract);
  };

  Contract.deployed = function() {
    if (!this.address) {
      throw new Error("Cannot find deployed address: RicUri not deployed or address not set.");
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
            "name": "ric",
            "type": "string"
          }
        ],
        "name": "setRic",
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
            "name": "companyUri",
            "type": "string"
          }
        ],
        "name": "setCompanyUri",
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
            "name": "uri",
            "type": "string"
          }
        ],
        "name": "setUri",
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
            "type": "address"
          }
        ],
        "name": "infos",
        "outputs": [
          {
            "name": "ric",
            "type": "string"
          },
          {
            "name": "uri",
            "type": "string"
          },
          {
            "name": "companyRic",
            "type": "string"
          },
          {
            "name": "companyUri",
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
            "name": "companyRic",
            "type": "string"
          }
        ],
        "name": "setCompanyRic",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "payable": false,
        "type": "function"
      }
    ],
    "unlinked_binary": "0x606060405234610000575b61075b806100196000396000f300606060405263ffffffff60e060020a60003504166334d1854981146100505780638c080313146100b75780639b642de11461011e578063c6ddb64214610185578063f2666ae314610398575b610000565b34610000576100a3600480803590602001908201803590602001908080601f016020809104026020016040519081016040528093929190818152602001838380828437509496506103ff95505050505050565b604080519115158252519081900360200190f35b34610000576100a3600480803590602001908201803590602001908080601f016020809104026020016040519081016040528093929190818152602001838380828437509496506104ba95505050505050565b604080519115158252519081900360200190f35b34610000576100a3600480803590602001908201803590602001908080601f0160208091040260200160405190810160405280939291908181526020018383808284375094965061058895505050505050565b604080519115158252519081900360200190f35b346100005761019e600160a060020a0360043516610656565b604080516080808252865460026000196101006001841615020190911604908201819052909182916020830191830190606084019060a08501908a9080156102275780601f106101fc57610100808354040283529160200191610227565b820191906000526020600020905b81548152906001019060200180831161020a57829003601f168201915b505085810384528854600260001961010060018416150201909116048082526020909101908990801561029b5780601f106102705761010080835404028352916020019161029b565b820191906000526020600020905b81548152906001019060200180831161027e57829003601f168201915b505085810383528754600260001961010060018416150201909116048082526020909101908890801561030f5780601f106102e45761010080835404028352916020019161030f565b820191906000526020600020905b8154815290600101906020018083116102f257829003601f168201915b50508581038252865460026000196101006001841615020190911604808252602090910190879080156103835780601f1061035857610100808354040283529160200191610383565b820191906000526020600020905b81548152906001019060200180831161036657829003601f168201915b50509850505050505050505060405180910390f35b34610000576100a3600480803590602001908201803590602001908080601f0160208091040260200160405190810160405280939291908181526020018383808284375094965061067395505050505050565b604080519115158252519081900360200190f35b600160a060020a0333166000908152602081815260408220835181548285528385209293601f600260001961010060018616150201909316929092048201819004840193919087019083901061046057805160ff191683800117855561048d565b8280016001018555821561048d579182015b8281111561048d578251825591602001919060010190610472565b5b506104ae9291505b808211156104aa5760008155600101610496565b5090565b5050600190505b919050565b6000816000600033600160a060020a0316600160a060020a031681526020019081526020016000206003019080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061046057805160ff191683800117855561048d565b8280016001018555821561048d579182015b8281111561048d578251825591602001919060010190610472565b5b506104ae9291505b808211156104aa5760008155600101610496565b5090565b5050600190505b919050565b6000816000600033600160a060020a0316600160a060020a031681526020019081526020016000206001019080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061046057805160ff191683800117855561048d565b8280016001018555821561048d579182015b8281111561048d578251825591602001919060010190610472565b5b506104ae9291505b808211156104aa5760008155600101610496565b5090565b5050600190505b919050565b600060208190529081526040902060018101600282016003830184565b600160a060020a03331660009081526020818152604082208351600291820180548186528486209194601f6000196101006001851615020190921694909404810184900482019387019083901061046057805160ff191683800117855561048d565b8280016001018555821561048d579182015b8281111561048d578251825591602001919060010190610472565b5b506104ae9291505b808211156104aa5760008155600101610496565b5090565b5050600190505b9190505600a165627a7a72305820f762552ac3ae55b7a64d904f26e6ae7e6c93869b81cd3d1e3c908855d356a08f0029",
    "events": {},
    "updated_at": 1485621262227,
    "address": "0x1f623db7dd92e303388f32fe8ed9406ccec4a902",
    "links": {}
  },
  "default": {
    "abi": [
      {
        "constant": false,
        "inputs": [
          {
            "name": "ric",
            "type": "string"
          }
        ],
        "name": "setRic",
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
            "name": "companyUri",
            "type": "string"
          }
        ],
        "name": "setCompanyUri",
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
            "name": "uri",
            "type": "string"
          }
        ],
        "name": "setUri",
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
            "type": "address"
          }
        ],
        "name": "infos",
        "outputs": [
          {
            "name": "ric",
            "type": "string"
          },
          {
            "name": "uri",
            "type": "string"
          },
          {
            "name": "companyRic",
            "type": "string"
          },
          {
            "name": "companyUri",
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
            "name": "companyRic",
            "type": "string"
          }
        ],
        "name": "setCompanyRic",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "payable": false,
        "type": "function"
      }
    ],
    "unlinked_binary": "0x606060405234610000575b61075b806100196000396000f300606060405263ffffffff60e060020a60003504166334d1854981146100505780638c080313146100b75780639b642de11461011e578063c6ddb64214610185578063f2666ae314610398575b610000565b34610000576100a3600480803590602001908201803590602001908080601f016020809104026020016040519081016040528093929190818152602001838380828437509496506103ff95505050505050565b604080519115158252519081900360200190f35b34610000576100a3600480803590602001908201803590602001908080601f016020809104026020016040519081016040528093929190818152602001838380828437509496506104ba95505050505050565b604080519115158252519081900360200190f35b34610000576100a3600480803590602001908201803590602001908080601f0160208091040260200160405190810160405280939291908181526020018383808284375094965061058895505050505050565b604080519115158252519081900360200190f35b346100005761019e600160a060020a0360043516610656565b604080516080808252865460026000196101006001841615020190911604908201819052909182916020830191830190606084019060a08501908a9080156102275780601f106101fc57610100808354040283529160200191610227565b820191906000526020600020905b81548152906001019060200180831161020a57829003601f168201915b505085810384528854600260001961010060018416150201909116048082526020909101908990801561029b5780601f106102705761010080835404028352916020019161029b565b820191906000526020600020905b81548152906001019060200180831161027e57829003601f168201915b505085810383528754600260001961010060018416150201909116048082526020909101908890801561030f5780601f106102e45761010080835404028352916020019161030f565b820191906000526020600020905b8154815290600101906020018083116102f257829003601f168201915b50508581038252865460026000196101006001841615020190911604808252602090910190879080156103835780601f1061035857610100808354040283529160200191610383565b820191906000526020600020905b81548152906001019060200180831161036657829003601f168201915b50509850505050505050505060405180910390f35b34610000576100a3600480803590602001908201803590602001908080601f0160208091040260200160405190810160405280939291908181526020018383808284375094965061067395505050505050565b604080519115158252519081900360200190f35b600160a060020a0333166000908152602081815260408220835181548285528385209293601f600260001961010060018616150201909316929092048201819004840193919087019083901061046057805160ff191683800117855561048d565b8280016001018555821561048d579182015b8281111561048d578251825591602001919060010190610472565b5b506104ae9291505b808211156104aa5760008155600101610496565b5090565b5050600190505b919050565b6000816000600033600160a060020a0316600160a060020a031681526020019081526020016000206003019080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061046057805160ff191683800117855561048d565b8280016001018555821561048d579182015b8281111561048d578251825591602001919060010190610472565b5b506104ae9291505b808211156104aa5760008155600101610496565b5090565b5050600190505b919050565b6000816000600033600160a060020a0316600160a060020a031681526020019081526020016000206001019080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061046057805160ff191683800117855561048d565b8280016001018555821561048d579182015b8281111561048d578251825591602001919060010190610472565b5b506104ae9291505b808211156104aa5760008155600101610496565b5090565b5050600190505b919050565b600060208190529081526040902060018101600282016003830184565b600160a060020a03331660009081526020818152604082208351600291820180548186528486209194601f6000196101006001851615020190921694909404810184900482019387019083901061046057805160ff191683800117855561048d565b8280016001018555821561048d579182015b8281111561048d578251825591602001919060010190610472565b5b506104ae9291505b808211156104aa5760008155600101610496565b5090565b5050600190505b9190505600a165627a7a723058207b7e0858c7e0d273aa6380b3b2f6f6a9ebd33969a73ca86ea9d8d3f020eaed2d0029",
    "events": {},
    "updated_at": 1485628537337,
    "links": {},
    "address": "0x678ccc3efda316b4f8ea21c9e59d90dea2ec264f"
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

  Contract.contract_name   = Contract.prototype.contract_name   = "RicUri";
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
    window.RicUri = Contract;
  }
})();
