import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { HttpError } from '../lib/http-error'
import { createOrder, getOrder, listOrders, onrampConfigDto, orderDto, quote, quoteDto } from '../services/onramp'

export const onrampRouter = Router()

const orderLimit = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false })

onrampRouter.get('/config', (_req, res) => {
  res.json(onrampConfigDto())
})

onrampRouter.get('/quote', async (req, res) => {
  res.json(quoteDto(await quote(req.query.currency, req.query.amount)))
})

onrampRouter.post('/orders', orderLimit, async (req, res) => {
  const { address, currency, amount } = req.body ?? {}
  if (!address || !currency || !amount) throw new HttpError(400, 'address, currency and amount are required', 'INVALID_REQUEST')
  res.status(201).json(orderDto(await createOrder({ address, currency, amount })))
})

onrampRouter.get('/orders', async (req, res) => {
  res.json((await listOrders(req.query.address)).map(orderDto))
})

onrampRouter.get('/orders/:id', async (req, res) => {
  res.json(orderDto(await getOrder(req.params.id)))
})
