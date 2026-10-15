import type { IncomingMessage, Server } from 'node:http'
import WebSocket, { RawData, WebSocketServer } from 'ws'
import type { OfframpOrder } from '@prisma/client'
import { config } from '../config'
import { HttpError } from '../lib/http-error'
import { normalizeAddress } from '../services/nimiq'
import {
  createOrder,
  getOrder,
  orderDto,
  orderEvents,
  parseAmount,
  quoteDto,
  quoteLuna,
  submitDeposit,
  verifyBankAccount,
} from '../services/offramp'
import { listBanks } from '../services/paystack'

const OUTPUT_SAMPLE_RATE = 24_000

const BANK_ALIASES: Record<string, string> = {
  gt: '058', gtb: '058', gtbank: '058', guaranty: '058', guarantytrust: '058',
  uba: '033', unitedbankforafrica: '033', firstbank: '011', first: '011', fcmb: '214', firstcity: '214',
  opay: '999992', palmpay: '999991', moniepoint: '50515', kuda: '50211', access: '044', zenith: '057',
  wema: '035', alat: '035A', stanbic: '221', sterling: '232', fidelity: '070', union: '032',
  polaris: '076', ecobank: '050', providus: '101',
}

const FUNCTIONS = [
  {
    name: 'find_bank',
    description: 'Search supported Nigerian banks by name. Call this whenever the user names their bank to get its bank_code.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'The bank name as the user said it, e.g. "GT bank", "Opay", "Moniepoint"' } },
      required: ['query'],
    },
  },
  {
    name: 'get_quote',
    description: 'Get the live NIM to naira quote for an amount of NIM, including fees and what lands in the bank account.',
    parameters: {
      type: 'object',
      properties: { nim_amount: { type: 'number', description: 'How much NIM the user wants to sell' } },
      required: ['nim_amount'],
    },
  },
  {
    name: 'verify_bank_account',
    description: 'Look up the account holder name for a 10-digit Nigerian account number at a bank.',
    parameters: {
      type: 'object',
      properties: {
        bank_code: { type: 'string', description: 'bank_code returned by find_bank' },
        account_number: { type: 'string', description: 'Exactly 10 digits, no spaces' },
      },
      required: ['bank_code', 'account_number'],
    },
  },
  {
    name: 'create_offramp_order',
    description:
      "Lock the quote and show the NIM payment approval in the user's Nimiq Pay wallet. Only call after the user clearly confirmed the amount, payout, bank and verified account name.",
    parameters: {
      type: 'object',
      properties: {
        nim_amount: { type: 'number' },
        bank_code: { type: 'string' },
        account_number: { type: 'string' },
      },
      required: ['nim_amount', 'bank_code', 'account_number'],
    },
  },
  {
    name: 'check_order_status',
    description: 'Get the current status of the order created during this call.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'end_call',
    description: 'Hang up. Call this right after saying a short goodbye.',
    parameters: { type: 'object', properties: {} },
  },
]

function buildPrompt(walletConnected: boolean) {
  return `You are Khalkos, the voice assistant inside KhalkosPay, a Nimiq Pay mini app that converts NIM (the Nimiq cryptocurrency) into Nigerian naira paid straight into a Nigerian bank account.

You are on a live voice call. Keep every reply to one or two short sentences. Never use lists, markdown, emojis or symbols such as the naira sign; say "naira". Say amounts the way people speak them. Read account numbers back digit by digit.

How to run the call:
- Collect three things: how much NIM to sell, the bank, and the 10-digit account number.
- As soon as you know the amount, call get_quote and tell the user roughly how many naira they will receive after fees. If below_minimum is true, tell them the minimum NIM amount.
- When the user names a bank, call find_bank. If there are several plausible matches, ask which one.
- When you have the account number, call verify_bank_account and read the account name back. Ask the user to confirm it is their account.
- Before creating the order, summarise the NIM amount, the naira they will receive, the bank and the account name, then ask for a clear yes. Only then call create_offramp_order.
- After the order is created, tell the user an approval is showing in their Nimiq Pay wallet and they should tap approve. Never say money was sent until you are told the payout completed.
- Only use numbers, names and codes that come from tool results. Never guess them.
- If a tool returns an error, explain it simply and offer to fix that detail.
- Only help with selling NIM for naira. Politely decline anything else.
- When the user is done, say a short goodbye and call end_call.${
    walletConnected
      ? ''
      : '\n\nThe user has not connected their Nimiq wallet. Before creating an order, ask them to open KhalkosPay inside Nimiq Pay and allow account access.'
  }`
}

