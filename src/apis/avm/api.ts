/**
 * @module AVMAPI
 */
import SlopesCore from '../../slopes';
import { Buffer } from "buffer/";
import { JRPCAPI, RequestResponseData, Defaults } from "../../utils/types";
import { UTXOSet } from './utxos';
import { MergeRule, UnixNow, AVMConstants, InitialStates } from './types';
import { AVMKeyChain } from './keychain';
import { TxUnsigned, Tx, TxCreateAsset } from './tx';
import BN from "bn.js";
import BinTools from '../../utils/bintools';

/**
 * @ignore
 */
const bintools = BinTools.getInstance();

/**
 * A class for defining the persistance behavior of this an API call.
 * 
 */
export class PersistanceOptions {
    protected name:string = undefined;
    protected overwrite:boolean = false;
    protected mergeRule:MergeRule = "union";

    /**
     * Returns the namespace of the instance
     */
    getName = ():string => {
        return this.name;
    }

    /**
     * Returns the overwrite rule of the instance
     */
    getOverwrite = ():boolean => {
        return this.overwrite;
    }

    /**
     * Returns the [[MergeRule]] of the instance
     */
    getMergeRule = ():MergeRule => {
        return this.mergeRule;
    }
    
    /**
     * 
     * @param name The namespace of the database the data
     * @param overwrite True if the data should be completey overwritten
     * @param MergeRule The type of process used to merge with existing data: "intersection", "differenceSelf", "differenceNew", "symDifference", "union", "unionMinusNew", "unionMinusSelf"
     * 
     * @remarks
     * The merge rules are as follows:
     *   * "intersection" - the intersection of the set
     *   * "differenceSelf" - the difference between the existing data and new set
     *   * "differenceNew" - the difference between the new data and the existing set
     *   * "symDifference" - the union of the differences between both sets of data
     *   * "union" - the unique set of all elements contained in both sets
     *   * "unionMinusNew" - the unique set of all elements contained in both sets, excluding values only found in the new set
     *   * "unionMinusSelf" - the unique set of all elements contained in both sets, excluding values only found in the existing set
     */
    constructor(name:string, overwrite:boolean = false, mergeRule:MergeRule) {
        this.name = name;
        this.overwrite = overwrite;
        this.mergeRule = mergeRule;
    }
}

/**
 * Class for interacting with a node endpoint that is using the AVM.
 * 
 * @category RPCAPIs
 * 
 * @remarks This extends the [[JRPCAPI]] class. This class should not be directly called. Instead, use the [[Slopes.addAPI]] function to register this interface with Slopes.
 */ 
class AVMAPI extends JRPCAPI{

    /**
     * @ignore
     */
    protected keychain:AVMKeyChain = new AVMKeyChain("");
    protected blockchainID:string = "";
    protected AVAAssetID:Buffer = undefined;

    /**
     * Gets the alias for the blockchainID if it exists, otherwise returns `undefined`.
     * 
     * @returns The alias for the blockchainID
     */
    getBlockchainAlias = ():string => {
        let netid:number = this.core.getNetworkID();
        if(netid in Defaults.network && this.blockchainID in Defaults.network[netid]){
            return Defaults.network[netid][this.blockchainID].alias;
        }
        /* istanbul ignore next */
        return undefined;
    }

    /**
     * Gets the blockchainID and returns it.
     * 
     * @returns The blockchainID
     */
    getBlockchainID = ():string => {
        return this.blockchainID;
    }

    /**
     * Takes an address string and returns its {@link https://github.com/feross/buffer|Buffer} representation if valid. 
     * 
     * @returns A {@link https://github.com/feross/buffer|Buffer} for the address if valid, undefined if not valid.
     */
    parseAddress = (addr:string):Buffer => {
        let alias:string = this.getBlockchainAlias();
        let blockchainID:string = this.getBlockchainID();
        return bintools.parseAddress(addr, blockchainID, alias, AVMConstants.ADDRESSLENGTH);
    }

    addressFromBuffer = (address:Buffer):string => {
        let chainid:string = this.getBlockchainAlias() ? this.getBlockchainAlias() : this.getBlockchainID();
        return bintools.addressToString(chainid, address);
    }

