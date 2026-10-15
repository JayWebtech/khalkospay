import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { config } from '../config'
import { HttpError } from '../lib/http-error'
import { treasuryAddress } from '../services/nimiq'
import {
  createOrder,
  getOrder,
  listOrders,
  orderDto,
  parseAmount,
  quoteDto,
  quoteLuna,
  submitDeposit,
  verifyBankAccount,
} from '../services/offramp'
import { listBanks } from '../services/paystack'
import { getNimNgnRate } from '../services/rates'

export const offrampRouter = Router()

const strictLimit = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false })

offrampRouter.get('/config', (_req, res) => {
  res.json({
    enabled: Boolean(treasuryAddress && config.paystackSecretKey),
    network: config.nimiq.network,
    depositAddress: treasuryAddress,
    minPayoutNgn: config.offramp.minPayoutNgn,
    maxPayoutNgn: config.offramp.maxPayoutNgn,
    feePercent: config.offramp.feeBps / 100,
    quoteTtlSeconds: config.offramp.quoteTtlSeconds,
  })
})

offrampRouter.get('/banks', async (_req, res) => {
  res.json(await listBanks())
})

offrampRouter.get('/rate', async (_req, res) => {
  const rate = await getNimNgnRate()
  res.json({ ngnPerNim: rate.ngnPerNim, updatedAt: new Date(rate.fetchedAt).toISOString() })
})

offrampRouter.get('/quote', async (req, res) => {
  const nim = String(req.query.nim ?? '')
  res.json(quoteDto(await quoteLuna(parseAmount(nim))))
})

offrampRouter.post('/resolve-account', strictLimit, async (req, res) => {
  const { bankCode, accountNumber } = req.body ?? {}
  if (typeof bankCode !== 'string' || typeof accountNumber !== 'string') {
    throw new HttpError(400, 'bankCode and accountNumber are required', 'INVALID_REQUEST')
  }
  const { accountName, bank } = await verifyBankAccount(bankCode, accountNumber)
  res.json({ accountName, bankName: bank.name })
})

offrampRouter.post('/orders', strictLimit, async (req, res) => {
  const { userAddress, nimAmount, bankCode, accountNumber } = req.body ?? {}
  if (!userAddress || !nimAmount || !bankCode || !accountNumber) {
    throw new HttpError(400, 'userAddress, nimAmount, bankCode and accountNumber are required', 'INVALID_REQUEST')
  }
  const order = await createOrder({ userAddress, nimAmount, bankCode, accountNumber: String(accountNumber), source: 'app' })
  res.status(201).json(orderDto(order))
})

offrampRouter.get('/orders', async (req, res) => {
  const address = String(req.query.address ?? '')
  if (!address) throw new HttpError(400, 'address is required', 'INVALID_REQUEST')
  res.json((await listOrders(address)).map((o) => orderDto(o)))
})

offrampRouter.get('/orders/:id', async (req, res) => {
  res.json(orderDto(await getOrder(req.params.id)))
})

offrampRouter.post('/orders/:id/deposit', async (req, res) => {
  const tx = req.body?.tx
  if (typeof tx !== 'string' || !tx) throw new HttpError(400, 'tx is required', 'INVALID_REQUEST')
  res.json(orderDto(await submitDeposit(req.params.id, tx)))
})
