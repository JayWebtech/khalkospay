import { KeyPair } from '@nimiq/core'

const keyPair = KeyPair.generate()
console.log(`NIMIQ_TREASURY_PRIVATE_KEY=${keyPair.privateKey.toHex()}`)
console.log(`# Address: ${keyPair.toAddress().toUserFriendlyAddress()}`)
console.log('# Store the private key in a secrets manager and back it up. Anyone with it controls the treasury.')
