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

const start = async () => {
    try {
        await fastify.listen(3000) 
    } catch (err) {
        fastify.log.error(err)
        process.exit(1)
    }
}

start()