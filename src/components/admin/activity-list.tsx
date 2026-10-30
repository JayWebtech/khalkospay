import { ChevronRight, RefreshCw, Search } from 'lucide-react'
import { Fragment, type ReactNode, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { DetailList } from '@/components/admin/detail-list'
import { humanize } from '@/components/admin/status-badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { adminApi, type Page } from '@/lib/admin'
import { cn } from '@/lib/utils'

export interface Column<T> {
  header: string
  cell: (row: T) => ReactNode
  className?: string
}

const ALL = '__all'
const PAGE_SIZE = 50

/**
 * A filterable, newest-first activity table. Status and search live in the URL, so a filtered view can be
 * linked to. Rows expand to every field of the record (or `renderDetail`).
 */
export function ActivityList<T extends { id: string }>({
  endpoint,
  statuses,
  allLabel = 'All statuses',
  columns,
  searchPlaceholder,
  renderDetail,
  unpaged,
  noun,
}: {
  endpoint: string
  statuses: readonly string[]
  allLabel?: string
  columns: Column<T>[]
  searchPlaceholder: string
  renderDetail?: (row: T, reload: () => void) => ReactNode
  /** For endpoints that return a plain array (newest 100): search runs here instead of on the server. */
  unpaged?: { search: (row: T, q: string) => boolean }
  noun: [one: string, many: string]
}) {
  const [params, setParams] = useSearchParams()
  const status = params.get('status') ?? ''
  const q = params.get('q') ?? ''
  const [draft, setDraft] = useState(q)
  const [items, setItems] = useState<T[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const setParam = useCallback(
    (key: string, value: string) =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p)
          if (value) next.set(key, value)
          else next.delete(key)
          return next
        },
        { replace: true },
      ),
    [setParams],
  )

  useEffect(() => {
    if (draft.trim() === q) return
    const t = setTimeout(() => setParam('q', draft.trim()), 300)
    return () => clearTimeout(t)
  }, [draft, q, setParam])

  const serverPaged = unpaged === undefined
  const url = useCallback(
    (cursor: string | null) => {
      const search = new URLSearchParams()
      if (status) search.set('status', status)
      if (serverPaged) {
        if (q) search.set('q', q)
        search.set('limit', String(PAGE_SIZE))
        if (cursor) search.set('cursor', cursor)
      }
      const qs = search.toString()
      return qs ? `${endpoint}${endpoint.includes('?') ? '&' : '?'}${qs}` : endpoint
    },
    [endpoint, status, q, serverPaged],
  )

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    adminApi<Page<T> | T[]>(url(null), { signal: controller.signal })
      .then((body) => {
        const page = Array.isArray(body) ? { items: body, nextCursor: null } : body
        setItems(page.items)
        setNextCursor(page.nextCursor)
        setError(null)
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError(e instanceof Error ? e.message : 'Could not load this list')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [url, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])

  async function loadMore() {
    if (!nextCursor) return
    setLoadingMore(true)
    try {
      const page = await adminApi<Page<T>>(url(nextCursor))
      setItems((prev) => [...prev, ...page.items])
      setNextCursor(page.nextCursor)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load more')
    } finally {
      setLoadingMore(false)
    }
  }

  const visible = unpaged && q ? items.filter((row) => unpaged.search(row, q.toLowerCase())) : items

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="h-9 rounded-lg pl-9"
          />
        </div>
        {statuses.length > 0 && (
          <Select
            value={status || ALL}
            onValueChange={(v) => setParam('status', v === ALL || v === null ? '' : String(v))}
            items={[{ value: ALL, label: allLabel }, ...statuses.map((s) => ({ value: s, label: humanize(s) }))]}
          >
            <SelectTrigger className="h-9 min-w-44" aria-label="Filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{allLabel}</SelectItem>
              {statuses.map((s) => (
                <SelectItem key={s} value={s}>
                  {humanize(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button variant="outline" size="lg" onClick={reload} disabled={loading} aria-label="Refresh">
          <RefreshCw className={cn(loading && 'animate-spin')} aria-hidden="true" />
          <span className="max-sm:sr-only">Refresh</span>
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="overflow-x-auto rounded-xl bg-card ring-1 ring-foreground/10">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="w-9" aria-label="Details" />
              {columns.map((c) => (
                <th key={c.header} className={cn('px-3 py-2.5 text-left font-medium whitespace-nowrap', c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0
              ? Array.from({ length: 4 }, (_, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td colSpan={columns.length + 1} className="px-3 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  </tr>
                ))
              : visible.map((row) => {
                  const expanded = open === row.id
                  return (
                    <Fragment key={row.id}>
                      <tr
                        className={cn('cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/50', expanded && 'bg-muted/40')}
                        onClick={() => setOpen(expanded ? null : row.id)}
                      >
                        <td className="pl-2">
                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-label={expanded ? 'Hide details' : 'Show details'}
                            className="flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                          >
                            <ChevronRight className={cn('size-4 transition-transform', expanded && 'rotate-90')} aria-hidden="true" />
                          </button>
                        </td>
                        {columns.map((c) => (
                          <td key={c.header} className={cn('px-3 py-2.5 align-middle', c.className)}>
                            {c.cell(row)}
                          </td>
                        ))}
                      </tr>
                      {expanded && (
                        <tr className="border-b bg-muted/20 last:border-0">
                          <td colSpan={columns.length + 1} className="px-4 py-4">
                            {renderDetail ? renderDetail(row, reload) : <DetailList data={row} />}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-10 text-center text-muted-foreground">
                  {q || status ? `No ${noun[1]} match these filters.` : `No ${noun[1]} yet.`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          {visible.length.toLocaleString()} {noun[visible.length === 1 ? 0 : 1]} shown{unpaged ? ' (newest 100)' : ''}
        </span>
        {nextCursor && (
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore && <Spinner />}
            Load more
          </Button>
        )}
      </div>
    </div>
  )
}