    /**
     * Fetches the AVA AssetID and returns it in a Promise.
     * 
     * @returns The the provided string representing the blockchainID
     */
    getAVAAssetID = async ():Promise<Buffer> => {
        if(typeof this.AVAAssetID === 'undefined'){
            let asset:object = await this.getAssetDescription("AVA");
            this.AVAAssetID = asset["assetID"];
        }
        return this.AVAAssetID;
    }

    /**
     * Gets a reference to the keychain for this class.
     * 
     * @returns The instance of [[AVMKeyChain]] for this class
     */
    keyChain = ():AVMKeyChain => {
        return this.keychain;
    }

    /**
     * @ignore
     */
    newKeyChain = ():AVMKeyChain => {
        //warning, overwrites the old keychain
        let alias = this.getBlockchainAlias();
        if(alias){
            this.keychain = new AVMKeyChain(alias);
        } else {
            this.keychain = new AVMKeyChain(this.blockchainID);
        }
        return this.keychain;
    }

    /**
     * Gets the balance of a particular asset on a blockchain.
     * 
     * @param address The address to pull the asset balance from
     * @param assetID The assetID to pull the balance from
     * 
     * @returns Promise with the balance of the assetID as a {@link https://github.com/indutny/bn.js/|BN} on the provided address for the blockchain.
     */
    getBalance = async (address:string, assetID:string):Promise<BN> => {
        if(typeof this.parseAddress(address) === "undefined"){
            /* istanbul ignore next */
            throw new Error("Error - AVMAPI.getBalance: Invalid address format " + address);
        }
        let params = {
            "address": address, 
            "assetID": assetID
        };
        return this.callMethod("avm.getBalance", params).then((response:RequestResponseData) => {
            return  new BN(response.data["result"]["balance"], 10);
        });
    }


    /**
     * Creates an address (and associated private keys) on a user on a blockchain.
     * 
     * @param username Name of the user to create the address under
     * @param password Password to unlock the user and encrypt the private key
     * 
     * @returns Promise for a string representing the address created by the vm.
     */
    createAddress = async (username:string, password:string):Promise<string> => {
        let params = {
            "username": username,
            "password": password
        };
        return this.callMethod("avm.createAddress", params).then((response:RequestResponseData) => {
            return response.data["result"]["address"];
        });
    }

    /**
     * Create a new fixed-cap, fungible asset. A quantity of it is created at initialization and there no more is ever created.
     * 
     * @param username The user paying the transaction fee (in $AVA) for asset creation
     * @param password The password for the user paying the transaction fee (in $AVA) for asset creation
     * @param name The human-readable name for the asset
     * @param symbol Optional. The shorthand symbol for the asset. Between 0 and 4 characters
     * @param initialHolders An array of objects containing the field "address" and "amount" to establish the genesis values for the new asset
     * 
     * ```js
     * Example initialHolders:
     * [
     *     {
     *         "address": "X-7sik3Pr6r1FeLrvK1oWwECBS8iJ5VPuSh",
     *         "amount": 10000
     *     },
     *     {
     *         "address": "X-7sik3Pr6r1FeLrvK1oWwECBS8iJ5VPuSh",
     *         "amount": 50000
     *     }
     * ]
     * ```
     * 
     * @returns Returns a Promise<string> containing the base 58 string representation of the ID of the newly created asset.
     */
    createFixedCapAsset = async (username:string, password:string, name:string, symbol:string, initialHolders:Array<object>):Promise<string> => {
        let params = {
            "name": name,
            "symbol": symbol,
            "username": username,
            "password": password,
            "initialHolders": initialHolders
        };
        return this.callMethod("avm.createFixedCapAsset", params).then((response:RequestResponseData) => {
            return response.data["result"]["assetID"];
        });
    }

