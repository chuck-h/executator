## Executator service

A backend service to execute a sequence of eosio transactions. 

The service maintains a table of pending tasks. As long as any tasks are pending, it polls the blockchain to determine whether a task is able to run.

The service is called with a contract/permission and a /csv string/json array/? of transaction parameters. The service generates a fresh ephemeral key pair, and creates a new entry in the pending task table. It returns a transaction which will install the new public key at the specified contract/permission. This transaction must be signed and published in order to enable the task.

A task is able to run when its ephemeral public key is seen as installed on-chain at the specified contract/permission. If so, the service processes each line of the csv string in order. The first field in each line is an action of the given contract (which must be authorized by the given permission). Subsequent fields are the parameters for that action. For each line the service publishes a corresponding transaction to the chain (signed by the ephemeral private key), and records the return receipt (including success or failure).

After completing the task, the service publishes a transaction to the chain which removes the public key from the contract/permission, restoring the original authorization list. It polls the chain to confirm success, then purges the ephemeral private key from its local storage. The completed task data is written to a file.


## Installation

```
mkdir images
npm install
```
In a PM2 environment
```
pm2 start index.js
```
Alternatively (?)
```
npm run start
```

## API

```/maketask``` 

send contract/permission and transaction list; returns action to install ephemeral key and start task

```/qr``` 

send 'actions' json in the body to get the esr and QR code

## Tools 

### eosio.to
Shows QR codes for ESR encoded requests

Example:
https://eosio.to/gmNgYmAoCOJiniNoxLDsl571kgUTGRkZEGDFWyMjDpgAkAYA

### greymass URL builder
https://greymass.github.io/eosio-uri-builder/

This creates an ESR encoded string, which can then be looked at in eosio.to, which also shows the QR code.

