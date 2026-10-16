import neonWaves from '@/assets/cards/card-1.png'
import marble from '@/assets/cards/card-2.png'
import emberWaves from '@/assets/cards/card-3.png'
import midnight from '@/assets/cards/card-4.png'
import electric from '@/assets/cards/card-5.png'
import celebrate from '@/assets/cards/gift-1.png'
import sunset from '@/assets/cards/gift-2.png'
import giftBoxes from '@/assets/cards/gift-3.png'
import leaves from '@/assets/cards/gift-4.png'
import festive from '@/assets/cards/gift-5.png'
import tropical from '@/assets/cards/gift-6.png'

/**
 * Card designs. The first six ids predate the artwork and are stored on existing gifts, so they keep
 * their ids and get the closest-fitting image; occasion designs keep their emoji on the card.
 */
export const GIFT_TEMPLATES = [
  { id: 'default', label: 'Classic', image: giftBoxes, emoji: null },
  { id: 'birthday', label: 'Birthday', image: neonWaves, emoji: '🎂' },
  { id: 'love', label: 'Love', image: emberWaves, emoji: '❤️' },
  { id: 'thank_you', label: 'Thanks', image: leaves, emoji: '🙏' },
  { id: 'congrats', label: 'Congrats', image: celebrate, emoji: '🎉' },
  { id: 'holiday', label: 'Holiday', image: festive, emoji: null },
  { id: 'midnight', label: 'Midnight', image: midnight, emoji: null },
  { id: 'marble', label: 'Marble', image: marble, emoji: null },
  { id: 'electric', label: 'Electric', image: electric, emoji: null },
  { id: 'sunset', label: 'Sunset', image: sunset, emoji: null },
  { id: 'tropical', label: 'Tropical', image: tropical, emoji: null },
] as const

export type GiftTemplateId = (typeof GIFT_TEMPLATES)[number]['id']
export type GiftTemplate = (typeof GIFT_TEMPLATES)[number]

export function giftTemplate(id: string | undefined): GiftTemplate {
  return GIFT_TEMPLATES.find((t) => t.id === id) ?? GIFT_TEMPLATES[0]
}
