const fastify = require('fastify')({ logger: true })
fastify.register(require("fastify-blipp"));
const path = require('path')

const { buildTransaction, setNode } = require('./buildTransaction')
const buildQrCode = require('./buildQrCode')
const buildHusdAction = require('./buildHusdAction')

fastify.register(require('fastify-static'), {
    root: path.join(__dirname, 'images'),
    prefix: '/images/', // optional: default '/'
  })

fastify.register(require('point-of-view'), {
    engine: {
        ejs: require('handlebars')
    }
})

fastify.get('/buy-seeds', async (request, reply) => {
    let params = {}
    
    if (request.query.quantity) {
        const quantity = parseFloat(request.query.quantity).toFixed(2) + " HUSD"
    
        const actions = [buildHusdAction({
            quantity: quantity
        })]
    
        const esr = await buildTransaction(actions)
    
        const qrPath = await buildQrCode(esr)
    
        const qr = request.protocol + "://" + request.hostname + "/" + qrPath
    
        console.log(qr)

        params = {
            quantity: quantity,
            qr: qr
        }
    }

    return reply.view('/templates/index.html', params)
})

fastify.get('/buyseeds', async (request, reply) => {
    if (!request.query.quantity) {
        throw Error("quantity needs to be defined")
    }
    
    const actions = [buildHusdAction({
        quantity: request.query.quantity,
        memo: request.query.memo
    })]

    const esr = await buildTransaction(actions)

    const qrPath = await buildQrCode(esr)
    
    const qr = "https://" + request.hostname + "/" + qrPath

    return {
        esr, qr
    }
})

fastify.post('/qr', async (request, reply) => {
    const actions = request.body.actions

    setNode('https://node.hypha.earth')
    
    const esr = await buildTransaction(actions)

    const qrPath = await buildQrCode(esr)
    
    const qr = "https://" + request.hostname + "/" + qrPath

    return {
        esr, qr
    }
})

fastify.post('/qrt', async (request, reply) => {
    const actions = request.body.actions
    
    setNode('https://testnet.telos.caleos.io')
    
    const esr = await buildTransaction(actions)

    const qrPath = await buildQrCode(esr)
    
    const qr = "https://" + request.hostname + "/" + qrPath

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

    let tokenContract = request.query.tokenContract || "token.seeds"
    let digits = request.query.digitsPrecision || 4
    let symbol = request.query.tokenSymbol || "SEEDS"
    var quantity = parseFloat(request.query.quantity).toFixed(digits) + " " + symbol

    const actions = [{
        account: tokenContract,
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

    const qrPath = await buildQrCode(esr)
    
    const qr = "https://" + request.hostname + "/" + qrPath

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
