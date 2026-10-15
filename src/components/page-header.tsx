import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'

export function PageHeader({
  title,
  description,
  back,
  action,
}: {
  title: string
  description?: string
  back?: string
  action?: ReactNode
}) {
  const navigate = useNavigate()
  return (
    <header className="flex min-h-16 items-center gap-1 px-4 pt-[max(env(safe-area-inset-top),0.5rem)]">
      {back && (
        <Button variant="ghost" size="icon-xl" className="-ml-3" aria-label="Back" onClick={() => navigate(back)}>
          <ChevronLeft />
        </Button>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="truncate text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </header>
  )
}