function agentSettings(inputSampleRate: number, walletConnected: boolean) {
  return {
    type: 'Settings',
    audio: {
      input: { encoding: 'linear16', sample_rate: inputSampleRate },
      output: { encoding: 'linear16', sample_rate: OUTPUT_SAMPLE_RATE, container: 'none' },
    },
    agent: {
      greeting: 'Hi, this is KhalkosPay. I can turn your NIM into naira in your bank account. How much NIM would you like to cash out?',
      listen: {
        provider: {
          type: 'deepgram',
          model: 'nova-3',
          keyterms: ['NIM', 'Nimiq', 'naira', 'OPay', 'PalmPay', 'Moniepoint', 'Kuda', 'GTBank', 'UBA', 'Zenith', 'FCMB', 'Wema'],
        },
      },
      think: {
        provider: { type: 'anthropic', model: 'claude-haiku-4-5', temperature: 0.4 },
        prompt: buildPrompt(walletConnected),
        functions: FUNCTIONS,
      },
      speak: { provider: { type: 'deepgram', model: 'aura-2-thalia-en' } },
    },
  }
}

const spokenNaira = (n: number) => `${Math.round(n).toLocaleString('en-NG')} naira`

function statusAnnouncement(order: OfframpOrder): string | null {
  const dto = orderDto(order)
  switch (order.status) {
    case 'PAYING_OUT':
      return `Your NIM has arrived. I'm sending ${spokenNaira(dto.payoutNgn)} to ${dto.accountName} now.`
    case 'COMPLETED':
      return `Done! ${spokenNaira(dto.payoutNgn)} has been sent to ${dto.accountName} at ${dto.bankName}. Anything else I can help with?`
    case 'REFUNDING':
      return `The bank payout didn't go through, so I'm sending your ${dto.nimAmount} NIM back to your wallet.`
    case 'REFUNDED':
      return 'Your NIM refund has landed back in your wallet.'
    case 'PAYOUT_FAILED':
      return `The bank payout failed. ${dto.failureReason ?? ''} Your NIM is safe and will be refunded.`
    case 'REJECTED':
      return `I couldn't verify that payment. ${dto.failureReason ?? ''}`
    default:
      return null
  }
}

interface FunctionCall {
  id: string
  name: string
  arguments: string
  client_side: boolean
}

class VoiceSession {
  private agent: WebSocket | null = null
  private userAddress: string | null = null
  private orderId: string | null = null
  private keepAlive: NodeJS.Timeout | null = null
  private hangupTimer: NodeJS.Timeout | null = null
  private endAfterSpeech = false
  private closed = false

  constructor(private client: WebSocket) {
    client.on('message', (data, isBinary) => this.onClientMessage(data, isBinary))
    client.on('close', () => this.close())
    client.on('error', () => this.close())
    orderEvents.on('updated', this.onOrderUpdated)
  }

  private sendClient(message: Record<string, unknown>) {
    if (this.client.readyState === WebSocket.OPEN) this.client.send(JSON.stringify(message))
  }

  private sendAgent(message: Record<string, unknown>) {
    if (this.agent?.readyState === WebSocket.OPEN) this.agent.send(JSON.stringify(message))
  }

  private say(message: string) {
    this.sendAgent({ type: 'InjectAgentMessage', message, behavior: 'queue' })
  }

  private onClientMessage(data: RawData, isBinary: boolean) {
    if (isBinary) {
      if (this.agent?.readyState === WebSocket.OPEN) this.agent.send(data as Buffer)
      return
    }
    let msg: { type?: string; [key: string]: unknown }
    try {
      msg = JSON.parse(data.toString())
    } catch {
      return
    }
    if (msg.type === 'start') this.start(Number(msg.sampleRate), msg.userAddress)
    else if (msg.type === 'wallet_result') void this.onWalletResult(msg)
    else if (msg.type === 'end') this.close()
  }

