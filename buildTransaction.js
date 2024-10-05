const { JsonRpc, Api, Serialize } = require('eosjs')
const { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig')

const fetch = require('node-fetch')
const util = require('util')
const zlib = require('zlib')

const { SigningRequest } = require("eosio-signing-request")

const textEncoder = new util.TextEncoder()
const textDecoder = new util.TextDecoder()

var rpc
var eos
var opts

var keyProvider = []
function setKeyProvider(kp) {
    keyProvider = kp
    const signatureProvider = new JsSignatureProvider(keyProvider)
    eos = new Api({
        rpc,
        signatureProvider,
        textDecoder,
        textEncoder,
    })
}
  
function setNode(node) {
    rpc = new JsonRpc(node, {
        fetch
    })

    const signatureProvider = new JsSignatureProvider(keyProvider)
    eos = new Api({
        rpc,
        signatureProvider,
        textDecoder,
        textEncoder,
    })

    opts = {
        textEncoder,
        textDecoder,
        zlib: {
            deflateRaw: (data) => new Uint8Array(zlib.deflateRawSync(Buffer.from(data))),
            inflateRaw: (data) => new Uint8Array(zlib.inflateRawSync(Buffer.from(data))),
        },
        abiProvider: {
            getAbi: async (account) => (await eos.getAbi(account))
        }
    } 
}

// TODO make a buildActionList which uses the list-of-actions esr form
//  This will make a non-expiring esr/QR code

async function buildTransaction(actions) {
    if (typeof(rpc) == 'undefined') {
        return null;
    }
    const info = await rpc.get_info();
    const head_block = await rpc.get_block(info.last_irreversible_block_num);
    const chainId = info.chain_id;
    // set to an hour from now.
    const expiration = Serialize.timePointSecToDate(Serialize.dateToTimePointSec(head_block.timestamp) + 3600)
    const transaction = {
        expiration,
        ref_block_num: head_block.block_num & 0xffff, // 
        ref_block_prefix: head_block.ref_block_prefix,
        max_net_usage_words: 0,
        delay_sec: 0,
        context_free_actions: [],
        actions: actions,
        transaction_extensions: [],
        signatures: [],
        context_free_data: []
    };
    const request = await SigningRequest.create({ transaction, chainId }, opts);
    const uri = request.encode();
    return uri
}

async function sendTransactionWith(actions, keys, numRetries = 1, broadcast = true) {
    const signatureProvider = new JsSignatureProvider(keys)
    eos = new Api({
        rpc,
        signatureProvider,
        textDecoder,
        textEncoder,
    })

    let result
    while (numRetries-- >= 0) {
      try {
        if (broadcast) {
          result = await eos.transact(
              {actions: actions},
              {
                  blocksBehind: 3,
                  expireSeconds: 30,
                  broadcast: broadcast,
                  requiredKeys: requiredKeys,
              }
          )
        } else {
            const info = await rpc.get_info();
            transaction = {actions: actions}; 
            const refBlock = await rpc.get_block(info.head_block_num - 3); // blocksBehind = 3
            transaction = { ...Serialize.transactionHeader(refBlock, 3540), ...transaction }; // expire 59 mins
            const abis = await eos.getTransactionAbis(transaction);
            transaction = { ...transaction, actions: await eos.serializeActions(transaction.actions) };
            const serializedTransaction = eos.serializeTransaction(transaction);
            let PushTransactionArgs  = { serializedTransaction, signatures: [] };
            requiredKeys = await signatureProvider.getAvailableKeys();
            pushTransactionArgs = await signatureProvider.sign({
              chainId: info.chain_id,
              requiredKeys,
              serializedTransaction,
              abis,
            });
            transaction.signatures = pushTransactionArgs.signatures;
            result = transaction;
        }
        break;
      } catch (err) {
          const errStr = '' + err;
          if (errStr.toLowerCase().includes('executing for too long') ||
              errStr.toLowerCase().includes('exceeded by')) {
              console.error(errStr, ', retrying...')
              await sleep(100)
              continue
          } else {
            result = {processed: {error: err}};
            break;
          }
      }
    } // while num_retries
    return result;
} // function sendTransactionWith

function getRpc() {
  return rpc;
}

module.exports = { buildTransaction, setNode, getRpc, setKeyProvider, sendTransactionWith }
