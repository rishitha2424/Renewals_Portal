/**
 * Cross-platform clipboard helper supporting:
 * 1. navigator.clipboard.writeText (HTTPS / localhost)
 * 2. document.execCommand('copy') with hidden textarea fallback (HTTP on VM or older browsers)
 * Returns true if text was successfully copied, false otherwise.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false

  // 1. Try modern navigator.clipboard if available (works on localhost or HTTPS)
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch (_) {
      // Fall through to textarea execCommand fallback
    }
  }

  // 2. Fallback to hidden textarea with document.execCommand('copy')
  if (typeof document !== 'undefined') {
    try {
      const textArea = document.createElement('textarea')
      textArea.value = text
      // Avoid scrolling to bottom on mobile or page
      textArea.style.position = 'fixed'
      textArea.style.top = '-9999px'
      textArea.style.left = '-9999px'
      textArea.style.width = '2em'
      textArea.style.height = '2em'
      textArea.style.padding = '0'
      textArea.style.border = 'none'
      textArea.style.outline = 'none'
      textArea.style.boxShadow = 'none'
      textArea.style.background = 'transparent'
      textArea.style.opacity = '0'
      textArea.setAttribute('readonly', '')
      document.body.appendChild(textArea)
      textArea.focus()
      textArea.select()
      textArea.setSelectionRange(0, text.length)
      const successful = document.execCommand('copy')
      document.body.removeChild(textArea)
      if (successful) return true
    } catch (_) {
      // Fallback failed
    }
  }

  return false
}

export default copyToClipboard

