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
  paystackSecretKey: process.env.PAYSTACK_SECRET_KEY || '',
  paystackBaseUrl: process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co',
  deepgramApiKey: process.env.DEEPGRAM_API_KEY || '',
  deepgramAgentUrl: process.env.DEEPGRAM_AGENT_URL || 'wss://agent.deepgram.com/v1/agent/converse',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
}
