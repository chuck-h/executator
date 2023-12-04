const fastify = require('fastify')({ logger: true })
fastify.register(require("fastify-blipp"));
const path = require('path')
const ecc = require('eosjs-ecc')

const { buildTransaction, setNode, get_rpc } = require('./buildTransaction')
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
    rpc = get_rpc();
    var task = {};
    task.private_key = await ecc.randomKey(); // note: no enclave here
    task.public_key = ecc.privateToPublic(task.private_key);
    task.contract = request.body.contract;
    task.permission = request.body.permission;
    task.trx_list = request.body.trx_list;
    task_list.push( {
      expires: Date.now() + (request.body.lifetime ?? default_task_lifetime_sec*1000),
      task: task
    });
    task.status = "created";
    
    console.log(JSON.stringify(task_list));
    
    // Build authorization change transaction
    const account_data = await rpc.get_account(task.contract);
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
        account: task.contract,
        permission: task.permission,
        parent: account_permission.parent,
        auth: new_auth
      },
      authorization: [{actor: task.contract, permission: task.permission}]
    }]

    // test
    const esr = await buildTransaction(actions);
    console.log(esr);
    
    return actions;
})

async function task_key_present(task) {
  const account_data = await rpc.get_account(task.contract);
  const task_auth = account_data.permissions.find(function(row){return row.perm_name==task.permission;});
  return task_auth.keys.includes(task.public_key);
}

const poll_cycle_msec = 10000;
async function poll_tasks() {
  // infinite loop checking and executing tasks
  while (true) {
     await new Promise(r => setTimeout(r, poll_cycle_msec));
     if (len(task_list) == 0) {
       break;
     }
     for (var task of task_list) {
       // TODO check whether task is expired
       if (task.expires < Date.now()) {
         // write task to completed file
         // delete task from task_list
       }
       if ( task.status == "created" && await task_key_present(task) ) {
         // update task.expires (?)
         task.failed_trx = 0;
         for (var row of task.trx_list) {
           if ( row.succeeded ) {
             continue;
           }
           // TODO: handle failure/retry modes
           // TODO build transaction
           // Sign transaction with task.private_key
           // Publish transaction
           // check return value (error?)
           // update status in trx_list row
           // update task.failed_trx count
         }
         // build transaction to remove ephemeral key authorization
         // sign transaction with task.private_key
         // publish transaction
         // check return value (error?)
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
            //poll_tasks
        ])
    } catch (err) {
        fastify.log.error(err)
        process.exit(1)
    }
}

start()
