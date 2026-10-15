import { ArrowUpRight, Mic } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'
import type { Order } from '@/lib/api'
import { formatNgn, formatNim, timeAgo } from '@/lib/format'
import { shortBankName, StatusBadge } from './order-status'

export function OrderList({ orders }: { orders: Order[] }) {
  return (
    <ItemGroup className="gap-1">
      {orders.map((order) => {
        const Icon = order.source === 'voice' ? Mic : ArrowUpRight
        return (
          <Item key={order.id} render={<Link to={`/cash-out/${order.id}`} />} className="rounded-xl px-2 py-2.5 hover:bg-muted">
            <ItemMedia className="size-10 rounded-full bg-accent text-accent-foreground">
              <Icon className="size-[1.125rem]" aria-label={order.source === 'voice' ? 'Voice cash-out' : 'Cash-out'} />
            </ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle className="truncate tabular-nums">
                {formatNgn(order.payoutNgn)} to {shortBankName(order.bankName)}
              </ItemTitle>
              <ItemDescription className="truncate tabular-nums">
                {formatNim(order.nimAmount)} · {timeAgo(order.createdAt)}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <StatusBadge status={order.status} />
            </ItemActions>
          </Item>
        )
      })}
    </ItemGroup>
  )
}
