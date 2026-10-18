import { LogOut, RefreshCw } from 'lucide-react'
import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Spinner } from '@/components/ui/spinner'
import { formatNim, lunaToNim } from '@/lib/format'
import { useWallet } from '@/lib/wallet'
import { useWalletSession } from '@/lib/wallet-session'

/** Shows the one account KhalkosPay uses, the one Nimiq Pay pays from, and how to change it. */
export function AccountSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { address, network, balanceLuna, syncing, error } = useWallet()
  const connect = useWalletSession((s) => s.connect)
  const disconnect = useWalletSession((s) => s.disconnect)
  const signingIn = useWalletSession((s) => s.signingIn)

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle className="text-lg font-semibold">Your wallet</DrawerTitle>
          <DrawerDescription>
            KhalkosPay uses the account Nimiq Pay pays from, on <span className="font-medium text-foreground">{network}</span>.
          </DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col gap-3 px-4 py-2">
          {address && (
            <div className="flex items-center gap-2 rounded-2xl bg-muted/50 py-2 pr-2 pl-4">
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-sm break-all">{address}</span>
                <span className="block text-sm text-muted-foreground tabular-nums">
                  {balanceLuna !== null ? formatNim(lunaToNim(balanceLuna), 5) :syncing ? 'Nimiq Pay is still syncing' : 'Checking balance…'}
                </span>
              </span>
              <CopyButton value={address} label="Copy address" />
            </div>
          )}
          <p className="text-sm text-muted-foreground">To use another account, switch to it in Nimiq Pay, then tap Reconnect and sign.</p>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DrawerFooter className="pb-[max(env(safe-area-inset-bottom),1rem)]">
          <Button size="xl" variant="default" onClick={() => void connect()} disabled={signingIn}>
            {signingIn ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
            Reconnect
          </Button>
          <Button
            size="xl"
            variant="ghost"
            onClick={() => {
              disconnect()
              onOpenChange(false)
            }}
          >
            <LogOut data-icon="inline-start" />
            Disconnect
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
