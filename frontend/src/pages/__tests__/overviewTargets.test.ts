import { describe, it, expect } from 'vitest'
import axios from 'axios'

describe('V2 Overview Deals API Contract & Click Targets', () => {
  const dealsBase = 'http://localhost:8000/api/v2/overview/deals'
  const summaryBase = 'http://localhost:8000/api/v2/overview/summary'

  it('Total ACV click target matches overview summary API exactly', async () => {
    const sumRes = await axios.get(summaryBase)
    expect(sumRes.status).toBe(200)
    const expectedCount = sumRes.data.total.count
    const expectedAcv = sumRes.data.total.acv

    const res = await axios.get(dealsBase)
    expect(res.status).toBe(200)
    const data = res.data
    expect(data.count).toBe(expectedCount)
    expect(data.acv).toBeCloseTo(expectedAcv, 2)
    expect(data.deals.length).toBe(expectedCount)
    expect(data.filters_applied).toBeDefined()
  })

  it('Category click targets sum exactly to total', async () => {
    const categories = ['Closed', 'Commit', 'Best Case', 'Blank', 'Pipeline']
    let sumCount = 0
    let sumAcv = 0

    for (const cat of categories) {
      const r = await axios.get(dealsBase, { params: { category: cat } })
      expect(r.status).toBe(200)
      sumCount += r.data.count
      sumAcv += r.data.acv
    }

    const res = await axios.get(dealsBase)
    expect(res.status).toBe(200)
    expect(sumCount).toBe(res.data.count)
    expect(sumAcv).toBeCloseTo(res.data.acv, 2)
  })

  it('Delta chips reconciliation matches summary deltas', async () => {
    const sumRes = await axios.get(summaryBase)
    const expYesterday = sumRes.data.total.delta_yesterday

    const rY = await axios.get(dealsBase, { params: { kind: 'delta_yesterday' } })
    expect(rY.status).toBe(200)
    const dY = rY.data
    if (expYesterday) {
      expect(dY.count).toBe(expYesterday.count)
      expect(dY.acv).toBeCloseTo(expYesterday.acv, 2)
    }
    expect(dY.delta_groups).toBeDefined()
  })
})
