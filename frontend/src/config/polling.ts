import { useEffect, useState } from 'react'

const envNum = (raw: string | undefined, fallback: number): number => {
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const envObj: Record<string, string | undefined> =
  typeof import.meta !== 'undefined' && (import.meta as any).env ? (import.meta as any).env : {}

export const POLL_CONFIG = {
  NOTIFICATIONS_MS: envNum(envObj.VITE_POLL_NOTIFICATIONS_MS, 60_000),
  THREADS_MS: envNum(envObj.VITE_POLL_THREADS_MS, 30_000),
  ACTIVE_THREAD_MS: envNum(envObj.VITE_POLL_ACTIVE_THREAD_MS, 15_000),
  EMAIL_OUTBOX_MS: envNum(envObj.VITE_POLL_EMAIL_OUTBOX_MS, 30_000),
  API_TIMEOUT_MS: envNum(envObj.VITE_API_TIMEOUT_MS, 25_000),
  SLOW_THRESHOLD_MS: envNum(envObj.VITE_SLOW_THRESHOLD_MS, 4_000),
  MAX_BACKOFF_MS: 300_000,
}

export function usePageVisible(): boolean {
  const [visible, setVisible] = useState<boolean>(() =>
    typeof document === 'undefined' ? true : document.visibilityState !== 'hidden'
  )

  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVisChange = () => {
      setVisible(document.visibilityState !== 'hidden')
    }
    document.addEventListener('visibilitychange', onVisChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisChange)
    }
  }, [])

  return visible
}

/**
 * Compute adaptive polling interval:
 * - Returns `false` when tab is hidden or disabled.
 * - Doubles interval on repeated consecutive errors up to MAX_BACKOFF_MS.
 */
export function getPollingInterval(
  baseMs: number,
  isVisible: boolean,
  failureCount = 0
): number | false {
  if (!isVisible || baseMs <= 0) return false
  if (failureCount <= 0) return baseMs
  const backedOff = baseMs * Math.pow(2, Math.min(failureCount, 4))
  return Math.min(backedOff, POLL_CONFIG.MAX_BACKOFF_MS)
}

