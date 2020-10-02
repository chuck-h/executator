const QRCode = require('qrcode')
const md5 = require('md5')

async function buildQrCode(esr) {
    const filename = md5(esr)
    const filepath = `images/${filename}.png`

    try {
        await QRCode.toFile(filepath, esr)
        return filepath
    } catch (err) {
        console.error(err)
        return null
    }
}

module.exports = buildQrCode