    /**
     * Create a new variable-cap, fungible asset. No units of the asset exist at initialization. Minters can mint units of this asset using createMintTx, signMintTx and sendMintTx.
     * 
     * @param username The user paying the transaction fee (in $AVA) for asset creation
     * @param password The password for the user paying the transaction fee (in $AVA) for asset creation
     * @param name The human-readable name for the asset
     * @param symbol Optional. The shorthand symbol for the asset -- between 0 and 4 characters
     * @param minterSets  is a list where each element specifies that threshold of the addresses in minters may together mint more of the asset by signing a minting transaction
     * 
     * ```js
     * Example minterSets:
     * [
     *      {
     *          "minters":[
     *              "X-4peJsFvhdn7XjhNF4HWAQy6YaJts27s9q"
     *          ],
     *          "threshold": 1
     *      },
     *      {
     *          "minters": [
     *              "X-dcJ6z9duLfyQTgbjq2wBCowkvcPZHVDF",
     *              "X-2fE6iibqfERz5wenXE6qyvinsxDvFhHZk",
     *              "X-7ieAJbfrGQbpNZRAQEpZCC1Gs1z5gz4HU"
     *          ],
     *          "threshold": 2
     *      }
     * ]
     * ```
     * 
     * @returns Returns a Promise<string> containing the base 58 string representation of the ID of the newly created asset.
     */
    createVariableCapAsset = async (username:string, password:string, name:string, symbol:string, minterSets:Array<object>):Promise<string> => {
        let params = {
            "name": name,
            "symbol": symbol,
            "username": username,
            "password": password,
            "minterSets": minterSets
        };
        return this.callMethod("avm.createVariableCapAsset", params).then((response:RequestResponseData) => {
            return response.data["result"]["assetID"];
        });
    }

    /**
     * Create an unsigned transaction to mint more of an asset.
     * 
     * @param amount The units of the asset to mint
     * @param assetID The ID of the asset to mint 
     * @param to The address to assign the units of the minted asset
     * @param minters Addresses of the minters responsible for signing the transaction
     * 
     * @returns Returns a Promise<string> containing the base 58 string representation of the unsigned transaction.
     */
    createMintTx = async (amount:number | BN, assetID:Buffer | string, to:string, minters:Array<string>):Promise<string> => {
        let asset:string;
        let amnt:BN;
        if(typeof assetID !== "string"){
            asset = bintools.avaSerialize(assetID);
        } else {
            asset = assetID;
        }
        if(typeof amount === 'number'){
            amnt = new BN(amount);
        } else {
            amnt = amount;
        }
        let params = {
            "amount": amnt.toString(10),
            "assetID": asset,
            "to": to,
            "minters": minters
        };
        return this.callMethod("avm.createMintTx", params).then((response:RequestResponseData) => {
            return response.data["result"]["tx"];
        });
    }

    /**
     * Sign an unsigned or partially signed mint transaction.
     * 
     * @param username The user signing
     * @param password The password for the user signing
     * @param tx The output of createMintTx or signMintTx
     * @param minter The minter signing this transaction 
     * 
     * @returns Returns a Promise<string> containing the base 58 string representation of the unsigned transaction.
     */
    signMintTx = async (username:string, password:string, tx:string | Buffer, minter:string):Promise<string> => {
        if(typeof this.parseAddress(minter) === "undefined"){
            /* istanbul ignore next */
            throw new Error("Error - AVMAPI.signMintTx: Invalid address format " + minter);
        }
        let params = {
            "username": username,
            "password": password,
            "tx": tx,
            "minter": minter
        };
        return this.callMethod("avm.signMintTx", params).then((response:RequestResponseData) => {
            return response.data["result"]["tx"];
        });
    }

    /**
     * Exports the private key for an address.
     * 
     * @param username The name of the user with the private key
     * @param password The password used to decrypt the private key
     * @param address The address whose private key should be exported
     * 
     * @returns Promise with the decrypted private key as store in the database
     */
    exportKey = async (username:string, password:string, address:string):Promise<string> => {
        if(typeof this.parseAddress(address) === "undefined"){
            /* istanbul ignore next */
            throw new Error("Error - AVMAPI.exportKey: Invalid address format " + address);
        }
        let params = {
            "username": username,
            "password": password,
            "address": address
        };
        return this.callMethod("avm.exportKey", params).then((response:RequestResponseData) => {
            return response.data["result"]["privateKey"];
        });
    }

    /**
     * Imports a private key into the node's keystore under an user and for a blockchain.
     * 
     * @param username The name of the user to store the private key
     * @param password The password that unlocks the user
     * @param privateKey A string representing the private key in the vm's format
     * 
     * @returns The address for the imported private key.
     */
    importKey = async (username:string, password:string, privateKey:string):Promise<string> => {
        let params = {
            "username": username,
            "password": password,
            "privateKey": privateKey
        };
        return this.callMethod("avm.importKey", params).then((response:RequestResponseData) => {
            return response.data["result"]["address"];
        });
    }

