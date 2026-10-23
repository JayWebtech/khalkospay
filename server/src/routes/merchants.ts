import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { HttpError } from '../lib/http-error'
import {
  createPayment,
  findMerchantByOwner,
  getMerchantByAddress,
  getMerchantByCode,
  getMerchantByOwner,
  getPayment,
  listMerchantPayments,
  merchantDto,
  ownMerchantDto,
  paymentDto,
  receivedPaymentDto,
  refreshPayment,
  saveMerchant,
  submitPaymentTx,
} from '../services/merchants'
import { formatNim } from '../services/nimiq'
import { requireWallet } from '../services/wallet-auth'

export const merchantsRouter = Router()

const saveLimit = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false })
const paymentLimit = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many payments started. Wait a minute and try again.', code: 'TOO_MANY_PAYMENTS' },
})
// Shops are public, but codes are short; keep anyone from walking the code space.
const lookupLimit = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many shop lookups. Wait a minute and try again.', code: 'TOO_MANY_LOOKUPS' },
})

// The signed-in wallet's own shop. A profile can only be made or changed by the wallet that owns it.
merchantsRouter.get('/me', async (req, res) => {
  const merchant = await findMerchantByOwner(requireWallet(req))
  res.json({ merchant: merchant ? ownMerchantDto(merchant) : null })
})

merchantsRouter.put('/me', saveLimit, async (req, res) => {
  const owner = requireWallet(req)
  res.json(ownMerchantDto(await saveMerchant(owner, req.body ?? {})))
})

merchantsRouter.get('/me/payments', async (req, res) => {
  const merchant = await getMerchantByOwner(requireWallet(req))
  const { payments, receivedLuna, receivedCount } = await listMerchantPayments(merchant)
  res.json({ payments: payments.map(receivedPaymentDto), totals: { receivedNim: formatNim(receivedLuna), receivedCount } })
})

merchantsRouter.get('/by-address/:address', lookupLimit, async (req, res) => {
  res.json(merchantDto(await getMerchantByAddress(String(req.params.address))))
})

merchantsRouter.get('/payments/:id', async (req, res) => {
  const payment = await getPayment(String(req.params.id))
  refreshPayment(payment)
  res.json(paymentDto(payment))
})

merchantsRouter.post('/payments/:id/tx', async (req, res) => {
  const tx = req.body?.tx
  if (typeof tx !== 'string' || !tx) throw new HttpError(400, 'tx is required', 'INVALID_REQUEST')
  res.json(paymentDto(await submitPaymentTx(String(req.params.id), tx)))
})

merchantsRouter.get('/:code', lookupLimit, async (req, res) => {
  res.json(merchantDto(await getMerchantByCode(String(req.params.code))))
})

merchantsRouter.post('/:code/payments', paymentLimit, async (req, res) => {
  const { amountNim, note, payerAddress } = req.body ?? {}
  res.status(201).json(paymentDto(await createPayment(String(req.params.code), { amountNim, note, payerAddress })))
})
