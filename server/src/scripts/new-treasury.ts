import { KeyPair } from '@nimiq/core'

// `npm run treasury:new -- gift` makes the gift escrow key instead.
const gift = process.argv.includes('gift')
const keyPair = KeyPair.generate()
console.log(`${gift ? 'NIMIQ_GIFT_PRIVATE_KEY' : 'NIMIQ_TREASURY_PRIVATE_KEY'}=${keyPair.privateKey.toHex()}`)
console.log(`# Address: ${keyPair.toAddress().toUserFriendlyAddress()}`)
console.log(`# Store the private key in a secrets manager and back it up. Anyone with it controls the ${gift ? 'gift escrow' : 'treasury'}.`)
