import express, { Router } from 'express'
import { verifyWebhook, type BachsEvent } from '../services/bachs'
import { applyTransferStatus } from '../services/offramp'
import { handleBachsEvent } from '../services/onramp'
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

// Bachs signs "{timestamp}.{raw body}", so this route keeps the raw bytes. Only a bad signature gets a 400;
// if our own handling fails we answer 5xx so Bachs retries the delivery.
webhooksRouter.post('/bachs', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const raw = req.body as Buffer
  const ok = verifyWebhook(raw, {
    v2: req.header('x-bachs-signature-v2'),
    timestamp: req.header('x-bachs-timestamp'),
    signature: req.header('x-bachs-signature'),
  })
  if (!ok) {
    res.sendStatus(400)
    return
  }
  let event: BachsEvent
  try {
    event = JSON.parse(raw.toString('utf8')) as BachsEvent
  } catch {
    res.sendStatus(400)
    return
  }
  try {
    await handleBachsEvent(event)
    res.sendStatus(200)
  } catch (e) {
    console.error('[bachs] webhook handling failed:', e instanceof Error ? e.message : e)
    res.sendStatus(500)
  }
})
