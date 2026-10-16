import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { HttpError } from '../lib/http-error'
import {
  adoptPet,
  changeBuddy,
  feedPet,
  getPet,
  getRevival,
  petConfigDto,
  petDto,
  revivalDto,
  startRevival,
  submitRevivalPayment,
} from '../services/pets'

export const biteBuddyRouter = Router()

const feedLimit = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false })

biteBuddyRouter.get('/config', (_req, res) => {
  res.json(petConfigDto())
})

biteBuddyRouter.get('/pet', async (req, res) => {
  res.json(await petDto(await getPet(req.query.address)))
})

biteBuddyRouter.post('/pet', async (req, res) => {
  const { address, species, name, timezone } = req.body ?? {}
  res.status(201).json(await petDto(await adoptPet({ address, species, name, timezone })))
})

biteBuddyRouter.patch('/pet', async (req, res) => {
  const { address, species, name } = req.body ?? {}
  res.json(await petDto(await changeBuddy({ address, species, name })))
})

biteBuddyRouter.post('/pet/feed', feedLimit, async (req, res) => {
  const { address, image } = req.body ?? {}
  const { pet, meal } = await feedPet(address, image)
  res.json({ pet: await petDto(pet), mealId: meal.id })
})

biteBuddyRouter.post('/pet/revive', async (req, res) => {
  res.status(201).json(revivalDto(await startRevival(req.body?.address)))
})

biteBuddyRouter.get('/revivals/:id', async (req, res) => {
  res.json(revivalDto(await getRevival(req.params.id)))
})

biteBuddyRouter.post('/revivals/:id/payment', async (req, res) => {
  const tx = req.body?.tx
  if (typeof tx !== 'string' || !tx) throw new HttpError(400, 'tx is required', 'INVALID_REQUEST')
  res.json(revivalDto(await submitRevivalPayment(req.params.id, tx)))
})