  private start(sampleRate: number, userAddress: unknown) {
    if (this.agent) return
    if (!config.deepgramApiKey) {
      this.sendClient({ type: 'error', message: 'Voice calls are not configured on this server yet.' })
      this.close()
      return
    }
    if (!Number.isInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 48_000) {
      this.sendClient({ type: 'error', message: 'Unsupported microphone sample rate.' })
      this.close()
      return
    }
    try {
      this.userAddress = typeof userAddress === 'string' && userAddress ? normalizeAddress(userAddress) : null
    } catch {
      this.userAddress = null
    }

    const agent = new WebSocket(config.deepgramAgentUrl, { headers: { Authorization: `Token ${config.deepgramApiKey}` } })
    this.agent = agent
    agent.on('open', () => {
      agent.send(JSON.stringify(agentSettings(sampleRate, this.userAddress !== null)))
      this.keepAlive = setInterval(() => this.sendAgent({ type: 'KeepAlive' }), 8_000)
    })
    agent.on('message', (data, isBinary) => {
      if (isBinary) {
        if (this.client.readyState === WebSocket.OPEN) this.client.send(data as Buffer, { binary: true })
        return
      }
      try {
        this.onAgentEvent(JSON.parse(data.toString()))
      } catch (e) {
        console.error('[voice] bad agent event', e)
      }
    })
    agent.on('unexpected-response', (_req, res) => {
      console.error(`[voice] Deepgram rejected the connection: HTTP ${res.statusCode}`)
      this.sendClient({ type: 'error', message: 'The voice service refused the connection.' })
      this.close()
    })
    agent.on('error', (e) => {
      console.error('[voice] agent socket error', e.message)
      this.sendClient({ type: 'error', message: 'Lost connection to the voice service.' })
      this.close()
    })
    agent.on('close', () => this.close())
  }

  private onAgentEvent(event: { type: string; [key: string]: unknown }) {
    switch (event.type) {
      case 'SettingsApplied':
        this.sendClient({ type: 'ready', walletConnected: this.userAddress !== null })
        break
      case 'ConversationText':
        this.sendClient({ type: 'transcript', role: event.role, content: event.content })
        break
      case 'UserStartedSpeaking':
        this.sendClient({ type: 'user_speaking' })
        break
      case 'AgentThinking':
        this.sendClient({ type: 'agent_thinking' })
        break
      case 'AgentStartedSpeaking':
        this.sendClient({ type: 'agent_speaking' })
        break
      case 'AgentAudioDone':
        this.sendClient({ type: 'agent_done' })
        if (this.endAfterSpeech) this.hangUp()
        break
      case 'FunctionCallRequest':
        for (const fn of (event.functions as FunctionCall[]) ?? []) {
          if (fn.client_side) void this.handleFunction(fn)
        }
        break
      case 'Error':
        console.error('[voice] agent error', event)
        this.sendClient({ type: 'error', message: String(event.description ?? 'Voice agent error') })
        break
      case 'Warning':
        console.warn('[voice] agent warning', event)
        break
    }
  }

  private async handleFunction(fn: FunctionCall) {
    let content: unknown
    try {
      const args = fn.arguments ? JSON.parse(fn.arguments) : {}
      this.sendClient({ type: 'tool', name: fn.name })
      content = await this.runFunction(fn.name, args)
    } catch (e) {
      content = { error: e instanceof HttpError ? e.message : 'That did not work. Please try again.' }
      if (!(e instanceof HttpError)) console.error(`[voice] ${fn.name} failed`, e)
    }
    this.sendAgent({ type: 'FunctionCallResponse', id: fn.id, name: fn.name, content: JSON.stringify(content) })
  }

