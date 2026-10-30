import { config } from '../config'
import { API_STATUSES } from '../services/partner-dto'
import { EVENT_TYPES, SIGNATURE_HEADER } from '../services/partner-webhooks'

/** OpenAPI 3.1 description of /v1, served at /v1/openapi.json. Keep it in step with routes/v1.ts. */

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })
const json = (schema: object) => ({ 'application/json': { schema } })
const str = (description: string, extra: object = {}) => ({ type: 'string', description, ...extra })
const nullable = (schema: object) => ({ oneOf: [schema, { type: 'null' }] })

const errorResponse = (description: string) => ({ description, content: json(ref('Error')) })

const commonErrors = {
  '401': errorResponse('Missing, invalid, revoked or expired API key'),
  '403': errorResponse('The partner is disabled, or a sandbox endpoint was called with a live key'),
  '429': errorResponse('Rate limit reached for this key'),
  '500': errorResponse('Unexpected error'),
}

const postErrors = {
  ...commonErrors,
  '400': errorResponse('Invalid request, or the Idempotency-Key header is missing'),
  '409': errorResponse('A request with this Idempotency-Key is still running, or the order is in the wrong state'),
  '422': errorResponse('This Idempotency-Key was already used for a different request'),
}

const idempotencyKey = { $ref: '#/components/parameters/IdempotencyKey' }
const offrampId = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }

const offrampResponse = (description: string) => ({ description, content: json(ref('Offramp')) })