    /**
     * Lists all the addresses under a user.
     * 
     * @param username The user to list addresses
     * @param password The password of the user to list the addresses
     * 
     * @returns Promise of an array of address strings in the format specified by the blockchain.
     */
    listAddresses = async (username:string, password:string): Promise<Array<string>> => {
        let params = {
            "username": username,
            "password": password
        };
        return this.callMethod("avm.listAddresses", params).then((response:RequestResponseData) => {
            return response.data["result"]["addresses"];
        });
    }

    /**
     * Retrieves all assets for an address on a server and their associated balances.
     * 
     * @param address The address to get a list of assets
     * 
     * @returns Promise of an object mapping assetID strings with {@link https://github.com/indutny/bn.js/|BN} balance for the address on the blockchain.
     */
    getAllBalances = async (address:string):Promise<object> => {
        if(typeof this.parseAddress(address) === "undefined"){
            /* istanbul ignore next */
            throw new Error("Error - AVMAPI.listAssets: Invalid address format " + address);
        }
        let params = {
            "address": address
        };
        return this.callMethod("avm.getAllBalances", params).then((response:RequestResponseData) => {
            let r = response.data["result"]["assets"];
            let assetIDs = Object.keys(r);
            for(let i = 0; i < assetIDs.length; i++){
                r[assetIDs[i]] = new BN(r[assetIDs[i]], 10);
            }
            return r;
        });
    }

    /**
     * Retrieves an assets name and symbol.
     * 
     * @param assetID Either a {@link https://github.com/feross/buffer|Buffer} or an AVA serialized string for the AssetID or its alias.
     * 
     * @returns Returns a Promise<object> with keys "name" and "symbol".
     */
    getAssetDescription = async(assetID:Buffer | string):Promise<{name:string;symbol:string;assetID:Buffer;denomination:number}> => {
        let asset:string;
        if(typeof assetID !== "string"){
            asset = bintools.avaSerialize(assetID);
        } else {
            asset = assetID;
        }
        let params = {
            "assetID": asset
        };
        return this.callMethod("avm.getAssetDescription", params).then((response:RequestResponseData) => {
            return {
                name: response.data["result"]["name"], 
                symbol: response.data["result"]["symbol"], 
                assetID: bintools.avaDeserialize(response.data["result"]["assetID"]), 
                denomination: parseInt(response.data["result"]["denomination"])
            };
        });
    }

    /**
     * Returns the status of a provided transaction ID by calling the node's `getTxStatus` method.
     * 
     * @param txid The string representation of the transaction ID
     * 
     * @returns Returns a Promise<string> containing the status retrieved from the node
     */
    getTxStatus = async (txid:string):Promise<string> => {
        let params = {
            "txID": txid
        };
        return this.callMethod("avm.getTxStatus", params).then((response:RequestResponseData) => {
            return response.data["result"]["status"];
        });
    }

    /**
     * Retrieves the UTXOs related to the addresses provided from the node's `getUTXOs` method.
     * 
     * @param addresses An array of addresses as strings or addresses as {@link https://github.com/feross/buffer|Buffer}s
     * @param persistOpts Options available to persist these UTXOs in local storage
     * 
     * @remarks 
     * persistOpts is optional and must be of type [[PersistanceOptions]]
     * 
     */
    getUTXOs = async (addresses:Array<string> | Array<Buffer>, persistOpts:PersistanceOptions = undefined ):Promise<UTXOSet> => {
        let addrs:Array<string> = this._cleanAddressArray(addresses, "getUTXOs");
        
        let params = {
            "addresses": addrs
        };
        return this.callMethod("avm.getUTXOs", params).then((response:RequestResponseData) => {
            let utxos:UTXOSet = new UTXOSet();
            let data = response.data["result"]["utxos"];
            if(persistOpts && typeof persistOpts === 'object'){
                if(this.db.has(persistOpts.getName())){
                    let selfArray:Array<string> = this.db.get(persistOpts.getName());
                    if(Array.isArray(selfArray)){
                        utxos.addArray(data);
                        let self:UTXOSet = new UTXOSet();
                        self.addArray(selfArray);
                        self.mergeByRule(utxos, persistOpts.getMergeRule())
                        data = self.getAllUTXOStrings();
                    }
                }
                this.db.set(persistOpts.getName(), data, persistOpts.getOverwrite());
            }
            utxos.addArray(data);
            return utxos;
        });
    }

