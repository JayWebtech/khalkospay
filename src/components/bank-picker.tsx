import { Check, ChevronDown, Landmark, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Item, ItemContent, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import type { Bank } from '@/lib/api'
import { cn } from '@/lib/utils'

export function BankPicker({
  id,
  banks,
  value,
  onChange,
}: {
  id?: string
  banks: Bank[] | null
  value: string | null
  onChange: (bank: Bank) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const selected = banks?.find((b) => b.code === value)

  const groups = useMemo(() => {
    if (!banks) return []
    const q = query.trim().toLowerCase()
    if (q) return [{ title: 'Results', banks: banks.filter((b) => b.name.toLowerCase().includes(q)) }]
    return [
      { title: 'Popular', banks: banks.filter((b) => b.popular) },
      { title: 'All banks', banks: banks.filter((b) => !b.popular) },
    ]
  }, [banks, query])

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery('')
      }}
    >
      <DrawerTrigger
        render={
          <Button id={id} variant="outline" size="xl" className="w-full justify-between rounded-xl border-input px-3.5 font-normal" />
        }
      >
        <span className={cn('truncate', !selected && 'text-muted-foreground')}>{selected?.name ?? 'Choose your bank'}</span>
        <ChevronDown data-icon="inline-end" className="text-muted-foreground" />
      </DrawerTrigger>
      <DrawerContent className="h-[88dvh]">
        <DrawerHeader>
          <DrawerTitle className="text-lg font-semibold">Choose your bank</DrawerTitle>
        </DrawerHeader>
        <div className="px-4 pt-3 pb-2">
          <InputGroup>
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              placeholder="Search 250+ Nigerian banks"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search banks"
            />
          </InputGroup>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-[max(env(safe-area-inset-bottom),1rem)]">
          {!banks && (
            <div className="flex flex-col gap-2 p-2">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-12 rounded-xl" />
              ))}
            </div>
          )}
          {groups.map(
            (group) =>
              group.banks.length > 0 && (
                <section key={group.title} aria-label={group.title}>
                  <h3 className="px-3 pt-3 pb-1 text-xs font-medium text-muted-foreground">{group.title}</h3>
                  <ItemGroup className="gap-0">
                    {group.banks.map((bank) => (
                      <Item
                        key={bank.code}
                        render={<button type="button" />}
                        className="min-h-12 w-full rounded-xl py-2 text-left hover:bg-muted"
                        onClick={() => {
                          onChange(bank)
                          setOpen(false)
                          setQuery('')
                        }}
                        aria-pressed={bank.code === value}
                      >
                        <ItemMedia variant="icon" className="size-8 rounded-full bg-muted text-muted-foreground">
                          <Landmark />
                        </ItemMedia>
                        <ItemContent>
                          <ItemTitle className="font-normal">{bank.name}</ItemTitle>
                        </ItemContent>
                        {bank.code === value && <Check className="size-4 text-primary" aria-hidden="true" />}
                      </Item>
                    ))}
                  </ItemGroup>
                </section>
              ),
          )}
          {banks && groups.every((g) => g.banks.length === 0) && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No bank matches “{query}”</EmptyTitle>
                <EmptyDescription>Try the short name, like GTBank or OPay.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
