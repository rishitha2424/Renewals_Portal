export const DESIGN_WIDTH = 1920
export const MIN_SCALE = 0.67
export const MAX_SCALE = 1.0

export type DisplaySizeOption = 'auto' | '100%' | '90%' | '80%' | '67%'

export const DISPLAY_SIZE_OPTIONS: { label: string; value: DisplaySizeOption; scale?: number }[] = [
  { label: 'Auto (fit to screen)', value: 'auto' },
  { label: '100%', value: '100%', scale: 1.0 },
  { label: '90%', value: '90%', scale: 0.9 },
  { label: '80%', value: '80%', scale: 0.8 },
  { label: '67%', value: '67%', scale: 0.67 },
]

const STORAGE_KEY = 'mobileum_display_size'

export function getSavedDisplaySize(): DisplaySizeOption {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && ['auto', '100%', '90%', '80%', '67%'].includes(saved)) {
      return saved as DisplaySizeOption
    }
  } catch (_) {
    // Fallback if localStorage is inaccessible
  }
  return 'auto'
}

export function saveDisplaySize(size: DisplaySizeOption): void {
  try {
    localStorage.setItem(STORAGE_KEY, size)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('display-size-change', { detail: size }))
    }
  } catch (_) {
    // Ignore quota or security exceptions
  }
}

/**
 * Computes scale factor: clamp(window.innerWidth / DESIGN_WIDTH, MIN_SCALE, MAX_SCALE)
 * rounded to 2 decimal places.
 */
export function computeScale(
  windowWidth: number = typeof window !== 'undefined' ? window.innerWidth : DESIGN_WIDTH,
  displaySize: DisplaySizeOption = getSavedDisplaySize()
): number {
  if (displaySize !== 'auto') {
    const match = DISPLAY_SIZE_OPTIONS.find((opt) => opt.value === displaySize)
    if (match?.scale) return match.scale
  }
  const raw = windowWidth / DESIGN_WIDTH
  const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw))
  return Math.round(clamped * 100) / 100
}

/**
 * Applies the scale to the root container with CSS zoom, or fallback transform.
 */
export function applyScale(scale: number): void {
  if (typeof document === 'undefined') return
  const root = document.getElementById('root')
  if (!root) return

  // Disable scaling during print
  if (window.matchMedia && window.matchMedia('print').matches) {
    (root.style as any).zoom = '1'
    root.style.transform = ''
    root.style.transformOrigin = ''
    root.style.width = '100%'
    return
  }

  const style = root.style as any
  if ('zoom' in style) {
    style.zoom = String(scale)
    style.transform = ''
    style.transformOrigin = ''
    style.width = '100%'
  } else {
    // Fallback for browsers without zoom
    style.transform = `scale(${scale})`
    style.transformOrigin = 'top left'
    style.width = `${(100 / scale).toFixed(2)}%`
  }

  document.documentElement.style.setProperty('--app-scale', String(scale))
}
