import type { ReactNode } from 'react'

export function AdminPageHeader({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-pretty text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  )
}
