import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { Drawer } from '@/components/ui/Drawer'
import {
  acquireBodyScrollLock,
  releaseBodyScrollLock,
  getActiveScrollLockCount,
  registerOverlayCloser,
  resetAllOverlays,
} from '@/utils/overlayManager'
import { getPollingInterval, POLL_CONFIG } from '@/config/polling'
import api from '@/api/client'
import { useConnectionStore } from '@/store/connectionStore'

describe('Overlay & Freeze Protections', () => {
  beforeEach(() => {
    resetAllOverlays()
    useConnectionStore.getState().clearWatchdog()
    document.body.style.overflow = ''
    document.body.style.pointerEvents = ''
  })

  afterEach(() => {
    cleanup()
    resetAllOverlays()
  })

  it('restores body scroll lock cleanly across nested overlays and unmounts', () => {
    acquireBodyScrollLock('modal-1')
    expect(document.body.style.overflow).toBe('hidden')
    expect(getActiveScrollLockCount()).toBe(1)

    acquireBodyScrollLock('modal-2')
    expect(getActiveScrollLockCount()).toBe(2)

    // Closing one nested overlay keeps lock until the second closes
    releaseBodyScrollLock('modal-1')
    expect(document.body.style.overflow).toBe('hidden')

    releaseBodyScrollLock('modal-2')
    expect(document.body.style.overflow).toBe('')
    expect(document.body.style.pointerEvents).toBe('')
    expect(getActiveScrollLockCount()).toBe(0)
  })

  it('cleans up Drawer overlay, backdrop, and scroll lock on close and unmount', () => {
    const onClose = vi.fn()
    const { rerender, unmount } = render(
      <MemoryRouter>
        <Drawer isOpen={true} onClose={onClose} title="Test Deal">
          <div>Drawer Body</div>
        </Drawer>
      </MemoryRouter>
    )

    expect(document.body.style.overflow).toBe('hidden')
    expect(document.body.textContent).toContain('Drawer Body')

    rerender(
      <MemoryRouter>
        <Drawer isOpen={false} onClose={onClose} title="Test Deal">
          <div>Drawer Body</div>
        </Drawer>
      </MemoryRouter>
    )
    expect(document.body.style.overflow).toBe('')
    expect(document.body.textContent).not.toContain('Drawer Body')

    // Reopen then unmount directly (simulating route navigation / error unmount)
    rerender(
      <MemoryRouter>
        <Drawer isOpen={true} onClose={onClose} title="Test Deal">
          <div>Drawer Body</div>
        </Drawer>
      </MemoryRouter>
    )
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('')
    expect(getActiveScrollLockCount()).toBe(0)
  })

  it('resetAllOverlays closes registered overlays and restores body styles', () => {
    const closeSpy = vi.fn()
    acquireBodyScrollLock('stuck-modal')
    registerOverlayCloser('stuck-modal', closeSpy)
    document.body.style.pointerEvents = 'none'

    resetAllOverlays()
    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(document.body.style.overflow).toBe('')
    expect(document.body.style.pointerEvents).toBe('')
  })

  it('pauses polling when tab is hidden and applies exponential backoff on errors', () => {
    expect(getPollingInterval(POLL_CONFIG.THREADS_MS, false, 0)).toBe(false)
    expect(getPollingInterval(POLL_CONFIG.THREADS_MS, false, 3)).toBe(false)
    expect(getPollingInterval(POLL_CONFIG.THREADS_MS, true, 0)).toBe(POLL_CONFIG.THREADS_MS)
    expect(getPollingInterval(POLL_CONFIG.THREADS_MS, true, 1)).toBe(POLL_CONFIG.THREADS_MS * 2)
    expect(getPollingInterval(POLL_CONFIG.THREADS_MS, true, 2)).toBe(POLL_CONFIG.THREADS_MS * 4)
  })

  it('enforces default request timeout and clears watchdog cleanly on timeout/abort', async () => {
    expect(api.defaults.timeout).toBeGreaterThan(0)
    expect(api.defaults.timeout).toBe(POLL_CONFIG.API_TIMEOUT_MS)

    const adapterSpy = vi.fn().mockImplementation((cfg) =>
      Promise.reject({
        code: 'ECONNABORTED',
        message: `timeout of ${POLL_CONFIG.API_TIMEOUT_MS}ms exceeded`,
        config: cfg,
      })
    )

    await expect(
      api.get('/comments/log', { timeout: 50, adapter: adapterSpy })
    ).rejects.toMatchObject({ code: 'ECONNABORTED' })

    const state = useConnectionStore.getState()
    expect(state.inFlightCount).toBe(0)
    expect(state.retryingMessage).toContain('Connection is slow')
  })
})
