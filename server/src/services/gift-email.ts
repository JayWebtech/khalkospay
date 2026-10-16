import type { GiftCard } from '@prisma/client'
import { config } from '../config'
import { escapeHtml } from './email'
import { formatNim } from './nimiq'

/** Opens the gift inside Nimiq Pay; null until MINIAPP_URL says where KhalkosPay is hosted. */
export function giftMiniAppLink(card: Pick<GiftCard, 'id'>): string | null {
  return config.miniAppUrl ? `https://nimpay.app/miniapps/open/${config.miniAppUrl}/gift/${card.id}` : null
}

/** The "you got a gift" email: who it's from (unless anonymous), how much, the link and the gift code. Never the secret code. */
export function giftEmail(card: GiftCard, shareCode: string | null) {
  const from = card.anonymous ? null : card.senderName
  const who = from ?? 'Someone'
  const amount = `${formatNim(card.receivedLuna ?? card.amountLuna)} NIM`
  const link = giftMiniAppLink(card)
  const secretFrom = from ? escapeHtml(from) : 'the sender'

  const subject = `${who} sent you a gift on KhalkosPay`
  const text = [
    `${who} sent you ${amount} on KhalkosPay.`,
    ...(card.message ? ['', `"${card.message}"`] : []),
    '',
    ...(link ? ['Open it in Nimiq Pay:', link, ''] : []),
    ...(shareCode ? [`${link ? 'Or open' : 'Open'} KhalkosPay in Nimiq Pay, go to Gifts and enter gift code ${shareCode}.`, ''] : []),
    `To claim it you'll also need the secret code from ${from ?? 'the sender'}. KhalkosPay will never ask for your recovery words.`,
  ].join('\n')

  const button = link
    ? `<tr><td style="padding:8px 0 4px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#b5651d;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:14px 22px;border-radius:12px">Open in Nimiq Pay</a></td></tr>`
    : ''
  const codeBlock = shareCode
    ? `<tr><td style="padding:16px 0 0;color:#5c524b;font-size:14px;line-height:20px">${link ? 'Or open' : 'Open'} KhalkosPay in Nimiq Pay, go to <strong>Gifts</strong> and enter this gift code:</td></tr>
       <tr><td style="padding:8px 0 0"><span style="display:inline-block;font-family:ui-monospace,Menlo,monospace;font-size:20px;font-weight:700;letter-spacing:2px;background:#f5efe8;color:#2b1b17;padding:10px 16px;border-radius:10px">${escapeHtml(shareCode)}</span></td></tr>`
    : ''

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f7f3ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<span style="display:none;max-height:0;overflow:hidden">${escapeHtml(who)} sent you ${escapeHtml(amount)}. You'll need their secret code to claim it.</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f3ee;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:20px;padding:28px">
  <tr><td style="font-size:14px;font-weight:600;color:#b5651d;padding-bottom:16px">KhalkosPay</td></tr>
  <tr><td style="font-size:24px;line-height:30px;font-weight:700;color:#2b1b17">${escapeHtml(who)} sent you a gift</td></tr>
  <tr><td style="font-size:36px;line-height:44px;font-weight:700;color:#2b1b17;padding:12px 0 4px">${escapeHtml(amount)}</td></tr>
  ${card.message ? `<tr><td style="font-size:16px;line-height:24px;font-style:italic;color:#5c524b;padding:4px 0 12px">“${escapeHtml(card.message)}”</td></tr>` : ''}
  ${button}
  ${codeBlock}
  <tr><td style="padding:20px 0 0;color:#5c524b;font-size:14px;line-height:20px">To claim it you'll also need the secret code from ${secretFrom}. KhalkosPay will never ask for your wallet's recovery words.</td></tr>
</table>
<p style="max-width:480px;color:#8a7f77;font-size:12px;line-height:18px;margin:16px auto 0">You're getting this because ${card.anonymous ? 'someone' : escapeHtml(who)} sent a KhalkosPay gift to this address.</p>
</td></tr></table>
</body></html>`

  return { to: card.recipientEmail!, subject, html, text, idempotencyKey: `khalkos-gift-email-${card.id}` }
}
