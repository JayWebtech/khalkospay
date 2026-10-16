import http from 'node:http'
import cors from 'cors'
import express, { ErrorRequestHandler } from 'express'
import { config } from './config'
import { HttpError } from './lib/http-error'
import { biteBuddyRouter } from './routes/bitebuddy'
import { giftCardsRouter } from './routes/giftcards'
import { offrampRouter } from './routes/offramp'
import { webhooksRouter } from './routes/webhooks'
import { startGiftCardWorker } from './services/giftcards'
import { canSendFromTreasury, treasuryAddress } from './services/nimiq'
import { startOfframpWorker } from './services/offramp'
import { startPetWorker } from './services/pets'
import { PaystackError } from './services/paystack'
import { attachVoiceServer } from './voice/session'

const isOriginAllowed = (origin: string | undefined) =>
  config.corsOrigins.length === 0 || (origin !== undefined && config.corsOrigins.includes(origin))

const app = express()

app.use(cors({ origin: config.corsOrigins.length ? config.corsOrigins : true }))
app.use('/api/webhooks', webhooksRouter)
app.use(express.json({ limit: '10mb' }))

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use('/api/offramp', offrampRouter)
app.use('/api/bitebuddy', biteBuddyRouter)
app.use('/api/giftcards', giftCardsRouter)

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ message: err.message, code: err.code })
    return
  }
  if (err instanceof PaystackError) {
    console.error('[paystack]', err.httpStatus, err.message)
    res.status(502).json({ message: 'Our bank partner is unavailable right now. Please try again shortly.', code: 'PAYSTACK_ERROR' })
    return
  }
  if (typeof err?.status === 'number' && err.status < 500) {
    res.status(err.status).json({ message: err.message, code: 'BAD_REQUEST' })
    return
  }
  console.error(err)
  res.status(500).json({ message: 'Something went wrong on our side', code: 'INTERNAL' })
}
app.use(errorHandler)

const server = http.createServer(app)
attachVoiceServer(server, isOriginAllowed)

server.listen(config.port, () => {
  console.log(`KhalkosPay server listening on :${config.port}`)
  console.log(`  Nimiq ${config.nimiq.network} via ${config.nimiq.rpcUrl || '(no RPC configured)'}`)
  console.log(`  Deposit address: ${treasuryAddress ?? 'NOT CONFIGURED'}${canSendFromTreasury ? ' (refunds automatic)' : ' (refunds manual)'}`)
  console.log(`  Paystack: ${config.paystackSecretKey ? 'configured' : 'NOT CONFIGURED'} · Deepgram: ${config.deepgramApiKey ? 'configured' : 'NOT CONFIGURED'}`)
})

startOfframpWorker()
startGiftCardWorker()
startPetWorker()
