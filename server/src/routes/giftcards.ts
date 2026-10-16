import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { config } from '../config'
import { HttpError } from '../lib/http-error'
import {
  cardDto,
  claimCard,
  createCard,
  getCard,
  giftConfigDto,
  listSenderCards,
  reclaimCard,
  senderCardDto,
  submitFunding,
} from '../services/giftcards'
import { requireWallet } from '../services/wallet-auth'

export const giftCardsRouter = Router()

const createLimit = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false })

const tooManyClaims = { message: 'Too many claim attempts. Wait a while and try again.', code: 'TOO_MANY_ATTEMPTS' }

// Only failed attempts count, so a wrong guess burns budget but a real claim never gets blocked by its own success.
const claimLimitPerIp = rateLimit({
  windowMs: 15 * 60_000,
  limit: config.gifts.claimAttemptsPerIp,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: tooManyClaims,
})

// Per card, so guessing a code from many addresses still runs out quickly.
const claimLimitPerCard = rateLimit({
  windowMs: 60 * 60_000,
  limit: config.gifts.claimAttemptsPerCard,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `card:${req.params.id}`,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: tooManyClaims,
})

giftCardsRouter.get('/config', (_req, res) => {
  res.json(giftConfigDto())
})

giftCardsRouter.post('/', createLimit, async (req, res) => {
  const { senderAddress, nimAmount, redeemCode, message, template, recipientEmail, anonymous } = req.body ?? {}
  if (!senderAddress || !nimAmount || !redeemCode) {
    throw new HttpError(400, 'senderAddress, nimAmount and redeemCode are required', 'INVALID_REQUEST')
  }
  const card = await createCard({ senderAddress, nimAmount, redeemCode, message, template, recipientEmail, anonymous })
  res.status(201).json(cardDto(card))
})

// The sender's gifts carry their links, which are half of what it takes to claim, so this needs a signed-in wallet.
giftCardsRouter.get('/', async (req, res) => {
  const address = requireWallet(req)
  res.json((await listSenderCards(address)).map(senderCardDto))
})

giftCardsRouter.post('/:id/reclaim', async (req, res) => {
  const address = requireWallet(req)
  res.json(cardDto(await reclaimCard(req.params.id, address)))
})

giftCardsRouter.get('/:id', async (req, res) => {
  res.json(cardDto(await getCard(req.params.id)))
})

giftCardsRouter.post('/:id/funding', async (req, res) => {
  const tx = req.body?.tx
  if (typeof tx !== 'string' || !tx) throw new HttpError(400, 'tx is required', 'INVALID_REQUEST')
  res.json(cardDto(await submitFunding(req.params.id, tx)))
})

giftCardsRouter.post('/:id/claim', claimLimitPerIp, claimLimitPerCard, async (req, res) => {
  const { redeemCode, claimerAddress } = req.body ?? {}
  res.json(cardDto(await claimCard(String(req.params.id), { redeemCode, claimerAddress })))
})
