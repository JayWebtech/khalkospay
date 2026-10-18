import http from 'node:http'
import cors from 'cors'
import express, { ErrorRequestHandler } from 'express'
import { config } from './config'
import { HttpError } from './lib/http-error'
import { adminEnabled, adminRouter } from './routes/admin'
import { authRouter } from './routes/auth'
import { biteBuddyRouter } from './routes/bitebuddy'
import { giftCardsRouter } from './routes/giftcards'
import { offrampRouter } from './routes/offramp'
import { onrampRouter } from './routes/onramp'
import { webhooksRouter } from './routes/webhooks'
import { startGiftCardWorker } from './services/giftcards'
import { canSendFromTreasury, checkRpcNetwork, giftEscrowAddress, treasuryAddress, WrongNetworkError } from './services/nimiq'
import { startOfframpWorker } from './services/offramp'
import { onrampEnabled, startOnrampWorker } from './services/onramp'
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

app.use('/api/auth', authRouter)
app.use('/api/offramp', offrampRouter)
app.use('/api/onramp', onrampRouter)
app.use('/api/bitebuddy', biteBuddyRouter)
app.use('/api/giftcards', giftCardsRouter)
app.use('/api/admin', adminRouter)

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ message: err.message, code: err.code })
    return
  }
  if (err instanceof WrongNetworkError) {
    res.status(503).json({ message: 'NIM payments are paused for maintenance. Please try again later.', code: 'NIMIQ_WRONG_NETWORK' })
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
  // The banner for a node on the wrong chain is logged by the check itself, which also runs before every RPC call.
  if (config.nimiq.rpcUrl) {
    checkRpcNetwork().then(
      () => console.log(`  Nimiq RPC confirmed on ${config.nimiq.network}`),
      (e) => {
        if (!(e instanceof WrongNetworkError)) console.warn(`[nimiq] Couldn't confirm the RPC's network yet (${e.message}); it's checked again before the next RPC call`)
      },
    )
  }
  console.log(`  Deposit address: ${treasuryAddress ?? 'NOT CONFIGURED'}${canSendFromTreasury ? ' (refunds automatic)' : ' (refunds manual)'}`)
  console.log(
    `  Gift escrow: ${giftEscrowAddress ?? 'NOT CONFIGURED, so new gifts are off (set NIMIQ_GIFT_PRIVATE_KEY)'}` +
      (giftEscrowAddress && giftEscrowAddress === treasuryAddress ? ' · same key as the treasury, so gifts count against NIM for sale' : ''),
  )
  if (config.nimiq.network !== 'mainnet') console.log('  Buy NIM and cash-out: OFF on testnet (testnet NIM has no value)')
  console.log(`  Paystack: ${config.paystackSecretKey ? 'configured' : 'NOT CONFIGURED'} · Deepgram: ${config.deepgramApiKey ? 'configured' : 'NOT CONFIGURED'}`)
  console.log(`  Buy NIM (Bachs): ${onrampEnabled() ? `on via ${config.bachs.baseUrl}${config.bachs.webhookSecret ? '' : ' · BACHS_WEBHOOK_SECRET not set, so payments are found by polling only'}` : config.nimiq.network !== 'mainnet' ? 'OFF on testnet' : 'NOT CONFIGURED'}`)
  console.log(`  Admin API: dashboard sign-in on · token ${adminEnabled() ? 'on' : config.adminToken ? 'OFF · ADMIN_TOKEN must be at least 32 characters' : 'NOT CONFIGURED'}`)
  console.log(`  Gift emails: ${config.resend.apiKey && config.resend.from ? `via Resend from ${config.resend.from}` : 'NOT CONFIGURED'}${config.miniAppUrl ? '' : ' · MINIAPP_URL not set, so emails carry the gift code but no link'}`)
})

startOfframpWorker()
startGiftCardWorker()
startPetWorker()
startOnrampWorker()
