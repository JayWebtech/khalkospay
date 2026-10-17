import { NavLink, Route, Routes } from 'react-router-dom'
import { ActivityList } from '@/components/admin/activity-list'
import { Address, Amount, Muted, Reference } from '@/components/admin/cells'
import { Time } from '@/components/admin/detail-list'
import { humanize, StatusBadge } from '@/components/admin/status-badge'
import { AdminPageHeader } from '@/components/admin/page-header'
import { formatNim } from '@/lib/format'

interface AdminPet {
  id: string
  name: string
  species: string
  ownerAddress: string
  status: string
  strength: number
  level: number
  revivals: number
  mealsFed: number
  mealsMissed: number
  lastFedAt: string | null
  createdAt: string
}

interface AdminMeal {
  id: string
  petName: string
  ownerAddress: string
  day: string
  slot: string
  fed: boolean
  name: string | null
  score: number | null
  calories: number | null
  strengthDelta: number
  xpDelta: number
  createdAt: string
}

interface AdminRevival {
  id: string
  reference: string
  petName: string
  ownerAddress: string
  status: string
  priceNim: string
  receivedNim: string | null
  payer: string | null
  createdAt: string
}

interface AdminMealLog {
  id: string
  userId: string | null
  mealType: string
  name: string
  score: number
  calories: number
  createdAt: string
}

const tabs = [
  { to: '/admin/bitebuddy', label: 'Pets', end: true },
  { to: '/admin/bitebuddy/meals', label: 'Meals' },
  { to: '/admin/bitebuddy/revivals', label: 'Revivals' },
  { to: '/admin/bitebuddy/legacy', label: 'Legacy meal logs' },
]

const signed = (n: number) => (n > 0 ? `+${n}` : String(n))

export function AdminBiteBuddyPage() {
  return (
    <>
      <AdminPageHeader title="BiteBuddy" description="Pets that grow with the meals their owners photograph, and the paid revivals that bring them back." />
      <nav aria-label="BiteBuddy lists" className="mb-4 flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg bg-muted p-[3px]">
        {tabs.map(({ to, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className="rounded-md px-3 py-1 text-sm font-medium whitespace-nowrap text-foreground/60 transition-colors hover:text-foreground aria-[current=page]:bg-background aria-[current=page]:text-foreground aria-[current=page]:shadow-sm"
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<PetsList />} />
        <Route path="meals" element={<MealsList />} />
        <Route path="revivals" element={<RevivalsList />} />
        <Route path="legacy" element={<MealLogsList />} />
      </Routes>
    </>
  )
}

function PetsList() {
  return (
    <ActivityList<AdminPet>
      endpoint="/api/admin/pets"
      statuses={['ALIVE', 'DEAD']}
      noun={['pet', 'pets']}
      searchPlaceholder="Search name, species or owner"
      columns={[
        { header: 'Adopted', cell: (p) => <Time iso={p.createdAt} /> },
        { header: 'Pet', cell: (p) => <span className="whitespace-nowrap">{p.name} <Muted>· {humanize(p.species)}</Muted></span> },
        { header: 'Status', cell: (p) => <StatusBadge status={p.status} /> },
        { header: 'Strength', className: 'text-right', cell: (p) => <Amount>{p.strength}</Amount> },
        { header: 'Level', className: 'text-right', cell: (p) => <Amount>{p.level}</Amount> },
        { header: 'Meals fed / missed', className: 'text-right', cell: (p) => <Amount>{p.mealsFed} / {p.mealsMissed}</Amount> },
        { header: 'Last fed', cell: (p) => <Time iso={p.lastFedAt} /> },
        { header: 'Revivals', className: 'text-right', cell: (p) => <Amount>{p.revivals}</Amount> },
        { header: 'Owner', cell: (p) => <Address value={p.ownerAddress} /> },
      ]}
    />
  )
}

function MealsList() {
  return (
    <ActivityList<AdminMeal>
      endpoint="/api/admin/pets/meals"
      statuses={['BREAKFAST', 'LUNCH', 'DINNER']}
      allLabel="All meals"
      noun={['meal', 'meals']}
      searchPlaceholder="Search meal, pet or owner"
      columns={[
        { header: 'Logged', cell: (m) => <Time iso={m.createdAt} /> },
        { header: 'Pet', cell: (m) => m.petName },
        { header: 'Window', cell: (m) => <span className="whitespace-nowrap">{humanize(m.slot)} <Muted>· {m.day}</Muted></span> },
        { header: 'Meal', cell: (m) => (m.fed ? (m.name ?? 'Fed') : <Muted>Missed</Muted>) },
        { header: 'Score', className: 'text-right', cell: (m) => <Amount>{m.score ?? '—'}</Amount> },
        { header: 'Calories', className: 'text-right', cell: (m) => <Amount>{m.calories === null ? '—' : Math.round(m.calories)}</Amount> },
        { header: 'Strength', className: 'text-right', cell: (m) => <Amount>{signed(m.strengthDelta)}</Amount> },
        { header: 'XP', className: 'text-right', cell: (m) => <Amount>{signed(m.xpDelta)}</Amount> },
        { header: 'Owner', cell: (m) => <Address value={m.ownerAddress} /> },
      ]}
    />
  )
}

function RevivalsList() {
  return (
    <ActivityList<AdminRevival>
      endpoint="/api/admin/pets/revivals"
      statuses={['AWAITING_PAYMENT', 'PAID', 'EXPIRED', 'REFUNDING', 'REFUNDED']}
      noun={['revival', 'revivals']}
      searchPlaceholder="Search reference, payer, owner or tx"
      columns={[
        { header: 'Created', cell: (r) => <Time iso={r.createdAt} /> },
        { header: 'Reference', cell: (r) => <Reference value={r.reference} /> },
        { header: 'Pet', cell: (r) => r.petName },
        { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
        { header: 'Price', cell: (r) => <Amount>{formatNim(r.priceNim)}</Amount> },
        { header: 'Received', cell: (r) => <Amount>{r.receivedNim === null ? '—' : formatNim(r.receivedNim)}</Amount> },
        { header: 'Owner', cell: (r) => <Address value={r.ownerAddress} /> },
      ]}
    />
  )
}

function MealLogsList() {
  return (
    <ActivityList<AdminMealLog>
      endpoint="/api/admin/meal-logs"
      statuses={[]}
      noun={['meal log', 'meal logs']}
      searchPlaceholder="Search meal, type or user"
      columns={[
        { header: 'Logged', cell: (m) => <Time iso={m.createdAt} /> },
        { header: 'Meal', cell: (m) => m.name },
        { header: 'Type', cell: (m) => m.mealType },
        { header: 'Score', className: 'text-right', cell: (m) => <Amount>{m.score}</Amount> },
        { header: 'Calories', className: 'text-right', cell: (m) => <Amount>{Math.round(m.calories)}</Amount> },
        { header: 'User', cell: (m) => m.userId ?? <Muted>—</Muted> },
      ]}
    />
  )
}
