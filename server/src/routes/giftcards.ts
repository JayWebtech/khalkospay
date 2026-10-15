import { Router } from 'express'
import { prisma } from '../lib/prisma'

export const giftCardsRouter = Router()

giftCardsRouter.post('/', async (req, res) => {
  try {
    const { amount, message, redeemCode, template, recipientEmail, anonymous, senderAddress } = req.body
    if (!amount || !redeemCode) {
      res.status(400).json({ message: 'Amount and redeem code are required' })
      return
    }

    const card = await prisma.giftCard.create({
      data: {
        amount,
        message: message || '',
        redeemCode,
        template: template || 'default',
        senderAddress: senderAddress || null,
        recipientEmail: recipientEmail || null,
        anonymous: anonymous || false,
      },
    })

    res.json({ id: card.id, createdAt: card.createdAt })
  } catch (e) {
    console.error('Gift card create error:', e)
    res.status(500).json({ message: 'Failed to create gift card' })
  }
})

giftCardsRouter.get('/:id', async (req, res) => {
  try {
    const card = await prisma.giftCard.findUnique({ where: { id: req.params.id } })
    if (!card) {
      res.status(404).json({ message: 'Gift card not found' })
      return
    }
    res.json({
      amount: card.amount,
      message: card.message,
      template: card.template,
      claimed: card.claimed,
      senderName: card.anonymous ? undefined : card.senderAddress,
    })
  } catch (e) {
    console.error('Gift card get error:', e)
    res.status(500).json({ message: 'Failed to get gift card' })
  }
})

giftCardsRouter.post('/:id/claim', async (req, res) => {
  try {
    const { redeemCode } = req.body
    const card = await prisma.giftCard.findUnique({ where: { id: req.params.id } })
    if (!card) {
      res.status(404).json({ message: 'Gift card not found' })
      return
    }
    if (card.claimed) {
      res.status(400).json({ message: 'Gift card already claimed' })
      return
    }
    if (card.redeemCode !== redeemCode) {
      res.status(400).json({ message: 'Invalid redeem code' })
      return
    }

    await prisma.giftCard.update({
      where: { id: card.id },
      data: { claimed: true, claimedAt: new Date(), claimerAddress: req.body.claimerAddress || null },
    })

    res.json({ amount: card.amount, message: 'Gift card claimed successfully' })
  } catch (e) {
    console.error('Gift card claim error:', e)
    res.status(500).json({ message: 'Failed to claim gift card' })
  }
})
