import { Check, LogOut, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Spinner } from '@/components/ui/spinner'
import { formatNim, lunaToNim, shortAddress } from '@/lib/format'
import { cn } from '@/lib/utils'
import { balanceOf, sameAddress, useWallet } from '@/lib/wallet'

/** Shows which account and network the balance comes from, and lets the user switch between the accounts Nimiq Pay shared. */
export function AccountSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { provider, address, accounts, network, connect, chooseAccount, disconnect, error } = useWallet()
  const list = accounts.length > 0 ? accounts : address ? [address] : []
  const listKey = list.join('|')
  const [balances, setBalances] = useState<Record<string, number | null | undefined>>({})
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (!open) return
    let alive = true
    setBalances({})
    for (const a of listKey.split('|').filter(Boolean)) {
      void balanceOf(provider, a).then((b) => alive && setBalances((s) => ({ ...s, [a]: b })))
    }
    return () => {
      alive = false
    }
  }, [open, provider, listKey])

  async function refresh() {
    setRefreshing(true)
    try {
      await connect()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle className="text-lg font-semibold">Your wallet</DrawerTitle>
          <DrawerDescription>
            Nimiq Pay is on <span className="font-medium text-foreground">{network}</span>. Balances below are read from that network.
          </DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col gap-2 px-4 py-2">
          <div role="radiogroup" aria-label="Accounts" className="flex flex-col gap-2">
            {list.map((a) => {
              const selected = sameAddress(a, address)
              const luna = balances[a]
              return (
                <button
                  key={a}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    chooseAccount(a)
                    onOpenChange(false)
                  }}
                  className={cn(
                    'flex min-h-14 items-center gap-3 rounded-2xl bg-muted/50 px-4 py-2 text-left ring-1 ring-transparent transition-[scale] motion-safe:active:scale-[0.98]',
                    selected && 'bg-accent ring-primary/50',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-sm">{shortAddress(a)}</span>
                    <span className="block text-sm text-muted-foreground tabular-nums">
                      {luna === undefined ? 'Checking balance…' : luna === null ? "Balance isn't available yet" : formatNim(lunaToNim(luna), 5)}
                    </span>
                  </span>
                  {selected && <Check className="size-5 shrink-0 text-primary" aria-hidden="true" />}
                </button>
              )
            })}
          </div>
          <p className="text-sm text-muted-foreground">Don't see the account with your NIM? Refresh the list and pick it in Nimiq Pay.</p>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DrawerFooter className="pb-[max(env(safe-area-inset-bottom),1rem)]">
          <Button size="xl" variant="default" onClick={() => void refresh()} disabled={refreshing}>
            {refreshing ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
            Refresh accounts from Nimiq Pay
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