  private async runFunction(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'find_bank':
        return { matches: await findBanks(String(args.query ?? '')) }

      case 'get_quote': {
        const q = quoteDto(await quoteLuna(parseAmount(String(args.nim_amount))))
        this.sendClient({ type: 'quote', quote: q })
        return {
          nim_amount: q.nimAmount,
          naira_per_nim: q.rateNgnPerNim,
          fees_naira: q.feeNgn,
          user_receives_naira: q.payoutNgn,
          below_minimum: q.belowMinimum,
          minimum_nim: q.minNim,
          above_maximum: q.aboveMaximum,
          maximum_nim: q.maxNim,
        }
      }

      case 'verify_bank_account': {
        const { accountName, bank } = await verifyBankAccount(String(args.bank_code), String(args.account_number))
        return { account_name: accountName, bank_name: bank.name }
      }

      case 'create_offramp_order': {
        if (!this.userAddress) {
          return { error: 'The wallet is not connected. Ask the user to open KhalkosPay inside Nimiq Pay and allow account access.' }
        }
        if (this.orderId) {
          const existing = await getOrder(this.orderId)
          if (['CONFIRMING', 'PAYING_OUT', 'REFUNDING'].includes(existing.status)) {
            return { error: 'An order from this call is already being processed. Check its status instead.' }
          }
        }
        const order = await createOrder({
          userAddress: this.userAddress,
          nimAmount: String(args.nim_amount),
          bankCode: String(args.bank_code),
          accountNumber: String(args.account_number),
          source: 'voice',
        })
        this.orderId = order.id
        const dto = orderDto(order)
        this.sendClient({ type: 'wallet_request', order: dto })
        return {
          order_id: order.id,
          status: 'waiting_for_wallet_approval',
          nim_amount: dto.nimAmount,
          user_receives_naira: dto.payoutNgn,
          account_name: dto.accountName,
          bank_name: dto.bankName,
          note: 'A payment approval is now showing in the Nimiq Pay wallet. Ask the user to approve it. You will be told when it is approved and when the payout completes.',
        }
      }

      case 'check_order_status': {
        if (!this.orderId) return { error: 'No order has been created in this call yet.' }
        const dto = orderDto(await getOrder(this.orderId))
        return { status: dto.status, user_receives_naira: dto.payoutNgn, failure_reason: dto.failureReason }
      }

      case 'end_call':
        this.endAfterSpeech = true
        this.hangupTimer = setTimeout(() => this.hangUp(), 10_000)
        return { ok: true }

      default:
        return { error: `Unknown function ${name}` }
    }
  }

  private async onWalletResult(msg: Record<string, unknown>) {
    if (!this.orderId) return
    if (msg.ok !== true || typeof msg.tx !== 'string') {
      this.orderId = null
      this.say("No problem, the payment wasn't approved so nothing left your wallet. Would you like to try again?")
      return
    }
    try {
      const dto = orderDto(await submitDeposit(this.orderId, msg.tx))
      this.say(`Thanks, I can see your approval. Once your NIM confirms on the Nimiq network I'll send ${spokenNaira(dto.payoutNgn)} to your bank.`)
    } catch (e) {
      this.say(`I couldn't register that payment. ${e instanceof HttpError ? e.message : 'Please try again.'}`)
    }
  }

  private onOrderUpdated = (order: OfframpOrder) => {
    if (order.id !== this.orderId) return
    this.sendClient({ type: 'order_update', order: orderDto(order) })
    const line = statusAnnouncement(order)
    if (line) this.say(line)
  }

  private hangUp() {
    this.sendClient({ type: 'ended', reason: 'hangup' })
    setTimeout(() => this.close(), 250)
  }

  close() {
    if (this.closed) return
    this.closed = true
    orderEvents.off('updated', this.onOrderUpdated)
    if (this.keepAlive) clearInterval(this.keepAlive)
    if (this.hangupTimer) clearTimeout(this.hangupTimer)
    if (this.agent && this.agent.readyState <= WebSocket.OPEN) this.agent.close()
    if (this.client.readyState === WebSocket.OPEN) {
      this.sendClient({ type: 'ended', reason: 'closed' })
      this.client.close()
    }
  }
}

async function findBanks(query: string) {
  const banks = await listBanks()
  const key = query.toLowerCase().replace(/bank|plc|limited|ltd|nigeria|of|[^a-z0-9]/g, '')
  const alias = BANK_ALIASES[key]
  const byAlias = alias ? banks.filter((b) => b.code === alias) : []
  const byName = banks.filter((b) => key && b.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(key))
  return [...new Map([...byAlias, ...byName].map((b) => [b.code, b])).values()]
    .slice(0, 5)
    .map((b) => ({ bank_code: b.code, name: b.name }))
}

export function attachVoiceServer(server: Server, isOriginAllowed: (origin: string | undefined) => boolean) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 })
  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost')
    if (pathname !== '/api/voice/call' || !isOriginAllowed(req.headers.origin)) {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => new VoiceSession(ws))
  })
}
