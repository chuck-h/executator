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

async function sendTransactionWith(actions, keys) {
    const signatureProvider = new JsSignatureProvider(keys)
    eos = new Api({
        rpc,
        signatureProvider,
        textDecoder,
        textEncoder,
    })
    return await eos.transact(
        {actions: actions},
        {
            blocksBehind: 3,
            expireSeconds: 30,
        }
    )
}

function getRpc() {
  return rpc;
}

module.exports = { buildTransaction, setNode, getRpc, setKeyProvider, sendTransactionWith }
