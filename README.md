## Encode transaction service

A backend service to encode EOS/Telos actions into ESR standard QR codes. 

ESR = EOSIO Signing Request, a standard to encode EOSIO transactions/actions as binary URLs

'''
esr://bdaz4f.... 
'''

QR code is then just a repr

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

```/qr``` for telos mainnet
```/qrt``` for telos testnet


send 'actions' json in the body to get the QR code


## Tools 

### eosio.to
Shows QR codes for ESR encoded requests

Example:
https://eosio.to/gmNgYmAoCOJiniNoxLDsl571kgUTGRkZEGDFWyMjDpgAkAYA

### greymass URL builder
https://greymass.github.io/eosio-uri-builder/

This creates an ESR encoded string, which can then be looked at in eosio.to, which also shows the QR code.

