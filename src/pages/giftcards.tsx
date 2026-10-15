import { Gift, Plus } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { ButtonLink } from '@/components/button-link'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'

export function GiftCardsPage() {
  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Gift cards"
        description="Wrap NIM with a message"
        back="/"
        action={
          <ButtonLink to="/gifts/new" size="lg">
            <Plus data-icon="inline-start" />
            New
          </ButtonLink>
        }
      />
      <div className="flex flex-1 flex-col px-4 pt-2 pb-6">
        <Empty className="rounded-3xl border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon" className="size-12 rounded-2xl bg-accent text-accent-foreground [&_svg]:size-6">
              <Gift />
            </EmptyMedia>
            <EmptyTitle>Send your first gift</EmptyTitle>
            <EmptyDescription>Pick a design, add NIM and a note, then share the link. They claim it with your secret code.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <ButtonLink to="/gifts/new" size="xl">
              Create gift card
            </ButtonLink>
          </EmptyContent>
        </Empty>
      </div>
    </div>
  )
}
