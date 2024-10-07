const fastify = require('fastify')({ logger: true })
fastify.register(require("fastify-blipp"));
const path = require('path')
const {ecc, key_utils, PrivateKey, sha256} = require('eosjs-ecc')
const CSV = require('csv-string')
const fs = require('node:fs/promises');

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
// 5. refresh obfuscator with new random bytes when new task arrives to empty task_list queue

var obfuscator;


var task_list = [];
var restore_actions = [];
var restore_expires = Date.now();
const default_task_lifetime_sec = 60;


fastify.post('/maketask', async (request, reply) => {

    // TODO: validate input
    setNode(request.body.endpoint ?? 'https://mainnet.telos.net');
    rpc = getRpc();
    // convert csv (if present) to list of transaction objects
    var trx_list = [];
    var hashme; 
    if (request.body.trx_csv) {
      hashme = request.body.trx_csv;
      trx_list = await list_from_csv(request.body.trx_csv);
    }  else if (request.body.trx_file) {
      try {
        filedata = await fs.readFile(request.body.trx_file, { encoding: 'utf8'});
        hashme = filedata; // may need raw file data buffer, not utf-8 string?
        trx_list = await list_from_csv(filedata);
      } catch(err) {
        return {error: err.toString()};
      }
    }
    var task = {};
    await key_utils.addEntropy(...key_utils.cpuEntropy())
    if (task_list.length == 0) {
      obfuscator ^= await key_utils.random32ByteBuffer();
    }
    task.private_key = (await key_utils.random32ByteBuffer()).map((b,i) => b ^ obfuscator[i]);
    task.public_key = PrivateKey.fromBuffer(task.private_key.map((b,i) => b ^ obfuscator[i]))
      .toPublic().toString();
    task.account = request.body.account;
    task.permission = request.body.permission;
    task.outfile = request.body.outfile ?? "executout.txt";
    var nude_trx_list = request.body.trx_list ?? trx_list;

    if (request.body.hash) {
      // TODO verify hash on hashme variable
      console.log(`---hash ${sha256(hashme)}`);
      throw {name: "NotImplementedError", message: "hash verification not implemented"};
    }
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
    //console.log(JSON.stringify(task_list));
    
    // Build authorization change transaction
    const account_data = await rpc.get_account(task.account);
    const account_permission = account_data.permissions.find(row => row.perm_name==task.permission);
    const task_auth = JSON.parse(JSON.stringify(account_permission.required_auth));
    console.log(JSON.stringify(task_auth));
    // TODO test permission exists
    task_auth.keys.push( { key: task.public_key,
      weight: task_auth.threshold
    });
    // sort may fail on webauth corner cases https://github.com/wharfkit/antelope/issues/8
    task_auth.keys.sort((a, b) => String(a.key).localeCompare(String(b.key))); 

    const actions = [{
      account: "eosio",
      name: "updateauth",
      data: {
        account: task.account,
        permission: task.permission,
        parent: account_permission.parent,
        auth: task_auth
      },
      authorization: [{actor: task.account, permission: task.permission}]
    }]
    
    const esr = await buildTransaction(actions);
    console.log('\n------------- task launch transaction ---------------\n'
      +`\n${esr}\n`);
    const qrPath = await buildQrCode(esr);
    const qr = "http://" + request.hostname + "/" + qrPath;
    console.log(`${qr}`);
    
    // build a recovery transaction here and display signed cleos tx
    //  (This will remove the ephemeral auth in case service fails)
    restore_actions =  [{
      account: "eosio",
      name: "updateauth",
      data: {
        account: task.account,
        permission: task.permission,
        parent: account_permission.parent,
        auth: account_permission.required_auth,
      },
      authorization: [{actor: task.account, permission: task.permission}]
    }]
    // Sign restore transaction with task.private_key but don't broadcast
    const signed_restore = await sendTransactionWith(restore_actions,
      [PrivateKey.fromBuffer(task.private_key.map((b,i) => b ^ obfuscator[i])).toString()], 1, false);
    console.log(`\n----signed restore tx valid until ${Date(Date.now()+ 59*60*1000)} ----\n\n`
      +`cleos -u https://mainnet.telos.net push transaction -s  '${JSON.stringify(signed_restore)}'\n`
      +`\n--------------------------------------------------\n`);
    restore_expires = Date.now() + 45*60*1000; // 45 minutes in msec
    
    return actions;
})

async function list_from_csv(csv_text) {
  trx_list = []
  var parsed = CSV.parse(csv_text);
  //console.log(`parsed CSV: ${JSON.stringify(parsed)}`);
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
  return trx_list;
}

