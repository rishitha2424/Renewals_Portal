/**
 * Central Overlay & Body Scroll-Lock Manager.
 * Prevents stacked modals/drawers from leaving `document.body.style.overflow = 'hidden'`
 * or transparent `fixed inset-0` blockers after closing, route changes, or errors.
 */

const activeScrollLocks = new Set<string>()
const registeredClosers = new Map<string, () => void>()

export function acquireBodyScrollLock(id: string): void {
  activeScrollLocks.add(id)
  if (typeof document !== 'undefined' && document.body) {
    document.body.style.overflow = 'hidden'
  }
}

export function releaseBodyScrollLock(id: string): void {
  activeScrollLocks.delete(id)
  if (typeof document !== 'undefined' && document.body && activeScrollLocks.size === 0) {
    document.body.style.overflow = ''
    document.body.style.pointerEvents = ''
  }
}

export function getActiveScrollLockCount(): number {
  return activeScrollLocks.size
}

export function registerOverlayCloser(id: string, onClose: () => void): () => void {
  registeredClosers.set(id, onClose)
  return () => {
    registeredClosers.delete(id)
  }
}

export function resetAllOverlays(): void {
  const closers = Array.from(registeredClosers.values())
  for (const fn of closers) {
    try {
      fn()
    } catch {
      // ignore individual cleanup errors
    }
  }
  activeScrollLocks.clear()
  if (typeof document !== 'undefined' && document.body) {
    document.body.style.overflow = ''
    document.body.style.pointerEvents = ''
  }
}

