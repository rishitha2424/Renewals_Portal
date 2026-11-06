import { act, renderHook, waitFor, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAdminStatus } from '@/api/client'
import { useAppStore } from '@/store/appStore'
import { useAdminSession } from '../useAdminSession'

vi.mock('@/api/client', () => ({ getAdminStatus: vi.fn() }))

describe('admin session restoration', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    useAppStore.getState().setIsAdmin(false)
  })
  afterEach(cleanup)

  it('restores admin from the cookie after refresh without persisting credentials', async () => {
    vi.mocked(getAdminStatus).mockResolvedValue({ is_admin: true, user_name: 'Alex', security_warnings: [] })
    renderHook(useAdminSession)
    // Snapshot loading must not prevent authentication restoration.
    act(() => useAppStore.getState().setSnapshots([]))
    await waitFor(() => expect(useAppStore.getState().isAdmin).toBe(true))
    expect(useAppStore.getState().adminName).toBe('Alex')
    expect(useAppStore.getState().adminToken).toBeNull()
    const persisted = JSON.parse(localStorage.getItem('mobileum-app-v2')!).state
    expect(persisted).not.toHaveProperty('adminToken')
    expect(persisted).not.toHaveProperty('isAdmin')
  })

  it('keeps an expired session in viewer mode', async () => {
    vi.mocked(getAdminStatus).mockResolvedValue({ is_admin: false, user_name: null })
    renderHook(useAdminSession)
    await waitFor(() => expect(getAdminStatus).toHaveBeenCalledOnce())
    expect(useAppStore.getState().isAdmin).toBe(false)
  })

  it('does not restore a stale session after sign out', async () => {
    let resolve!: (value: any) => void
    vi.mocked(getAdminStatus).mockReturnValue(new Promise((done) => { resolve = done }))
    renderHook(useAdminSession)
    act(() => useAppStore.getState().setIsAdmin(false))
    await act(async () => resolve({ is_admin: true, user_name: 'Alex' }))
    expect(useAppStore.getState().isAdmin).toBe(false)
  })
})