export function openApiSpec(serverUrl: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'KhalkosPay off-ramp API',
      version: '1.0.0',
      summary: 'Let your users cash out NIM to Nigerian bank accounts.',
      description:
        'Server-to-server API. Authenticate with a secret key: `kp_test_…` keys use the sandbox (nothing touches the Nimiq ' +
        'network or a bank) and `kp_live_…` keys move real money. Each key only sees its own partner’s orders in its own mode. ' +
        'Every POST needs an `Idempotency-Key` header. Errors always look like `{ "error": { "code", "message" } }`.',
      contact: { name: 'KhalkosPay' },
      license: { name: 'MIT', identifier: 'MIT' },
    },
    servers: [{ url: `${serverUrl}/v1` }],
    security: [{ secretKey: [] }],
    tags: [
      { name: 'Rates and banks' },
      { name: 'Off-ramps', description: 'Create a cash-out, get deposit instructions, follow it to the bank.' },
      { name: 'Sandbox', description: 'Test keys only: simulate what the chain and the bank would do.' },
      { name: 'Webhooks' },
    ],
    paths: {
      '/rates': {
        get: {
          tags: ['Rates and banks'],
          operationId: 'getRate',
          summary: 'Current NIM→NGN rate, fees and limits',
          responses: { '200': { description: 'The rate', content: json(ref('Rate')) }, ...commonErrors },
        },
      },
      '/banks': {
        get: {
          tags: ['Rates and banks'],
          operationId: 'listBanks',
          summary: 'Nigerian banks that can receive payouts',
          responses: {
            '200': { description: 'Banks, popular ones first', content: json(listOf(ref('Bank'), false)) },
            ...commonErrors,
          },
        },
      },
      '/bank-accounts/resolve': {
        post: {
          tags: ['Rates and banks'],
          operationId: 'resolveBankAccount',
          summary: 'Look up the name on a bank account',
          description: 'Show the name to your user before they confirm. In the sandbox, `0000000000` never resolves.',
          parameters: [idempotencyKey],
          requestBody: {
            required: true,
            content: json({
              type: 'object',
              required: ['bankCode', 'accountNumber'],
              additionalProperties: false,
              properties: { bankCode: str('From GET /banks', { example: '058' }), accountNumber: str('10-digit NUBAN', { example: '0123456789' }) },
            }),
          },
          responses: { '200': { description: 'The account', content: json(ref('BankAccount')) }, ...postErrors },
        },
      },
      '/quotes': {
        post: {
          tags: ['Rates and banks'],
          operationId: 'createQuote',
          summary: 'What an amount of NIM pays out, after fees',
          description: 'Quotes are indicative. The rate is locked when you create the off-ramp, for `quoteTtlSeconds`.',
          parameters: [idempotencyKey],
          requestBody: {
            required: true,
            content: json({ type: 'object', required: ['nimAmount'], additionalProperties: false, properties: { nimAmount: ref('NimAmount') } }),
          },
          responses: { '200': { description: 'The quote', content: json(ref('Quote')) }, ...postErrors },
        },
      },
      '/offramps': {
        post: {
          tags: ['Off-ramps'],
          operationId: 'createOfframp',
          summary: 'Create an off-ramp and get its deposit instructions',
          description:
            'Locks the rate and checks the bank account. Your user then sends exactly `deposit.nimAmount` NIM to `deposit.address` ' +
            'with `deposit.memo` as the transaction message, before `expiresAt`. Without the memo the deposit can’t be matched.',
          parameters: [idempotencyKey],
          requestBody: {
            required: true,
            content: json({
              type: 'object',
              required: ['nimAmount', 'bankCode', 'accountNumber'],
              additionalProperties: false,
              properties: {
                nimAmount: ref('NimAmount'),
                bankCode: str('From GET /banks', { example: '058' }),
                accountNumber: str('10-digit NUBAN', { example: '0123456789' }),
                reference: str('Your own id for this cash-out, up to 100 characters. Not unique; filter by it in GET /offramps.', { maxLength: 100 }),
                metadata: ref('Metadata'),
                refundAddress: str(
                  'Where to send the NIM back if the payout fails or the deposit is short or late. Set it whenever the deposit comes from an ' +
                    'exchange or custodial wallet, which can’t receive a refund at the sending address. Defaults to the sender.',
                  { example: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000' },
                ),
              },
            }),
          },
          responses: { '201': offrampResponse('The off-ramp, waiting for its deposit'), ...postErrors },
        },
        get: {
          tags: ['Off-ramps'],
          operationId: 'listOfframps',
          summary: 'Your off-ramps, newest first',
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string', enum: API_STATUSES } },
            { name: 'reference', in: 'query', schema: { type: 'string' }, description: 'Your reference, exact match' },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' }, description: '`nextCursor` from the previous page' },
          ],
          responses: { '200': { description: 'A page of off-ramps', content: json(listOf(ref('Offramp'))) }, ...commonErrors },
        },
      },
      '/offramps/{id}': {
        get: {
          tags: ['Off-ramps'],
          operationId: 'getOfframp',
          summary: 'One off-ramp',
          parameters: [offrampId],
          responses: { '200': offrampResponse('The off-ramp'), '404': errorResponse('Not found for this partner and mode'), ...commonErrors },
        },
      },
      '/offramps/{id}/deposit': {
        post: {
          tags: ['Off-ramps'],
          operationId: 'reportDeposit',
          summary: 'Report the deposit transaction (optional)',
          description:
            'Speeds things up. Deposits with the right memo are also found on chain without this. ' +
            'In the sandbox, reporting any hash simulates a deposit of the exact amount.',
          parameters: [offrampId, idempotencyKey],
          requestBody: {
            required: true,
            content: json({ type: 'object', required: ['txHash'], additionalProperties: false, properties: { txHash: str('Nimiq transaction hash (64 hex characters)') } }),
          },
          responses: { '200': offrampResponse('The off-ramp, now confirming'), '404': errorResponse('Not found'), ...postErrors },
        },
      },
      '/sandbox/offramps/{id}/deposit': {
        post: {
          tags: ['Sandbox'],
          operationId: 'simulateDeposit',
          summary: 'Simulate a deposit (test keys only)',
          description: `Moves a sandbox off-ramp through confirming → paying_out → completed, about ${Math.round(config.partnerApi.sandboxStepMs / 1000)} s per step, sending the same webhooks as live. A smaller nimAmount, \`payout: "failed"\`, or a deposit after the order expired ends in a refund instead.`,
          parameters: [offrampId, idempotencyKey],
          requestBody: {
            content: json({
              type: 'object',
              additionalProperties: false,
              properties: {
                nimAmount: { ...ref('NimAmount'), description: 'Defaults to the amount due' },
                payout: { type: 'string', enum: ['success', 'failed'], default: 'success' },
                from: str('Sender address. Defaults to a random one.'),
              },
            }),
          },
          responses: { '200': offrampResponse('The off-ramp, now confirming'), '404': errorResponse('Not found'), ...postErrors },
        },
      },
      '/sandbox/offramps/{id}/expire': {
        post: {
          tags: ['Sandbox'],
          operationId: 'simulateExpiry',
          summary: 'Expire a sandbox off-ramp now (test keys only)',
          parameters: [offrampId, idempotencyKey],
          responses: { '200': offrampResponse('The off-ramp, expired'), '404': errorResponse('Not found'), ...postErrors },
        },
      },
      '/webhooks/test': {
        post: {
          tags: ['Webhooks'],
          operationId: 'sendTestWebhook',
          summary: 'Send a signed sample event to your webhook URL now',
          description: 'Goes to the URL for the key’s mode. The event has `"sample": true` and is not retried.',
          parameters: [idempotencyKey],
          requestBody: {
            content: json({ type: 'object', additionalProperties: false, properties: { type: { type: 'string', enum: EVENT_TYPES, default: 'offramp.paid' } } }),
          },
          responses: { '200': { description: 'The event and how your endpoint answered', content: json(ref('WebhookDelivery')) }, ...postErrors },
        },
      },
      '/webhooks/events': {
        get: {
          tags: ['Webhooks'],
          operationId: 'listWebhookEvents',
          summary: 'Events sent to you, with every delivery attempt',
          parameters: [
            { name: 'offrampId', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'A page of events', content: json(listOf(ref('WebhookDelivery'))) }, ...commonErrors },
        },
      },
    },
    webhooks: Object.fromEntries(
      EVENT_TYPES.map((type) => [
        type,
        {
          post: {
            summary: type,
            description: `Signed with the \`${SIGNATURE_HEADER}\` header: \`t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" keyed with your whsec_ secret>\`. Answer 2xx within ${config.partnerApi.webhookTimeoutMs / 1000} s; anything else is retried with backoff for about two days.`,
            parameters: [{ name: SIGNATURE_HEADER, in: 'header', required: true, schema: { type: 'string' } }],
            requestBody: { content: json(ref('Event')) },
            responses: { '200': { description: 'Received' } },
          },
        },
      ]),
    ),
    components: {
      securitySchemes: {
        secretKey: { type: 'http', scheme: 'bearer', description: '`kp_test_…` (sandbox) or `kp_live_…` (real money). Keep it on your server.' },
      },
      parameters: {
        IdempotencyKey: {
          name: 'Idempotency-Key',
          in: 'header',
          required: true,
          description: 'A unique string per operation, such as a UUID. Retrying with the same key returns the first response. Kept for 24 hours.',
          schema: { type: 'string', maxLength: 255 },
        },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: { code: str('Machine-readable, e.g. below_minimum, account_not_found, idempotency_key_reused'), message: str('For people') },
            },
          },
        },
        NimAmount: { type: 'string', pattern: '^\\d+(\\.\\d{1,5})?$', example: '250.5', description: 'NIM, up to 5 decimals. A JSON number is accepted too.' },
        Metadata: {
          type: 'object',
          maxProperties: 20,
          additionalProperties: { oneOf: [{ type: 'string', maxLength: 500 }, { type: 'number' }, { type: 'boolean' }] },
          description: 'Your own key/value notes, echoed back. Up to 20 keys of 40 characters.',
        },
        Rate: {
          type: 'object',
          properties: {
            object: { const: 'rate' },
            livemode: { type: 'boolean' },
            base: { const: 'NIM' },
            quote: { const: 'NGN' },
            rate: { type: 'number', description: 'NGN per NIM' },
            updatedAt: { type: 'string', format: 'date-time' },
            serviceFeePercent: { type: 'number' },
            minPayoutNgn: { type: 'number' },
            maxPayoutNgn: { type: 'number' },
            quoteTtlSeconds: { type: 'integer' },
            available: { type: 'boolean', description: 'False when live cash-outs are switched off on this server' },
          },
        },
        Bank: { type: 'object', properties: { code: { type: 'string' }, name: { type: 'string' }, popular: { type: 'boolean' } } },
        BankAccount: {
          type: 'object',
          properties: {
            object: { const: 'bank_account' },
            bankCode: { type: 'string' },
            bankName: { type: 'string' },
            accountNumber: { type: 'string' },
            accountName: { type: 'string' },
          },
        },
        Quote: {
          type: 'object',
          properties: {
            object: { const: 'quote' },
            livemode: { type: 'boolean' },
            nimAmount: { type: 'string' },
            rateNgnPerNim: { type: 'number' },
            grossNgn: { type: 'number' },
            serviceFeeNgn: { type: 'number' },
            transferFeeNgn: { type: 'number' },
            feeNgn: { type: 'number', description: 'Service fee + bank transfer fee + rounding down to whole naira' },
            payoutNgn: { type: 'number', description: 'What lands in the bank account' },
            minNim: { type: 'number' },
            maxNim: { type: 'number' },
            belowMinimum: { type: 'boolean' },
            aboveMaximum: { type: 'boolean' },
          },
        },
        Offramp: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            object: { const: 'offramp' },
            livemode: { type: 'boolean' },
            status: {
              type: 'string',
              enum: API_STATUSES,
              description:
                'awaiting_deposit → confirming → paying_out → completed. A payout that fails, or a deposit that is short or late, goes ' +
                'payout_failed → refunding → refunded. rejected: the reported transaction didn’t match; another deposit can still be sent. ' +
                'expired: no deposit before expiresAt (a late one is refunded).',
            },
            reference: nullable({ type: 'string' }),
            metadata: ref('Metadata'),
            nimAmount: { type: 'string' },
            rateNgnPerNim: { type: 'number' },
            grossNgn: { type: 'number' },
            feeNgn: { type: 'number' },
            payoutNgn: { type: 'number' },
            bankAccount: {
              type: 'object',
              properties: { bankCode: { type: 'string' }, bankName: { type: 'string' }, accountName: { type: 'string' }, accountNumberLast4: { type: 'string' } },
            },
            deposit: {
              type: 'object',
              description: 'Where and how to pay. The memo must be the transaction’s message.',
              properties: {
                address: { type: 'string' },
                memo: { type: 'string' },
                nimAmount: { type: 'string' },
                lunaAmount: { type: 'string', description: 'The same amount in Luna (1 NIM = 100,000 Luna)' },
                txHash: nullable({ type: 'string' }),
                from: nullable({ type: 'string' }),
                receivedNim: nullable({ type: 'string' }),
                confirmedAt: nullable({ type: 'string', format: 'date-time' }),
              },
            },
            refundAddress: nullable({ type: 'string' }),
            refund: nullable({
              type: 'object',
              properties: { nimAmount: { type: 'string' }, txHash: nullable({ type: 'string' }), sentAt: nullable({ type: 'string', format: 'date-time' }) },
            }),
            failureReason: nullable({ type: 'string' }),
            expiresAt: { type: 'string', format: 'date-time' },
            paidAt: nullable({ type: 'string', format: 'date-time' }),
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Event: {
          type: 'object',
          required: ['id', 'object', 'type', 'livemode', 'createdAt', 'data'],
          properties: {
            id: { type: 'string', format: 'uuid', description: 'Deduplicate on this: an event can arrive more than once.' },
            object: { const: 'event' },
            type: { type: 'string', enum: EVENT_TYPES },
            livemode: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            sample: { type: 'boolean', description: 'Only on test events' },
            data: ref('Offramp'),
          },
        },
        WebhookDelivery: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            type: { type: 'string' },
            livemode: { type: 'boolean' },
            orderId: nullable({ type: 'string' }),
            status: { type: 'string', enum: ['pending', 'delivered', 'failed', 'skipped'] },
            attempts: { type: 'integer' },
            nextAttemptAt: nullable({ type: 'string', format: 'date-time' }),
            deliveredAt: nullable({ type: 'string', format: 'date-time' }),
            lastError: nullable({ type: 'string' }),
            createdAt: { type: 'string', format: 'date-time' },
            payload: ref('Event'),
            deliveries: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  attempt: { type: 'integer' },
                  url: { type: 'string' },
                  statusCode: nullable({ type: 'integer' }),
                  error: nullable({ type: 'string' }),
                  responseBody: nullable({ type: 'string' }),
                  durationMs: { type: 'integer' },
                  createdAt: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
      },
    },
  }
}

function listOf(item: object, paged = true) {
  return {
    type: 'object',
    properties: {
      object: { const: 'list' },
      data: { type: 'array', items: item },
      ...(paged ? { hasMore: { type: 'boolean' }, nextCursor: nullable({ type: 'string' }) } : {}),
    },
  }
}
