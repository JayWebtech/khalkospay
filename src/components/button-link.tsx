import type { VariantProps } from 'class-variance-authority'
import { Link, type LinkProps } from 'react-router-dom'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Navigation styled as a button, keeping link semantics for assistive tech. */
export function ButtonLink({ variant, size, className, ...props }: LinkProps & VariantProps<typeof buttonVariants>) {
  return <Link className={cn(buttonVariants({ variant, size }), 'motion-safe:active:scale-[0.96]', className)} {...props} />
}