    /**
     * Helper function which creates an unsigned transaction. For more granular control, you may create your own
     * [[TxUnsigned]] manually (with their corresponding [[Input]]s and [[Output]]s.
     * 
     * @param utxoset A set of UTXOs that the transaction is built on
     * @param amount The amount of AVA to be spent in $nAVA
     * @param toAddresses The addresses to send the funds
     * @param fromAddresses The addresses being used to send the funds from the UTXOs provided
     * @param changeAddresses The addresses that can spend the change remaining from the spent UTXOs
     * @param assetID The assetID of the value being sent
     * @param asOf The timestamp to verify the transaction against as a {@link https://github.com/indutny/bn.js/|BN}
     * @param locktime The locktime field created in the resulting outputs
     * @param threshold The number of signatures required to spend the funds in the resultant UTXO
     * 
     * @returns An unsigned transaction created from the passed in parameters.
     * 
     * @remarks
     * This helper exists because the endpoint API should be the primary point of entry for most functionality.
     */
    makeUnsignedTx = async (
        utxoset:UTXOSet, amount:BN, toAddresses:Array<string>, fromAddresses:Array<string>, 
        changeAddresses:Array<string>, assetID:Buffer | string = undefined, asOf:BN = UnixNow(), 
        locktime:BN = new BN(0), threshold:number = 1
    ):Promise<TxUnsigned> => {
        let to:Array<Buffer> = this._cleanAddressArray(toAddresses, "makeUnsignedTx").map(a => bintools.stringToAddress(a));;
        let from:Array<Buffer> = this._cleanAddressArray(fromAddresses, "makeUnsignedTx").map(a => bintools.stringToAddress(a));;
        let change:Array<Buffer> = this._cleanAddressArray(changeAddresses, "makeUnsignedTx").map(a => bintools.stringToAddress(a));;

        if(typeof assetID === "string"){
            assetID = bintools.avaDeserialize(assetID);
        } 

        return utxoset.makeUnsignedTx(
            this.core.getNetworkID(), bintools.avaDeserialize(this.blockchainID), 
            amount, to, from, change, 
            assetID, asOf, locktime, threshold
        );
    }

    
    /**
     * Creates an unsigned transaction. For more granular control, you may create your own
     * [[TxCreateAsset]] manually (with their corresponding [[Input]]s, [[Output]]s).
     * 
     * @param utxoset A set of UTXOs that the transaction is built on
     * @param fee The amount of AVA to be paid for fees, in $nAVA
     * @param creatorAddresses The addresses to send the fees
     * @param initialState The [[InitialStates]] that represent the intial state of a created asset
     * @param name String for the descriptive name of the asset
     * @param symbol String for the ticker symbol of the asset
     * @param denomination Optional number for the denomination which is 10^D. D must be >= 0 and <= 32. Ex: $1 AVA = 10^9 $nAVA
     * 
     * @returns An unsigned transaction created from the passed in parameters.
     * 
     */
    makeCreateAssetTx = async (
        utxoset:UTXOSet, fee:BN, creatorAddresses:Array<string> | Array<Buffer>, 
        initialState:InitialStates, name:string, 
        symbol:string, denomination:number
    ):Promise<TxCreateAsset> => {
        let creators:Array<Buffer> = this._cleanAddressArray(creatorAddresses, "makeCreateAssetTx").map(a => bintools.stringToAddress(a));
        /* istanbul ignore next */
        if(symbol.length > AVMConstants.SYMBOLMAXLEN){
            /* istanbul ignore next */
            throw new Error("Error - AVMAPI.makeCreateAssetTx: Symbols may not exceed length of " + AVMConstants.SYMBOLMAXLEN);
        }
        /* istanbul ignore next */
        if(name.length > AVMConstants.ASSETNAMELEN) {
            /* istanbul ignore next */
            throw new Error("Error - AVMAPI.makeCreateAssetTx: Names may not exceed length of " + AVMConstants.ASSETNAMELEN);
        }
        let avaAssetID:Buffer = await this.getAVAAssetID();
        return utxoset.makeCreateAssetTx(
            this.core.getNetworkID(), bintools.avaDeserialize(this.blockchainID), avaAssetID,
            fee, creators, initialState, name, symbol, denomination
        );
    }

