import { Check, Copy, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/utils'

const iconClass =
  'absolute inset-0 size-4 transition-[opacity,scale,filter] duration-300 ease-[cubic-bezier(0.2,0,0,1)]'

const hidden = 'opacity-0 motion-safe:scale-25 motion-safe:blur-[4px]'

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [result, setResult] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    if (result === 'idle') return
    const timer = setTimeout(() => setResult('idle'), result === 'failed' ? 2_500 : 1_500)
    return () => clearTimeout(timer)
  }, [result])

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-11 shrink-0"
      aria-label={result === 'copied' ? 'Copied' : result === 'failed' ? "Couldn't copy. Press and hold the text to copy it." : label}
      title={result === 'failed' ? "Couldn't copy. Press and hold the text to copy it." : undefined}
      onClick={() => {
        void copyText(value).then((ok) => setResult(ok ? 'copied' : 'failed'))
      }}
    >
      <span className="relative size-4">
        <Copy className={cn(iconClass, result === 'idle' ? 'opacity-100' : hidden)} />
        <Check className={cn(iconClass, result === 'copied' ? 'opacity-100' : hidden)} />
        <X className={cn(iconClass, 'text-destructive', result === 'failed' ? 'opacity-100' : hidden)} />
      </span>
    </Button>
  )
}
