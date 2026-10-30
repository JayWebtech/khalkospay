import { OfframpOrder, OfframpStatus } from '@prisma/client'
import { formatNim, treasuryAddress } from './nimiq'
import { SANDBOX_DEPOSIT_ADDRESS } from './sandbox'

/**
 * The off-ramp as partners see it through /v1 and in webhooks. Kept apart from services/offramp.ts so the webhook
 * outbox, which the engine calls inside its transactions, can build payloads without importing the engine.
 */

export const API_STATUSES = Object.values(OfframpStatus).map((s) => s.toLowerCase())

export type ApiStatus = Lowercase<OfframpStatus>

const koboToNgn = (k: bigint) => Number(k) / 100
const iso = (d: Date | null) => d?.toISOString() ?? null

export function depositAddressFor(order: Pick<OfframpOrder, 'livemode'>) {
  return treasuryAddress ?? (order.livemode ? null : SANDBOX_DEPOSIT_ADDRESS)
}

export function apiOfframpDto(order: OfframpOrder) {
  const confirmed = order.depositConfirmedAt !== null
  return {
    id: order.id,
    object: 'offramp' as const,
    livemode: order.livemode,
    status: order.status.toLowerCase() as ApiStatus,
    reference: order.partnerReference,
    metadata: (order.metadata ?? {}) as Record<string, string | number | boolean>,
    nimAmount: formatNim(order.nimLuna),
    rateNgnPerNim: Number(order.rateNgnPerNim),
    grossNgn: koboToNgn(order.grossKobo),
    feeNgn: koboToNgn(order.feeKobo),
    payoutNgn: koboToNgn(order.payoutKobo),
    bankAccount: {
      bankCode: order.bankCode,
      bankName: order.bankName,
      accountName: order.accountName,
      accountNumberLast4: order.accountNumber.slice(-4),
    },
    deposit: {
      address: depositAddressFor(order),
      memo: order.reference,
      nimAmount: formatNim(order.nimLuna),
      lunaAmount: order.nimLuna.toString(),
      txHash: order.depositTxHash,
      from: confirmed ? order.depositFrom : null,
      receivedNim: confirmed && order.receivedLuna !== null ? formatNim(order.receivedLuna) : null,
      confirmedAt: iso(order.depositConfirmedAt),
    },
    refundAddress: order.refundAddress,
    refund:
      (order.status === 'REFUNDING' || order.status === 'REFUNDED') && order.receivedLuna !== null
        ? { nimAmount: formatNim(order.receivedLuna), txHash: order.refundTxHash, sentAt: iso(order.refundSentAt) }
        : null,
    failureReason: order.failureReason,
    expiresAt: order.expiresAt.toISOString(),
    paidAt: iso(order.paidAt),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  }
}

export type ApiOfframp = ReturnType<typeof apiOfframpDto>
