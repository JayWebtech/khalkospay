import express, { Router } from 'express'
import { applyTransferStatus } from '../services/offramp'
import { isValidWebhookSignature, TransferStatus } from '../services/paystack'

export const webhooksRouter = Router()

const TRANSFER_EVENTS: Record<string, TransferStatus> = {
  'transfer.success': 'success',
  'transfer.failed': 'failed',
  'transfer.reversed': 'reversed',
}

webhooksRouter.post('/paystack', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const raw = req.body as Buffer
  if (!isValidWebhookSignature(raw, req.header('x-paystack-signature'))) {
    res.sendStatus(401)
    return
  }
  const event = JSON.parse(raw.toString('utf8')) as { event: string; data?: { reference?: string } }
  const status = TRANSFER_EVENTS[event.event]
  if (status && event.data?.reference) {
    await applyTransferStatus(event.data.reference, status)
  }
  res.sendStatus(200)
})
