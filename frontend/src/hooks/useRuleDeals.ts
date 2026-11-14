import { useState, useCallback } from 'react'
import { useAppStore } from '@/store/appStore'
import { getV2OverviewDeals } from '@/api/client'

export interface RuleDealsModalState {
  isOpen: boolean
  title: string
  deals: any[]
  deltaGroups?: any
  expectedCount?: number
  initialFilters?: any
  isLoading: boolean
}

export function useRuleDeals() {
  const { activeSnapshotId } = useAppStore()
  const [modalState, setModalState] = useState<RuleDealsModalState>({
    isOpen: false,
    title: '',
    deals: [],
    deltaGroups: undefined,
    expectedCount: undefined,
    initialFilters: undefined,
    isLoading: false,
  })

  const openRuleDeals = useCallback(
    async (
      title: string,
      params: Record<string, any>,
      opts: { expectedCount?: number; initialFilters?: any } = {}
    ) => {
      // Auto-extract expectedCount from title if not explicitly passed, e.g. "Slippage (27 deals...)"
      const expected = opts.expectedCount ?? (() => {
        const m = title.match(/\((\d+)\s+deals?/i)
        return m ? parseInt(m[1], 10) : undefined
      })()

      setModalState({
        isOpen: true,
        title,
        deals: [],
        deltaGroups: undefined,
        expectedCount: expected,
        initialFilters: opts.initialFilters,
        isLoading: true,
      })

      try {
        const res = await getV2OverviewDeals({
          ...params,
          as_of: activeSnapshotId || undefined,
        })
        setModalState((prev) => ({
          ...prev,
          deals: res.deals || [],
          deltaGroups: res.delta_groups,
          isLoading: false,
        }))
      } catch (err) {
        console.error('Failed to load rule deals', err)
        setModalState((prev) => ({ ...prev, isLoading: false }))
      }
    },
    [activeSnapshotId]
  )

  const closeRuleDeals = useCallback(() => {
    setModalState((prev) => ({ ...prev, isOpen: false }))
  }, [])

  return {
    modalState,
    openRuleDeals,
    closeRuleDeals,
  }
}

