import { describe, it, expect } from 'vitest'
import { getQuarterFromDate } from '@/utils/format'

describe('Derived Quarter & Year Helpers', () => {
  it('derives Q4-2026 for Oct 7, 2026 (matching existing text for Oct 7)', () => {
    expect(getQuarterFromDate('2026-10-07')).toBe('Q4-2026')
    expect(getQuarterFromDate('2026-10-07T00:00:00')).toBe('Q4-2026')
  })

  it('derives correct quarters for different dates and periods', () => {
    expect(getQuarterFromDate('2026-01-15')).toBe('Q1-2026')
    expect(getQuarterFromDate('2026-04-20')).toBe('Q2-2026')
    expect(getQuarterFromDate('2026-07-04')).toBe('Q3-2026')
    expect(getQuarterFromDate('2027-02-10')).toBe('Q1-2027')
    expect(getQuarterFromDate(null)).toBe('')
  })
})
