import { useEffect } from 'react'
import { getAdminStatus } from '@/api/client'
import { useAppStore } from '@/store/appStore'

// Restore server-validated authentication from the HttpOnly session cookie.
// Passwords and tokens must not be persisted in browser storage.
export function useAdminSession() {
  useEffect(() => {
    let cancelled = false
    const initialState = useAppStore.getState()

    getAdminStatus().then((status) => {
      // A login/logout performed while this request was pending takes precedence.
      const current = useAppStore.getState()
      if (cancelled || current.isAdmin !== initialState.isAdmin ||
          current.adminToken !== initialState.adminToken ||
          current.adminName !== initialState.adminName ||
          current.securityWarnings !== initialState.securityWarnings) return
      initialState.setIsAdmin(
        status.is_admin,
        null,
        status.user_name,
        status.security_warnings || [],
      )
    }).catch(() => {
      // A temporary network failure does not invalidate an existing session.
    })

    return () => { cancelled = true }
  }, [])
}
