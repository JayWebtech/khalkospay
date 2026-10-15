import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const iconClass =
  'absolute inset-0 size-4 transition-[opacity,scale,filter] duration-300 ease-[cubic-bezier(0.2,0,0,1)]'

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1_500)
    return () => clearTimeout(timer)
  }, [copied])

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-11 shrink-0"
      aria-label={copied ? 'Copied' : label}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => setCopied(true))
      }}
    >
      <span className="relative size-4">
        <Copy className={cn(iconClass, copied ? 'opacity-0 motion-safe:scale-25 motion-safe:blur-[4px]' : 'opacity-100')} />
        <Check className={cn(iconClass, copied ? 'opacity-100' : 'opacity-0 motion-safe:scale-25 motion-safe:blur-[4px]')} />
      </span>
    </Button>
  )
}
