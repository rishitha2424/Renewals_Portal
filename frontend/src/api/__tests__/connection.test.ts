import { describe, expect, it } from 'vitest'
import api from '../client'

describe('API proxy responses', () => {
  it('rejects an HTML fallback instead of treating it as data', async () => {
    await expect(api.get('/snapshots', {
      adapter: async (config) => ({
        config, status: 200, statusText: 'OK',
        headers: { 'content-type': 'text/html' },
        data: '<!doctype html><html><body>App</body></html>',
      }),
    })).rejects.toThrow('The app cannot reach the API')
  })

  it('accepts JSON snapshot data', async () => {
    const response = await api.get('/snapshots', {
      adapter: async (config) => ({
        config, status: 200, statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        data: [{ id: 'saved-snapshot' }],
      }),
    })
    expect(response.data).toEqual([{ id: 'saved-snapshot' }])
  })
})
