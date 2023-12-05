## Executator service

A backend service to execute a "script" sequence of eosio transactions on behalf on an account. The account holder's key does not need to be shared with the service back-end; the entire script is authorized by a single transaction signed by the account holder.

The service maintains a table of pending tasks. As long as any tasks are pending, it polls the blockchain to determine whether a task is able to run.

The service is called with an account/permission and json array of transactions. (Alternatively the service accepts a csv-formatted string, which it converts into a javascript array.) The service generates a fresh ephemeral key pair, and creates a new entry in the pending task table. It returns an `updateauth` transaction which will install the new public key at the specified account/permission; this allows the service to impersonate the account holder. The `updateauth` transaction must be signed and published in order to enable the task.

A task is able to run when its ephemeral public key is seen as installed on-chain at the specified account/permission. If so, the service processes each element of the javascript array in order. For each array element the service publishes a corresponding transaction to the chain (signed by the ephemeral private key), and records the return receipt (including success or failure).

After completing the task, the service publishes a transaction to the chain which removes the public key from the account/permission, restoring the original authorization list. It polls the chain to confirm success, then purges the ephemeral private key from its local storage. The completed task data is written to a file.

Single-action transactions can be expressed as a csv file (spreadhseet format)
![image](https://github.com/chuck-h/executator/assets/2141014/998ad129-df29-4a08-a9ff-72ed8207711c)

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

