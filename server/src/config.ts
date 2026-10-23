import 'dotenv/config'

function num(name: string, fallback: number) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`)
  return value
}

const network = process.env.NIMIQ_NETWORK === 'testnet' ? 'testnet' : 'mainnet'

export const config = {
  port: num('PORT', 3001),
  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  nimiq: {
    network,
    networkId: network === 'mainnet' ? 24 : 5,
    rpcUrl: process.env.NIMIQ_RPC_URL || (network === 'mainnet' ? 'https://rpc.nimiqwatch.com' : ''),
    treasuryPrivateKey: process.env.NIMIQ_TREASURY_PRIVATE_KEY || '',
    treasuryAddress: process.env.NIMIQ_TREASURY_ADDRESS || '',
    /** Gift escrow: holds gift NIM apart from the treasury, so gifts never count against NIM for sale. Gifts are off without it. */
    giftPrivateKey: process.env.NIMIQ_GIFT_PRIVATE_KEY || '',
    minConfirmations: num('NIMIQ_MIN_CONFIRMATIONS', 10),
  },
  offramp: {
    feeBps: num('OFFRAMP_FEE_BPS', 100),
    minPayoutNgn: num('OFFRAMP_MIN_PAYOUT_NGN', 100),
    maxPayoutNgn: num('OFFRAMP_MAX_PAYOUT_NGN', 500_000),
    quoteTtlSeconds: num('OFFRAMP_QUOTE_TTL_SECONDS', 600),
    depositGraceSeconds: num('OFFRAMP_DEPOSIT_GRACE_SECONDS', 300),
    depositLookupTimeoutSeconds: num('OFFRAMP_DEPOSIT_LOOKUP_TIMEOUT_SECONDS', 1800),
    rateOverride: process.env.RATE_OVERRIDE_NGN_PER_NIM || '',
  },
  gifts: {
    fundingTtlSeconds: num('GIFT_FUNDING_TTL_SECONDS', 3600),
    fundingLookupTimeoutSeconds: num('GIFT_FUNDING_LOOKUP_TIMEOUT_SECONDS', 1800),
    claimAttemptsPerCard: num('GIFT_CLAIM_ATTEMPTS_PER_CARD', 10),
    claimAttemptsPerIp: num('GIFT_CLAIM_ATTEMPTS_PER_IP', 30),
  },
  merchants: {
    /** How long a scan-to-pay payment waits for its transaction. A payment with its memo that lands later still counts. */
    paymentTtlSeconds: num('MERCHANT_PAYMENT_TTL_SECONDS', 1800),
    /** How long a reported transaction may stay unfound on chain before the payment goes back to unpaid. */
    paymentLookupTimeoutSeconds: num('MERCHANT_PAYMENT_LOOKUP_TIMEOUT_SECONDS', 1800),
    /** Payments that expired within this window still get their merchant's address scanned for the memo. */
    scanLookbackHours: num('MERCHANT_SCAN_LOOKBACK_HOURS', 48),
  },
  pets: {
    revivePriceNim: process.env.PET_REVIVE_NIM || '50',
    revivePaymentTtlSeconds: num('PET_REVIVE_PAYMENT_TTL_SECONDS', 1800),
    revivePaymentLookupTimeoutSeconds: num('PET_REVIVE_LOOKUP_TIMEOUT_SECONDS', 1800),
  },
  onramp: {
    feeBps: num('ONRAMP_FEE_BPS', 200),
    minUsd: num('ONRAMP_MIN_USD', 1),
    maxUsd: num('ONRAMP_MAX_USD', 500),
    checkoutTtlMinutes: num('ONRAMP_CHECKOUT_TTL_MINUTES', 30),
    /** NIM always kept back from sale, on top of what the treasury owes. */
    reserveNim: process.env.ONRAMP_RESERVE_NIM || '0',
    fxUrl: process.env.FX_RATES_URL || 'https://open.er-api.com/v6/latest/USD',
    usdPerNimOverride: process.env.ONRAMP_USD_PER_NIM_OVERRIDE || '',
  },
  bachs: {
    secretKey: process.env.BACHS_SECRET_KEY || '',
    webhookSecret: process.env.BACHS_WEBHOOK_SECRET || '',
    /** Live keys talk to production, everything else to the sandbox, unless overridden. */
    baseUrl:
      process.env.BACHS_BASE_URL ||
      ((process.env.BACHS_SECRET_KEY || '').startsWith('sk_live_') ? 'https://api.bachs.io' : 'https://sandbox-api.bachs.io'),
  },
  authSecret: process.env.AUTH_SECRET || '',
  /** Bearer token for the operator endpoints under /api/admin. Empty or shorter than 32 characters = those endpoints are off. */
  adminToken: process.env.ADMIN_TOKEN || '',
  /** How long an admin dashboard sign-in lasts. */
  adminSessionHours: num('ADMIN_SESSION_HOURS', 12),
  /**
   * Public host of the mini app (e.g. khalkospay.app): where Bachs sends buyers back to, and the host in gift email links.
   * The nimpay.app/miniapps/open/<host> link Nimiq Pay shares is accepted too; only <host> is kept, since that link 404s with a path on it.
   */
  miniAppUrl: (process.env.MINIAPP_URL || '')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^(www\.)?nimpay\.app\/miniapps\/open\//, '')
    .replace(/\/+$/, ''),
  resend: {
    apiKey: process.env.RESEND_API_KEY || '',
    from: process.env.RESEND_FROM || '',
    baseUrl: process.env.RESEND_BASE_URL || 'https://api.resend.com',
  },
  paystackSecretKey: process.env.PAYSTACK_SECRET_KEY || '',
  paystackBaseUrl: process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co',
  deepgramApiKey: process.env.DEEPGRAM_API_KEY || '',
  deepgramAgentUrl: process.env.DEEPGRAM_AGENT_URL || 'wss://agent.deepgram.com/v1/agent/converse',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
}
