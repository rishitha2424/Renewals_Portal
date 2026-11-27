// Keep the original root deployment working alongside the port-80 subpath.
export const appBase = window.location.pathname === '/renewals' ||
  window.location.pathname.startsWith('/renewals/') ? '/renewals/' : '/'

export const apiBase = `${appBase}api`
