import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { copyToClipboard } from '../clipboard'

describe('copyToClipboard', () => {
  const originalClipboard = navigator.clipboard
  const originalExecCommand = document.execCommand

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      writable: true,
      configurable: true,
    })
    document.execCommand = originalExecCommand
    vi.restoreAllMocks()
  })

  it('returns false for empty text', async () => {
    const res = await copyToClipboard('')
    expect(res).toBe(false)
  })

  it('uses navigator.clipboard.writeText when available (HTTPS/localhost)', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true,
    })

    const res = await copyToClipboard('https://renewals.example.com/set-password/token123')
    expect(res).toBe(true)
    expect(writeTextMock).toHaveBeenCalledWith('https://renewals.example.com/set-password/token123')
  })

  it('falls back to document.execCommand when navigator.clipboard is unavailable (HTTP VM)', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      writable: true,
      configurable: true,
    })

    const execCommandMock = vi.fn().mockReturnValue(true)
    document.execCommand = execCommandMock

    const res = await copyToClipboard('http://192.168.1.50:5173/reset-password/abc')
    expect(res).toBe(true)
    expect(execCommandMock).toHaveBeenCalledWith('copy')
  })

  it('falls back to document.execCommand when navigator.clipboard.writeText throws (Permission denied)', async () => {
    const writeTextMock = vi.fn().mockRejectedValue(new Error('NotAllowedError'))
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true,
    })

    const execCommandMock = vi.fn().mockReturnValue(true)
    document.execCommand = execCommandMock

    const res = await copyToClipboard('http://vm-ip:8000/invite/xyz')
    expect(res).toBe(true)
    expect(execCommandMock).toHaveBeenCalledWith('copy')
  })

  it('returns false when both clipboard and execCommand fail', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      writable: true,
      configurable: true,
    })

    document.execCommand = vi.fn().mockReturnValue(false)

    const res = await copyToClipboard('test-link')
    expect(res).toBe(false)
  })
})

