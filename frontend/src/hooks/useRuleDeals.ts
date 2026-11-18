import { useState, useCallback } from 'react'
import { useAppStore } from '@/store/appStore'
import { getV2DelayedDeals, getV2OverviewDeals } from '@/api/client'

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
      params: Record<string, any> = {},
      opts: { expectedCount?: number; initialFilters?: any; deals?: any[] } = {}
    ) => {
      // Auto-extract expectedCount from title if not explicitly passed, e.g. "Slippage (27 deals...)"
      const expected = opts.expectedCount ?? (() => {
        const m = title.match(/\((\d+)\s+deals?/i)
        return m ? parseInt(m[1], 10) : undefined
      })()

      const directDeals = params.deals || opts.deals
      if (directDeals && Array.isArray(directDeals) && directDeals.length > 0) {
        setModalState({
          isOpen: true,
          title,
          deals: directDeals.map((d: any) => ({
            ...d,
            owner: d.opportunity_owner || d.owner,
            stage: d.stage_number || d.stage,
          })),
          deltaGroups: undefined,
          expectedCount: expected ?? directDeals.length,
          initialFilters: opts.initialFilters || params,
          isLoading: false,
        })
        return
      }

      setModalState({
        isOpen: true,
        title,
        deals: [],
        deltaGroups: undefined,
        expectedCount: expected,
        initialFilters: opts.initialFilters || params,
        isLoading: true,
      })

      const mapDeals = (deals: any[]) =>
        (deals || []).map((d: any) => ({
          ...d,
          owner: d.opportunity_owner || d.owner,
          stage: d.stage_number || d.stage,
        }))

      try {
        const res = await getV2DelayedDeals({
          ...params,
          as_of: activeSnapshotId || undefined,
        })
        setModalState((prev) => ({
          ...prev,
          deals: mapDeals(res.deals),
          deltaGroups: res.delta_groups,
          isLoading: false,
        }))
      } catch (err) {
        console.warn('getV2DelayedDeals failed, attempting fallback to getV2OverviewDeals', err)
        try {
          const res = await getV2OverviewDeals({
            ...params,
            as_of: activeSnapshotId || undefined,
          })
          setModalState((prev) => ({
            ...prev,
            deals: mapDeals(res.deals),
            deltaGroups: res.delta_groups,
            isLoading: false,
          }))
        } catch (err2) {
          console.error('Failed to load rule deals', err2)
          setModalState((prev) => ({ ...prev, isLoading: false }))
        }
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

