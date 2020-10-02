const { describe } = require('riteway')
const buildTransaction = require('./buildTransaction')

describe('buildTransaction', async assert => {
    const actions = [{
        account: "token.seeds",
        name: "transfer",
        authorization: [{
            actor: "sevenflash42",
            permission: "active"
        }
        ],
        data: {
            from: "sevenflash42",
            to: "igorberlenko",
            quantity: "7.0000 SEEDS",
            memo: ""
        }
    }]

    assert({
        given: 'conversation',
        should: 'build transaction',
        actual: typeof (await buildTransaction(actions)),
        expected: 'string'
    })
})