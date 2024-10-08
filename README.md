### Work in progress
## Executator service

A backend service to execute a "script" sequence of eosio transactions on behalf on an account. The account holder's key does not need to be shared with the service back-end; the entire script is initiated with a single transaction signed by the account holder.

The service maintains a table of pending *tasks*. (A task is a sequential list of transactions.) As long as any tasks are pending, the service polls the blockchain to determine whether a task has become able to run.

The service is called with an account/permission and json array of transactions. (Alternatively the service accepts a csv-formatted string, which it converts into a javascript array, or the filename of a csv file located on the service host.) The service generates a fresh ephemeral key pair, and creates a new entry in the pending task table. It returns an `updateauth` transaction which will install the new public key at the specified account/permission; this allows the service to impersonate the account holder. The `updateauth` transaction must be signed and published in order to enable the task.

A task is able to run when its ephemeral public key is seen as installed on-chain at the specified account/permission. If so, the service processes each element of the javascript array in order. For each array element the service publishes a corresponding transaction to the chain (signed by the ephemeral private key), and records the return receipt (including success or failure).

After completing the task, the service publishes a transaction to the chain which removes the public key from the account/permission, restoring the original authorization list. It polls the chain to confirm success, then purges the ephemeral private key from its local storage. The completed task data is written to a file.

A sequence of single-action transactions can be expressed as a csv file (spreadsheet format)
![image](https://github.com/chuck-h/executator/assets/2141014/998ad129-df29-4a08-a9ff-72ed8207711c)

A corresponding 4-step execution history (updateauth, script line 1, script line 2, updateauth), last tx at top:
![image](https://github.com/chuck-h/executator/assets/2141014/663a236f-6a79-4d3b-87f7-3df195c23ca9)

## Installation

```
mkdir images
npm install
```
In a PM2 environment
```
pm2 start index.js
```
Alternatively
```
npm run start
```

## API

### ```/maketask``` 

send account/permission and transaction list; returns action to install ephemeral key and start task, e.g.
<code>
curl -X 'POST'   'http://127.0.0.1:3000/maketask'   -H 'accept: application/json'   -H 'Content-Type: application/json'   -d '{"account":"chuckseattle", "permission":"active", "trx_csv":"contract,action,from,to,quantity,bogus,memo\ntoken.seeds,transfer,chuckseattle,coinsacct111,1.2345 SEEDS,,Executator 1\ntoken.seeds,transfer,chuckseattle,coinsacct111,5.4321 SEEDS,,Executator 2"}'
</code>
returns this action
<code>
[{"account":"eosio","name":"updateauth","data":{"account":"chuckseattle","permission":"active","parent":"owner","auth":{"waits":[],"accounts":[],"threshold":1,"keys":[{"key":"EOS6tLAFAnWetpFt6katwRpKXyH4iZdKEW6FLpfGbAcVorrfN7GU3","weight":1},{"key":"EOS7Rw15ogSFHYBdoRZ3Zx7hHehjgT6PTnAn6wnqfNGBEMj6FF1Z3","weight":1}]}},"authorization":[{"actor":"chuckseattle","permission":"active"}]}]
</code>

### ```/qr``` 

send 'actions' json in the body to get the esr and QR code, e.g.
<code>
curl -X 'POST'   'http://127.0.0.1:3000/qr'   -H 'accept: application/json'   -H 'Content-Type: application/json'   -d '{"endpoint":"https://mainnet.telos.net", "actions":[{"account":"eosio","name":"updateauth","data":{"account":"chuckseattle","permission":"active","parent":"owner","auth":{"waits":[],"accounts":[],"threshold":1,"keys":[{"key":"EOS6tLAFAnWetpFt6katwRpKXyH4iZdKEW6FLpfGbAcVorrfN7GU3","weight":1},{"key":"EOS7Rw15ogSFHYBdoRZ3Zx7hHehjgT6PTnAn6wnqfNGBEMj6FF1Z3","weight":1}]}},"authorization":[{"actor":"chuckseattle","permission":"active"}]}]}'
</code>
returns
<code>
{"esr":"esr://gmN0S9_Eeqy57zv_9xn9eU3hL_bxCbUs-jptJqsXY3-Jtawg04ZLeamPvlzXuOHIAASMIILhlUEog8PpWytygq4yLkg655bYUeIMEl_x1sgoHV0ARDesVlsO0srEwMzO4VzrWGHhNKv_4O9rr-9ULrH-GqlzJ2VhWGvAI5OSm_eAypj9Tsq0WcxpEGb9OmGl-d7DzsIPDt2N2ZLxZeXErJg9M3fLMkKdAgA","qr":"https://127.0.0.1:3000/images/a393f6e2f57d6684b424286eb8ef4104.png"}
</code>

## Blockchain compatibility

The service points `/maketask` and `/qr` accept a json endpoint property, e.g. `"endpoint":"https://mainnet.telos.net"`, which will be used for rpc access. The endpoint may serve any eosio/Antelope chain.

## Tools 

### eosio.to
Shows QR codes for ESR encoded requests

Example:
https://eosio.to/gmNgYmAoCOJiniNoxLDsl571kgUTGRkZEGDFWyMjDpgAkAYA

### greymass URL builder
https://greymass.github.io/eosio-uri-builder/

This creates an ESR encoded string, which can then be looked at in eosio.to, which also shows the QR code.

