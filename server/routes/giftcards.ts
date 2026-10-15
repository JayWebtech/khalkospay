import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'

const router = Router()

interface GiftCard {
  id: string
  amount: number
  message: string
  template: string
  redeemCode: string
  recipientEmail?: string
  anonymous: boolean
  senderAddress?: string
  claimed: boolean
  claimedAt?: Date
  createdAt: Date
}

const giftCards = new Map<string, GiftCard>()

router.post('/', (req, res) => {
  const { amount, message, redeemCode, template, recipientEmail, anonymous, senderAddress } = req.body

  if (!amount || amount <= 0 || !redeemCode || redeemCode.length < 4) {
    res.status(400).json({ message: 'Amount and redeem code (min 4 chars) are required' })
    return
  }

  const card: GiftCard = {
    id: uuidv4(),
    amount,
    message: message || '',
    template: template || 'default',
    redeemCode,
    recipientEmail,
    anonymous: anonymous || false,
    senderAddress,
    claimed: false,
    createdAt: new Date(),
  }

  giftCards.set(card.id, card)
  res.status(201).json({ id: card.id, link: `/gift/${card.id}` })
})

router.get('/:id', (req, res) => {
  const card = giftCards.get(req.params.id)
  if (!card) {
    res.status(404).json({ message: 'Gift card not found' })
    return
  }

  res.json({
    amount: card.amount,
    message: card.message,
    template: card.template,
    senderName: card.anonymous ? undefined : (card.senderAddress ? `${card.senderAddress.slice(0, 9)}...` : undefined),
    claimed: card.claimed,
  })
})

router.post('/:id/claim', (req, res) => {
  const card = giftCards.get(req.params.id)
  if (!card) {
    res.status(404).json({ message: 'Gift card not found' })
    return
  }

  if (card.claimed) {
    res.status(400).json({ message: 'Gift card already claimed' })
    return
  }

  if (req.body.redeemCode !== card.redeemCode) {
    res.status(400).json({ message: 'Invalid redeem code' })
    return
  }

  card.claimed = true
  card.claimedAt = new Date()

  res.json({ success: true, amount: card.amount })
})

router.get('/', (_req, res) => {
  const cards = Array.from(giftCards.values())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map(c => ({
      id: c.id,
      amount: c.amount,
      message: c.message,
      template: c.template,
      claimed: c.claimed,
      createdAt: c.createdAt,
    }))
  res.json(cards)
})

export { router as giftCardRoutes }
