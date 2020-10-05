const fastify = require('fastify')({ logger: true })
fastify.register(require("fastify-blipp"));

const buildTransaction = require('./buildTransaction')
const buildQrCode = require('./buildQrCode')

fastify.post('/qr', async (request, reply) => {
    const actions = request.body.actions

    const esr = await buildTransaction(actions)

    const qr = await buildQrCode(esr)
    
    return {
        esr, qr
    }
})

fastify.get('/invoice', async (request, reply) => {

    if (!request.query.to) {
        throw Error("to needs to be defined")
    }
    if (!request.query.quantity) {
        throw Error("quantity needs to be defined")
    }
    if (!request.query.memo) {
        throw Error("memo needs to be defined")
    }

    var quantity = parseFloat(request.query.quantity).toFixed(4) + " SEEDS"

    const actions = [{
        account: "token.seeds",
        name: "transfer",
        authorization: [{
            actor:"............1",
            permission: "............2"
        }
        ],
        data: {
            from:"............1",
            "to": request.query.to,
            "quantity": quantity,
            memo: request.query.memo
        }
    }]

    const esr = await buildTransaction(actions)

    const qr = await buildQrCode(esr)
    
    return {
        esr, qr
    }
})

const start = async () => {
    try {
        await fastify.listen(3000) 
    } catch (err) {
        fastify.log.error(err)
        process.exit(1)
    }
}

start()