    /**
     * Helper function which takes an unsigned transaction and signs it, returning the resulting [[Tx]].
     * 
     * @param utx The unsigned transaction of type [[TxUnsigned]]
     * 
     * @returns A signed transaction of type [[Tx]]
     */
    signTx = (utx:TxUnsigned):Tx => {
        return this.keychain.signTx(utx);
    }

    /**
     * Calls the node's issueTx method from the API and returns the resulting transaction ID as a string.
     * 
     * @param tx A string, {@link https://github.com/feross/buffer|Buffer}, or [[Tx]] representing a transaction
     * 
     * @returns A Promise<string> representing the transaction ID of the posted transaction.
     */
    issueTx = async (tx:string | Buffer | Tx):Promise<string> => {
        let Transaction = new Tx();
        if(typeof tx === 'string'){
            Transaction.fromString(tx);
        } else if(tx instanceof Buffer){
            Transaction.fromBuffer(tx);
        } else if(tx instanceof Tx) {
            Transaction = tx;
        } else {
            /* istanbul ignore next */
            throw new Error("Error - avm.issueTx: provided tx is not expected type of string, Buffer, or Tx");
        }
        let params = {
            "tx": Transaction.toString()
        };
        return this.callMethod("avm.issueTx", params).then((response:RequestResponseData) => {
            return response.data["result"]["txID"];
        });
    }

    /**
     * Sends an amount of assetID to the specified address from a list of owned of addresses.
     * 
     * @param username The user that owns the private keys associated with the `from` addresses
     * @param password The password unlocking the user
     * @param assetID The assetID of the asset to send
     * @param amount The amount of the asset to be sent
     * @param to The address of the recipient
     * @param from An array of addresses managed by the node's keystore for this blockchain which will fund this transaction
     * 
     * @returns Promise for the string representing the transaction's ID.
     */
    send = async (username:string, password:string, assetID:string | Buffer, amount:number | BN, to:string, from:Array<string> | Array<Buffer>):Promise<string> => {
        let asset:string;
        let amnt:BN;
        
        if(typeof this.parseAddress(to) === "undefined"){
            /* istanbul ignore next */
            throw new Error("Error - AVMAPI.listAssets: Invalid address format " + to);
        }

        from = this._cleanAddressArray(from, "send")

        if(typeof assetID !== "string"){
            asset = bintools.avaSerialize(assetID);
        } else {
            asset = assetID;
        }
        if(typeof amount === 'number'){
            amnt = new BN(amount);
        } else {
            amnt = amount;
        }

        let params = {
            "username": username,
            "password": password,
            "assetID": asset,
            "amount": amnt.toString(10),
            "to": to, 
            "from": from
        };
        return this.callMethod("avm.send", params).then((response:RequestResponseData) => {
            return response.data["result"]["txID"];
        });
    }

    /**
     * @ignore
     */
    protected _cleanAddressArray(addresses:Array<string> | Array<Buffer>, caller:string):Array<string> {
        let addrs:Array<string> = [];
        let chainid:string = this.getBlockchainAlias() ? this.getBlockchainAlias() : this.getBlockchainID();
        if(addresses && addresses.length > 0){
            for(let i = 0; i < addresses.length; i++){
                if(typeof addresses[i] === "string"){
                    if(typeof this.parseAddress(addresses[i] as string) === "undefined"){
                        /* istanbul ignore next */
                        throw new Error("Error - AVMAPI." + caller + ": Invalid address format " + addresses[i]);
                    }
                    addrs.push(addresses[i] as string);
                } else {
                    addrs.push(bintools.addressToString(chainid, addresses[i] as Buffer))
                }
            }
        }
        return addrs;
    }

    /**
     * This class should not be instantiated directly. Instead use the [[Slopes.addAPI]] method.
     * 
     * @param core A reference to the Slopes class
     * @param baseurl Defaults to the string "/ext/bc/avm" as the path to blockchain's baseurl
     */
    constructor(core:SlopesCore, baseurl:string = "/ext/bc/avm", blockchainID:string = ""){ 
        super(core, baseurl);
        this.blockchainID = blockchainID
        let netid:number = core.getNetworkID();
        if(netid in Defaults.network && blockchainID in Defaults.network[netid]){
            let alias = Defaults.network[netid][blockchainID].alias;
            this.keychain = new AVMKeyChain(alias);
        } else {
            this.keychain = new AVMKeyChain(blockchainID);
        }
    }
}

export default AVMAPI;