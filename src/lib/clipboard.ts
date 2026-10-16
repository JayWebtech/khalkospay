/**
 * Copies text, including inside Nimiq Pay's WebView. A mini app loaded over plain http (a LAN dev server)
 * isn't a secure context, so navigator.clipboard doesn't exist there; fall back to a hidden textarea and
 * execCommand, which WebViews still honour during a tap.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Permission denied or unsupported; try the fallback below.
  }

  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  // 16px stops iOS from zooming in on focus; keep it on-screen but invisible so selection works.
  Object.assign(area.style, { position: 'fixed', top: '0', left: '0', opacity: '0', fontSize: '16px', pointerEvents: 'none' })
  document.body.appendChild(area)
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
  try {
    area.focus()
    area.select()
    area.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
    previous?.focus({ preventScroll: true })
  }
}
