const fastify = require('fastify')({ logger: true })
fastify.register(require("fastify-blipp"));
const path = require('path')
const {ecc, key_utils, PrivateKey} = require('eosjs-ecc')
const CSV = require('csv-string')
const fs = require('node:fs');

const { buildTransaction, setNode, getRpc, sendTransactionWith } = require('./buildTransaction')
const buildQrCode = require('./buildQrCode')

fastify.register(require('fastify-static'), {
    root: path.join(__dirname, 'images'),
    prefix: '/images/', // optional: default '/'
  })

fastify.post('/qr', async (request, reply) => {
    const actions = request.body.actions
    setNode(request.body.endpoint ?? 'https://mainnet.telos.net')
    const esr = await buildTransaction(actions)
    const qrPath = await buildQrCode(esr)
    const qr = "https://" + request.hostname + "/" + qrPath
    return {
        esr, qr
    }
})

// We obfuscate task.private_key
// 1. at startup, generate obfuscator as 32 random byte Buffer (key_utils.random32ByteBuffer())
// 2. when task.private_key is generated, get it as random32ByteBuffer
// 3. xor with obfuscator before saving to task.private_key
// 4. when private key is needed to generate public key or sign,
//     xor with obfuscator to get plaintext, then use PrivateKey(Buffer).toString() for wif
// TODO: consider refreshing obfuscator any time task_list is empty

var obfuscator;


var task_list = [];
const default_task_lifetime_sec = 60;

fastify.post('/maketask', async (request, reply) => {

    // TODO: validate input
    setNode(request.body.endpoint ?? 'https://mainnet.telos.net');
    rpc = getRpc();
    // convert csv (if present) to list of transaction objects
    // TODO refactor convert_csv as function
    var trx_list = [];
    if (request.body.trx_csv) {
      var parsed = CSV.parse(request.body.trx_csv);
      console.log(`parsed CSV: ${JSON.stringify(parsed)}`);
      var headers = parsed[0];
      // ignore columns left of contract, action headers
      var first_column = 0;
      for (; first_column < headers.length-1; ++first_column) {
        if (headers[first_column] == "contract" &&
            headers[first_column+1] == "action" ) {
          break;
        }
      }
      if (first_column == headers.length-1) {
        console.log(`could not find [contract, action] columns`);
      } else {
        headers = headers.slice(first_column);
        for (full_row of parsed.slice(1)) {
          const row = full_row.slice(first_column);
          var trx = {};
          if (row[0].length == 0) {
            trx = null;
            continue; // skip line if contract is blank
          }
          trx.account = row[0];
          trx.name = row[1];
          trx.data = {};
          for (var i = 2; i < row.length; ++i) {
            const field = row[i];
            const header = headers[i];
            if (field.length == 0 || header.length == 0) {
              continue;
            }
            trx.data[header] = field;
          }
          if (trx) {
            trx_list.push({trx: {actions: [trx]}});
          }
        }
      }
    }  
    var task = {};
    await key_utils.addEntropy(...key_utils.cpuEntropy())
    task.private_key = (await key_utils.random32ByteBuffer()).map((b,i) => b ^ obfuscator[i]);
    task.public_key = PrivateKey.fromBuffer(task.private_key.map((b,i) => b ^ obfuscator[i]))
      .toPublic().toString();
    task.account = request.body.account;
    task.permission = request.body.permission;
    task.outfile = request.body.outfile ?? "executout.txt";
    var nude_trx_list = request.body.trx_list ?? trx_list;
    task.trx_list = nude_trx_list.map( (e) => { return {
      succeeded: false,
      failed_attempts: 0,
      ...e
    }})
    task_list.push( {
      expires: Date.now() + (request.body.lifetime ?? default_task_lifetime_sec*1000),
      task: task
    });
    task.status = "created";
    console.log(JSON.stringify(task_list));
    
    // Build authorization change transaction
    const account_data = await rpc.get_account(task.account);
    const account_permission = account_data.permissions.find(row => row.perm_name==task.permission);
    const task_auth = account_permission.required_auth;
    console.log(JSON.stringify(task_auth));
    // TODO test permission exists
    var new_auth = {};
    new_auth.waits = task_auth.waits;
    new_auth.accounts = task_auth.accounts;
    new_auth.threshold = task_auth.threshold;
    new_auth.keys = task_auth.keys;
    new_auth.keys.push( { key: task.public_key,
      weight: new_auth.threshold
    });
    // sort may fail on webauth corner cases https://github.com/wharfkit/antelope/issues/8
    new_auth.keys.sort((a, b) => String(a.key).localeCompare(String(b.key))); 

    const actions = [{
      account: "eosio",
      name: "updateauth",
      data: {
        account: task.account,
        permission: task.permission,
        parent: account_permission.parent,
        auth: new_auth
      },
      authorization: [{actor: task.account, permission: task.permission}]
    }]

    // test
    const esr = await buildTransaction(actions);
    console.log(esr);

    // TODO build a recovery transaction here and display esr
    //  (This will remove the ephemeral auth in case service fails)    
    return actions;
})

