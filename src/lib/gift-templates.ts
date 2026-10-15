// Card artwork is decorative content, so each design carries its own gradient rather than a UI token.
export const GIFT_TEMPLATES = [
  { id: 'default', label: 'Classic', emoji: '🎁', art: 'bg-linear-to-br from-orange-700 via-amber-800 to-stone-900' },
  { id: 'birthday', label: 'Birthday', emoji: '🎂', art: 'bg-linear-to-br from-pink-600 via-rose-700 to-fuchsia-900' },
  { id: 'love', label: 'Love', emoji: '❤️', art: 'bg-linear-to-br from-rose-600 via-red-700 to-red-950' },
  { id: 'thank_you', label: 'Thanks', emoji: '🙏', art: 'bg-linear-to-br from-amber-600 via-orange-700 to-amber-950' },
  { id: 'congrats', label: 'Congrats', emoji: '🎉', art: 'bg-linear-to-br from-emerald-600 via-teal-700 to-emerald-950' },
  { id: 'holiday', label: 'Holiday', emoji: '🎄', art: 'bg-linear-to-br from-green-700 via-emerald-800 to-red-900' },
] as const

export type GiftTemplateId = (typeof GIFT_TEMPLATES)[number]['id']

export function giftTemplate(id: string | undefined) {
  return GIFT_TEMPLATES.find((t) => t.id === id) ?? GIFT_TEMPLATES[0]
}