async function task_key_present(task) {
    const rpc = getRpc();
    const account_data = await rpc.get_account(task.account);
    const account_permission = account_data.permissions.find(row => row.perm_name==task.permission);
    const task_auth = account_permission.required_auth;
    return task_auth.keys.find(k => k.key == task.public_key) != undefined;
}

const poll_cycle_msec = 5000;
var task = null;
async function poll_tasks() {
  // infinite loop checking and executing tasks
  while (true) {
    await new Promise(r => setTimeout(r, poll_cycle_msec));
    if (task_list.length == 0) { // maybe replace with while (task_list.length != 0) ?
      continue;
    }
    task_list = task_list.filter((t) => t.task.status != "complete");
    console.log(`polling, ${task_list.length} tasks in queue\n`);
    //console.log(`polling\n${JSON.stringify(task_list)}\n`);
    for (var task_item of task_list) {
      task = task_item.task;
      if (task_item.expires < Date.now() && task.status != "complete") {
        console.log("task expired");
        if (task.status != "pending auth reset") {
          task.status = "processed";
        }
      }
      if ( task.status == "created" && await task_key_present(task) ) {
        task.status = "running";
        // update task.expires (?)
        task.retries = 0;
        // TODO loop on task-level retries
        task.failed_trx = 0;
        for (let [index, row] of task.trx_list.entries()) {  //(var row of task.trx_list) {
          console.log(`---- row ${index+1} of ${task.trx_list.length} (${task.failed_trx} failed) -----`);
          console.log(`trx_list row: ${JSON.stringify(row)}`);
          if ( row.succeeded ) {
            continue;
          }
          // TODO: handle failure/retry modes

          const actions = row.trx.actions.map( (action) => { return {
            authorization: [{actor: task.account, permission: task.permission}],
            ...action
          }})
          
          console.log(`transaction: ${JSON.stringify(actions)}`);
          // test
          const esr = await buildTransaction(actions);
          console.log(`processing trx: ${esr}\n`);
          // Sign transaction with task.private_key & publish
          const result = await sendTransactionWith(actions,
            [PrivateKey.fromBuffer(task.private_key.map((b,i) => b ^ obfuscator[i])).toString()], 2);
          //console.log(JSON.stringify(result));
          if (result.processed.error != null) {
            task.failed_trx++;
            row.failed_attempts++;
            console.log(`while processing trx: ${
              result.processed.error}`);
          } else {
            row.succeeded = true;
            console.log('... succeeded.\n');
          }
          // check whether we need to refresh key restoration transaction
          if (restore_expires < Date.now()) {
            const signed_restore = await sendTransactionWith(restore_actions,
              [PrivateKey.fromBuffer(task.private_key.map((b,i) => b ^ obfuscator[i])).toString()], 1, false);
            console.log(`\n----signed restore tx valid until ${Date(Date.now()+ 59*60*1000)} ----\n\n`
                +`cleos -u https://mainnet.telos.net push transaction -s  '${JSON.stringify(signed_restore)}'\n`
                +`\n--------------------------------------------------\n`);
             restore_expires = Date.now() + 45*60*1000; // 45 minutes in msec         
          }
        }
        task.status = "processed"; // after success or retry-timeout
      }
      if (task.status == "processed" ) {
        // build transaction to remove ephemeral key authorization
        // sign & publish transaction with task.private_key 
        const result = await sendTransactionWith(restore_actions,
          [PrivateKey.fromBuffer(task.private_key.map((b,i) => b ^ obfuscator[i])).toString()]);
        //console.log(JSON.stringify(result));
        if (result.processed.error != null) {
          console.log(`while removing ephemeral key authority: ${
            result.processed.error}`);
        }
      task.status = "pending auth reset";
      }
      if (task.status == "pending auth reset" && !(await task_key_present(task))) {
        task.status = "complete";
        console.log('task completed');
        // write task to completed file
        delete task.private_key;
        await fs.writeFile(task.outfile, JSON.stringify(task)+"\n", { flag: 'a' }, err => {
          if (err) {
            console.error(err);
          }
        })
      }   
    } //  for task of task_list
  } // while true
} // function poll_tasks
         
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
        // TODO write out task file for record of completed/failed tx
        if (task && task.status != "complete") {
          try {
            await fs.writeFile(task.outfile, JSON.stringify(task)+"\n", { flag: 'a' });
          } catch (err) {
            console.error(err);
          }
          // remove key from auth
          const result = await sendTransactionWith(restore_actions,
            [PrivateKey.fromBuffer(task.private_key.map((b,i) => b ^ obfuscator[i])).toString()]);
          if (result.processed.error != null) {
            console.log('\n**** key removal failed. ****');
          }
        }
        process.exit(1)
    }
}

start()