async function task_key_present(task) {
    const rpc = getRpc();
    const account_data = await rpc.get_account(task.account);
    const account_permission = account_data.permissions.find(row => row.perm_name==task.permission);
    const task_auth = account_permission.required_auth;
    return task_auth.keys.find(k => k.key == task.public_key) != undefined;
}

const poll_cycle_msec = 5000;
async function poll_tasks() {
  // infinite loop checking and executing tasks
  while (true) {
    await new Promise(r => setTimeout(r, poll_cycle_msec));
    if (task_list.length == 0) { // maybe replace with while (task_list.length != 0) ?
      continue;
    }
    task_list = task_list.filter((t) => t.task.status != "complete");
    console.log(`polling\n${JSON.stringify(task_list)}\n`);
    for (var task_item of task_list) {
      var task = task_item.task;
      if (task_item.expires < Date.now() && task.status != "complete") {
        console.log("task expired");
        task.status = "processed";
      }
      if ( task.status == "created" && await task_key_present(task) ) {
        task.status = "running";
        // update task.expires (?)
        task.retries = 0;
        // TODO loop on task-level retries
        task.failed_trx = 0;
        for (var row of task.trx_list) {
          console.log(`trx_list row: ${JSON.stringify(row)}`);
          if ( row.succeeded ) {
            continue;
          }
          // TODO: handle failure/retry modes
          // TODO build transaction

          const actions = row.trx.actions.map( (action) => { return {
            authorization: [{actor: task.account, permission: task.permission}],
            ...action
          }})
          
          console.log(`transaction: ${JSON.stringify(actions)}`);
          // test
          const esr = await buildTransaction(actions);
          console.log(`processing trx: ${esr}`);
          
          // Sign transaction with task.private_key & publish
          const result = await sendTransactionWith(actions,
            [PrivateKey.fromBuffer(task.private_key.map((b,i) => b ^ obfuscator[i])).toString()]);
          console.log(JSON.stringify(result));
          if (result.processed.error != null) {
            task.failed_trx++;
            console.log(`while processing trx: ${
              result.processed.error}`);
          } else {
            row.succeeded = true;
          }
        }
        task.status = "processed"; // after success or retry-timeout
      }
      if (task.status == "processed" ) {
        // build transaction to remove ephemeral key authorization
        const account_data = await rpc.get_account(task.account);
        const account_permission = account_data.permissions.find(row => row.perm_name==task.permission);
        const task_auth = account_permission.required_auth;
        console.log(JSON.stringify(task_auth));
        var new_auth = {};
        new_auth.waits = task_auth.waits;
        new_auth.accounts = task_auth.accounts;
        new_auth.threshold = task_auth.threshold;
        new_auth.keys = task_auth.keys;
        const index = new_auth.keys.findIndex(k => k.key == task.public_key);
        if (index == -1) {
          console.log("processed state: no matching key to remove");
        } else {
          new_auth.keys.splice(index, 1)

          const actions = [{
            account: "eosio",
            name: "updateauth",
            data: {
              account: task.account,
              permission: task.permission,
              parent: account_permission.parent,
              auth: new_auth
            },
            authorization: [{actor: task.account, permission: task.permission}]
          }]

          // test
          const esr = await buildTransaction(actions);
          console.log(`removing key: ${esr}`);
    
          // sign & publish transaction with task.private_key 
          const result = await sendTransactionWith(actions,
            [PrivateKey.fromBuffer(task.private_key.map((b,i) => b ^ obfuscator[i])).toString()]);
          console.log(JSON.stringify(result));
          if (result.processed.error != null) {
            console.log(`while removing ephemeral key authority: ${
              result.processed.error}`);
          }
        }
        task.status = "pending auth reset";
      }
      if (task.status == "pending auth reset" && !(await task_key_present(task))) {
        task.status = "complete";
        // write task to completed file
        delete task.private_key;
        fs.writeFile(task.outfile, JSON.stringify(task)+"\n", { flag: 'a' }, err => {
          if (err) {
            console.error(err);
          }
        })
      }
    } //  for task of task_list
  } // while true
}
         
const start = async () => {
    try {
        await PrivateKey.initialize()
        obfuscator = await key_utils.random32ByteBuffer()
        await Promise.all([
            fastify.listen(3000),
            poll_tasks()
        ])
    } catch (err) {
        fastify.log.error(err)
        process.exit(1)
    }
}

start()
