import { describe, it, expect } from 'vitest'
import axios from 'axios'
import api, {
  getV2DelayedSummary,
  getV2OverviewSummary,
  getV2ExpirySummary,
  getApprovalsDistribution,
  getV2BusinessUnitsSummary,
  getV2RegionsSummary,
} from '@/api/client'
import { useAppStore } from '@/store/appStore'

api.defaults.baseURL = 'http://localhost:8000/api'

describe('Executive View Number Integrity & Fixtures', () => {
  const BASE = 'http://localhost:8000/api'
  const OCT7_UUID = '59d7e47e-c9e1-4bbd-9c80-33f756c17a33'
  const OCT14_UUID = '42643319-289e-4794-9ab0-3fadbcd683a4'

  describe('Step 8f: Oct 7 Fixture - Every table rows sum exactly to total', () => {
    it('Oct 7: Forecast Category rows sum exactly to headline total (348 / $40,068,990.09)', async () => {
      const res = await axios.get(`${BASE}/v2/overview/summary?as_of=${OCT7_UUID}`)
      expect(res.status).toBe(200)
      const data = res.data

      expect(data.total.count).toBe(348)
      expect(data.total.acv).toBeCloseTo(40068990.09, 2)

      const cats = data.categories
      const catCountSum = Object.values(cats).reduce((acc: number, c: any) => acc + c.count, 0)
      const catAcvSum = Object.values(cats).reduce((acc: number, c: any) => acc + c.acv, 0)

      expect(catCountSum).toBe(data.total.count)
      expect(catAcvSum).toBeCloseTo(data.total.acv, 2)
    })

    it('Oct 7: Approval Status Summary rows sum exactly to headline total (348 / $40,068,990.09)', async () => {
      const res = await axios.get(`${BASE}/v2/approvals/distribution?as_of=${OCT7_UUID}&compare=yesterday`)
      expect(res.status).toBe(200)
      const data = res.data

      expect(data.total.count).toBe(348)
      expect(data.total.acv).toBeCloseTo(40068990.09, 2)

      // Merged statuses: Approved, Pending Approval, Not submitted (Blank)
      const statuses = data.statuses
      const statusCountSum = statuses.reduce((acc: number, s: any) => acc + s.count, 0)
      const statusAcvSum = statuses.reduce((acc: number, s: any) => acc + s.acv, 0)

      expect(statusCountSum).toBe(348)
      expect(statusAcvSum).toBeCloseTo(40068990.09, 2)
    })

    it('Oct 7: Delayed Renewals rows (Overdue + Slipped + Later Close + Lost) sum exactly to Delayed total (9 / $339,305.70)', async () => {
      const res = await axios.get(`${BASE}/v2/delayed/summary?as_of=${OCT7_UUID}&compare=yesterday`)
      expect(res.status).toBe(200)
      const data = res.data

      expect(data.total.count).toBe(9)
      expect(data.total.acv).toBeCloseTo(339305.70, 2)

      // Overdue: 6 deals / $228,071.49
      expect(data.overdue.count).toBe(6)
      expect(data.overdue.acv).toBeCloseTo(228071.49, 2)

      // Slipped: 2 deals / $59,514.21
      expect(data.slipped.count).toBe(2)
      expect(data.slipped.acv).toBeCloseTo(59514.21, 2)

      // Later Close Date within quarter: 1 deal / $51,720.00
      expect(data.later_close.count).toBe(1)
      expect(data.later_close.acv).toBeCloseTo(51720.00, 2)

      // Lost: 0 deals / $0.00
      expect(data.lost.count).toBe(0)
      expect(data.lost.acv).toBeCloseTo(0, 2)

      // Sum of all 4 rows
      const rowSumCount = data.overdue.count + data.slipped.count + data.later_close.count + data.lost.count
      const rowSumAcv = data.overdue.acv + data.slipped.acv + data.later_close.acv + data.lost.acv

      expect(rowSumCount).toBe(data.total.count)
      expect(rowSumAcv).toBeCloseTo(data.total.acv, 2)
    })

    it('Oct 7: Business Units rows sum exactly to total (348 / $40,068,990.09)', async () => {
      const res = await axios.get(`${BASE}/v2/business-units/summary?as_of=${OCT7_UUID}&compare=yesterday`)
      expect(res.status).toBe(200)
      const data = res.data

      const rowSumCount = data.rows.reduce((acc: number, r: any) => acc + r.count, 0)
      const rowSumAcv = data.rows.reduce((acc: number, r: any) => acc + r.acv, 0)

      expect(rowSumCount).toBe(348)
      expect(rowSumAcv).toBeCloseTo(40068990.09, 2)
    })
  })

  describe('Step 9: Oct 14 Fixture - Exact reference metrics', () => {
    it('Oct 14: Portfolio Headline & Forecast Categories match reference', async () => {
      const res = await axios.get(`${BASE}/v2/overview/summary?as_of=${OCT14_UUID}`)
      expect(res.status).toBe(200)
      const data = res.data

      // Total: 352 / $41,115,061.34
      expect(data.total.count).toBe(352)
      expect(data.total.acv).toBeCloseTo(41115061.34, 2)

      const cats = data.categories
      // Commit: 310 / $31,064,043.43
      expect(cats.Commit.count).toBe(310)
      expect(cats.Commit.acv).toBeCloseTo(31064043.43, 2)

      // Best Case: 31 / $9,216,018.06
      expect(cats['Best Case'].count).toBe(31)
      expect(cats['Best Case'].acv).toBeCloseTo(9216018.06, 2)

      // Pipeline: 1 / $49,455.54
      expect(cats.Pipeline.count).toBe(1)
      expect(cats.Pipeline.acv).toBeCloseTo(49455.54, 2)

      // Not yet proposed (Blank): 10 / $785,544.31
      expect(cats.Blank.count).toBe(10)
      expect(cats.Blank.acv).toBeCloseTo(785544.31, 2)

      // vs yesterday: 0 / -$51,514.82
      expect(data.total.delta_yesterday.count).toBe(0)
      expect(data.total.delta_yesterday.acv).toBeCloseTo(-51514.82, 2)

      // vs last week: +4 / +$1,046,071.25
      expect(data.total.delta_lastweek.count).toBe(4)
      expect(data.total.delta_lastweek.acv).toBeCloseTo(1046071.25, 2)
    })

    it('Oct 14: Approvals Distribution matches reference', async () => {
      const res = await axios.get(`${BASE}/v2/approvals/distribution?as_of=${OCT14_UUID}&compare=yesterday`)
      expect(res.status).toBe(200)
      const data = res.data

      expect(data.total.count).toBe(352)
      expect(data.total.acv).toBeCloseTo(41115061.34, 2)

      const statusMap: Record<string, any> = {}
      data.statuses.forEach((s: any) => {
        statusMap[s.status] = s
      })

      // Approved: 115 / $9,637,788.25
      expect(statusMap['Approved'].count).toBe(115)
      expect(statusMap['Approved'].acv).toBeCloseTo(9637788.25, 2)

      // Pending (Pending Approval): 6 / $806,466.36
      expect(statusMap['Pending Approval'].count).toBe(6)
      expect(statusMap['Pending Approval'].acv).toBeCloseTo(806466.36, 2)

      // Not submitted (Blank): 231 / $30,670,806.73
      expect(statusMap['Blank'].count).toBe(231)
      expect(statusMap['Blank'].acv).toBeCloseTo(30670806.73, 2)
    })
  })

  describe('Step 5: Selecting a snapshot UUID in compare does not 422 or 500', () => {
    it('Selecting past date in vs dropdown does not produce 422 on Delayed, Overview, Expiry, Approvals, BUs, Regions', async () => {
      const pastUuid = 'e0e007ec-83a0-472a-bfaf-5bdfe5bab0b0' // Oct 6
      const { setCompareSnapshotId, setActiveSnapshotId } = useAppStore.getState()
      setActiveSnapshotId(OCT7_UUID)
      setCompareSnapshotId(pastUuid)

      const [delayedRes, overviewRes, expiryRes, apprRes, buRes, regRes] = await Promise.all([
        getV2DelayedSummary({ as_of: OCT7_UUID }),
        getV2OverviewSummary({ as_of: OCT7_UUID }),
        getV2ExpirySummary({ as_of: OCT7_UUID }),
        getApprovalsDistribution(OCT7_UUID),
        getV2BusinessUnitsSummary({ as_of: OCT7_UUID }),
        getV2RegionsSummary({ as_of: OCT7_UUID }),
      ])

      expect(delayedRes).toBeDefined()
      expect(delayedRes.total.count).toBe(9)

      expect(overviewRes).toBeDefined()
      expect(overviewRes.total.count).toBe(348)

      expect(expiryRes).toBeDefined()
      expect(apprRes).toBeDefined()
      expect(buRes).toBeDefined()
      expect(regRes).toBeDefined()
    }, 30000)
  })
})
