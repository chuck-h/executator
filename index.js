const fastify = require('fastify')({ logger: true })
fastify.register(require("fastify-blipp"));
const path = require('path')
const ecc = require('eosjs-ecc')
const CSV = require('csv-string')

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

var task_list = [];
const default_task_lifetime_sec = 60;

fastify.post('/maketask', async (request, reply) => {

    // TODO: validate input
    setNode(request.body.endpoint ?? 'https://mainnet.telos.net');
    rpc = getRpc();
    // convert csv if present
    var trx_list = [];
    if (request.body.trx_csv) {
      var parsed = CSV.parse(request.body.trx_csv);
      console.log(`parsed CSV: ${JSON.stringify(parsed)}`);
      const headers = parsed[0];
      if (headers[0]!="contract" || headers[1]!="action") {
        console.log(`first columns should be [contract, action]`);
      } else {
        parsed.slice(1).forEach( (row) => {
          var trx = {};
          trx.contract = row[0];
          trx.name = row[1];
          for (var i = 2; i < row.length; ++i) {
            const field = row[i];
            const header = headers[i];
            if (field.length == 0) {
              continue;
            }
            trx[header] = field;
          }
        trx_list.push(trx);
        })
      }
    }  
    var task = {};
    task.private_key = await ecc.randomKey(); // note: no enclave here
    task.public_key = ecc.privateToPublic(task.private_key);
    task.account = request.body.account;
    task.permission = request.body.permission;
    task.trx_list = request.body.trx_list ?? trx_list;
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
    console.log(`polling\n${JSON.stringify(task_list)}\n`);
    for (var task_item of task_list) {
      // TODO check whether task is expired
      var task = task_item.task;
      if (task_item.expires < Date.now()) {
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
          console.log(`trx_list row: ${row}`);
          /*
          if ( row.succeeded ) {
            continue;
          }
          */
          // TODO: handle failure/retry modes
          // TODO build transaction
          // Sign transaction with task.private_key
          // Publish transaction
          // check return value (error?)
          // update status in trx_list row
          // update task.failed_trx count
        }
        task.status = "processed"; // after success or retry-timeout
      }
      if (task.status == "processed") {
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
          //console.log(esr);
    
          // sign & publish transaction with task.private_key 
          const result = await sendTransactionWith(actions, [task.private_key]);
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
        // delete task from task_list
      }
    } //  for task of task_list
  } // while true
}
         
const start = async () => {
    try {
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
