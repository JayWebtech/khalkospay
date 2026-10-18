import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { addressOfPublicKey, createChallenge, verifyChallenge } from '../services/wallet-auth'

export const authRouter = Router()

const limit = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false })

authRouter.post('/challenge', limit, (req, res) => {
  res.status(201).json(createChallenge())
})

authRouter.post('/verify', limit, (req, res) => {
  const { challengeId, publicKey, signature } = req.body ?? {}
  res.json(verifyChallenge({ challengeId, publicKey, signature }))
})

/** Which account a signature came from, without signing in: the fallback when /verify can't check the signature. */
authRouter.post('/address', limit, (req, res) => {
  res.json({ address: addressOfPublicKey(req.body?.publicKey) })
})
