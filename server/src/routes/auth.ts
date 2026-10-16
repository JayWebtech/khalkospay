import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { createChallenge, verifyChallenge } from '../services/wallet-auth'

export const authRouter = Router()

const limit = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false })

authRouter.post('/challenge', limit, (req, res) => {
  res.status(201).json(createChallenge(req.body?.address))
})

authRouter.post('/verify', limit, (req, res) => {
  const { challengeId, publicKey, signature } = req.body ?? {}
  res.json(verifyChallenge({ challengeId, publicKey, signature }))
})
