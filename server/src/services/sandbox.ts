import { randomBytes } from 'node:crypto'
import { Address } from '@nimiq/core'
import { HttpError } from '../lib/http-error'
import type { Bank } from './paystack'

/**
 * Stand-ins for the partner API's sandbox (test keys). Nothing here reaches Paystack or the Nimiq network:
 * a fixed bank list, made-up account names, and random addresses and hashes for simulated transactions.
 */

export const SANDBOX_BANKS: Bank[] = [
  { code: '999992', name: 'OPay Digital Services Limited (OPay)', popular: true },
  { code: '50515', name: 'Moniepoint MFB', popular: true },
  { code: '058', name: 'Guaranty Trust Bank', popular: true },
  { code: '044', name: 'Access Bank', popular: true },
  { code: '057', name: 'Zenith Bank', popular: true },
  { code: '033', name: 'United Bank For Africa', popular: true },
  { code: '011', name: 'First Bank of Nigeria', popular: true },
  { code: '50211', name: 'Kuda Bank', popular: true },
  { code: '999991', name: 'PalmPay', popular: true },
  { code: '035', name: 'Wema Bank', popular: true },
]

/** In the sandbox this account number never resolves, to exercise the "account not found" path. */
export const SANDBOX_UNKNOWN_ACCOUNT = '0000000000'

export function sandboxResolveAccount(accountNumber: string, bankCode: string): string {
  if (!SANDBOX_BANKS.some((b) => b.code === bankCode)) throw new HttpError(400, 'This bank is not supported', 'INVALID_BANK')
  if (accountNumber === SANDBOX_UNKNOWN_ACCOUNT) {
    throw new HttpError(400, 'We could not verify this account number with the selected bank', 'ACCOUNT_NOT_FOUND')
  }
  return `Sandbox Account ${accountNumber.slice(-4)}`
}

export const randomSandboxAddress = () => new Address(randomBytes(20)).toUserFriendlyAddress()

export const randomSandboxHash = () => randomBytes(32).toString('hex')

/** Shown as the deposit address of sandbox orders on a server without a treasury. Never send real NIM to a sandbox order. */
export const SANDBOX_DEPOSIT_ADDRESS = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'
