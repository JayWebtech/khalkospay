import { Wallet } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useWallet } from '@/lib/wallet'

/** Explains what's missing before the user can pay, and offers the one action that fixes it. */
export function WalletNotice({ purpose }: { purpose: string }) {
  const { status, connect, error } = useWallet()

  if (status === 'unavailable') {
    return (
      <Alert>
        <Wallet />
        <AlertTitle>Open KhalkosPay in Nimiq Pay</AlertTitle>
        <AlertDescription>Your wallet lives in the Nimiq Pay app. You can explore here, but {purpose} needs Nimiq Pay.</AlertDescription>
      </Alert>
    )
  }

  if (status === 'disconnected' || status === 'connecting') {
    return (
      <Alert>
        <Wallet />
        <AlertTitle>Connect your wallet</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-3">
          <span>KhalkosPay needs your Nimiq address for {purpose}. You'll confirm in Nimiq Pay.</span>
          {error && <span className="text-destructive">{error}</span>}
          <Button size="lg" onClick={() => void connect()} disabled={status === 'connecting'}>
            {status === 'connecting' ? <Spinner data-icon="inline-start" /> : <Wallet data-icon="inline-start" />}
            Connect wallet
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  return null
}
