import React from 'react'
import { TrendingUp, TrendingDown, AlertTriangle, ShieldCheck, PieChart, Clock, Award, CheckCircle2, Lightbulb } from 'lucide-react'
import { InsightItem } from '@/components/common/InsightCard'
import { formatCurrency, formatNumber, formatDate } from '@/utils/format'

function acvM(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return '$0'
  const abs = Math.abs(v)
  if (abs === 0) return '$0'
  const sign = v < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`
  return `${sign}$${abs.toFixed(0)}`
}

/** 1. Overview Insights Generator */
export function getOverviewInsights(summary: any, regional: any, movements: any, onDrill?: (title: string, params: any) => void): InsightItem[] {
  const items: InsightItem[] = []
  if (!summary) return items

  const totalAcv = summary.total?.acv || 1

  // Top region share
  const regTrend = regional?.regional_trend || []
  if (regTrend.length > 0) {
    const sorted = [...regTrend].sort((a: any, b: any) => (b.total_acv || 0) - (a.total_acv || 0))
    const topReg = sorted[0]
    if (topReg && topReg.total_acv > 0) {
      const share = ((topReg.total_acv / totalAcv) * 100).toFixed(1)
      items.push({
        id: 'top-region-share',
        icon: Award,
        text: (
          <span>
            <strong>{topReg.region}</strong> is the largest territory representing <strong>{share}%</strong> ({acvM(topReg.total_acv)}) of portfolio ACV.
          </span>
        ),
        linkText: 'View deals',
        onLinkClick: onDrill ? () => onDrill(`${topReg.region} Deals`, { region: topReg.region }) : undefined,
      })
    }

    // Top 3 territory concentration
    if (sorted.length >= 3) {
      const top3Sum = (sorted[0]?.total_acv || 0) + (sorted[1]?.total_acv || 0) + (sorted[2]?.total_acv || 0)
      const top3Share = ((top3Sum / totalAcv) * 100).toFixed(1)
      items.push({
        id: 'top-3-concentration',
        icon: PieChart,
        text: (
          <span>
            Territory concentration: top 3 regions hold <strong>{top3Share}%</strong> of total renewals pipeline.
          </span>
        ),
      })
    }
  }

  // Movements highlights (largest gain vs yesterday/last week)
  const posMoves = movements?.positive_moves || movements?.positive || []
  if (posMoves.length > 0) {
    const sortedPos = [...posMoves].sort((a: any, b: any) => (b.acv || 0) - (a.acv || 0))
    const topGain = sortedPos[0]
    if (topGain) {
      items.push({
        id: 'top-gain',
        icon: TrendingUp,
        text: (
          <span>
            Largest positive movement: <strong>{topGain.opportunity_name || topGain.name || topGain.region || 'Deal'}</strong> gained <strong>+{acvM(topGain.acv)}</strong>.
          </span>
        ),
      })
    }
  }

  // Pending approval concentration
  const propTotals = regional?.proposal_confirmation_totals
  if (propTotals && (propTotals.pending_count > 0 || propTotals.blank_count > 0)) {
    const unsubmittedDeals = propTotals.blank_count || 0
    items.push({
      id: 'approval-readiness',
      icon: ShieldCheck,
      text: (
        <span>
          <strong>{unsubmittedDeals} deals</strong> ({propTotals.pending_count || 0} pending) are awaiting formal renewal proposal submission.
        </span>
      ),
      linkText: 'View deals',
      onLinkClick: onDrill ? () => onDrill('Unsubmitted Approval Deals', { approval_status: 'Blank' }) : undefined,
    })
  }

  // Largest deal highlight
  const largestDeal = summary.needs_attention?.items?.find((i: any) => i.opportunity_name && i.acv)
  if (largestDeal) {
    const dealShare = ((largestDeal.acv / totalAcv) * 100).toFixed(1)
    items.push({
      id: 'largest-deal',
      icon: Award,
      text: (
        <span>
          Largest single contract is <strong>{largestDeal.opportunity_name}</strong> at <strong>{acvM(largestDeal.acv)}</strong> ({dealShare}% of total).
        </span>
      ),
      linkText: 'Inspect deal',
      onLinkClick: onDrill ? () => onDrill(`Largest Deal: ${largestDeal.opportunity_name}`, { deal_ids: largestDeal.opportunity_id_18 }) : undefined,
    })
  }

  return items
}

/** 2. Regions Matrix Insights Generator */
export function getRegionsMatrixInsights(summaryOrRegional: any, summary?: any, onDrill?: (title: string, params: any) => void): InsightItem[] {
  const items: InsightItem[] = []
  const data = summaryOrRegional || summary
  if (!data) return items

  const trends: any[] = data.regional_trend || data.regions || summary?.regions || []
  const totalAcv = summary?.total?.acv || data.total?.acv || data.regional_sum || 1

  if (trends.length > 0) {
    // Helper to extract values
    const getAcv = (r: any) => r.total_acv ?? r.acv ?? 0
    const getDeltaY = (r: any) => {
      if (r.delta_yesterday?.acv != null) return r.delta_yesterday.acv
      if (r.y_total_acv != null) return (r.total_acv || 0) - r.y_total_acv
      return 0
    }

    // Top region
    const sorted = [...trends].sort((a: any, b: any) => getAcv(b) - getAcv(a))
    const topReg = sorted[0]
    if (topReg && getAcv(topReg) > 0) {
      items.push({
        id: 'matrix-top-region',
        icon: Award,
        text: (
          <span>
            <strong>{topReg.region}</strong> leads with <strong>{acvM(getAcv(topReg))}</strong> ({((getAcv(topReg) / totalAcv) * 100).toFixed(1)}% of total).
          </span>
        ),
        linkText: 'View region',
        onLinkClick: onDrill ? () => onDrill(`${topReg.region} Deals`, { region: topReg.region }) : undefined,
      })
    }

    // Top gain vs yesterday/compare
    const gains = trends.filter((r: any) => getDeltaY(r) > 0)
    if (gains.length > 0) {
      const topGain = gains.sort((a: any, b: any) => getDeltaY(b) - getDeltaY(a))[0]
      const delta = getDeltaY(topGain)
      items.push({
        id: 'matrix-top-gain',
        icon: TrendingUp,
        text: (
          <span>
            <strong>{topGain.region}</strong> registered the largest regional gain of <strong>+{acvM(delta)}</strong> vs yesterday.
          </span>
        ),
      })
    }

    // Top drop vs yesterday
    const drops = trends.filter((r: any) => getDeltaY(r) < 0)
    if (drops.length > 0) {
      const topDrop = drops.sort((a: any, b: any) => getDeltaY(a) - getDeltaY(b))[0]
      const delta = Math.abs(getDeltaY(topDrop))
      items.push({
        id: 'matrix-top-drop',
        icon: TrendingDown,
        text: (
          <span>
            <strong>{topDrop.region}</strong> dropped <strong>-{acvM(delta)}</strong> vs yesterday.
          </span>
        ),
      })
    }

    // Lowest approval share or unapproved count
    const withApprovals = trends.filter((r: any) => r.approved_pct != null || r.approval != null || r.approved_count != null)
    if (withApprovals.length > 0) {
      const sortedByApp = [...withApprovals].sort((a: any, b: any) => {
        const aPct = a.approved_pct ?? (a.approval?.Approved?.count ? (a.approval.Approved.count / (a.count || 1)) * 100 : 100)
        const bPct = b.approved_pct ?? (b.approval?.Approved?.count ? (b.approval.Approved.count / (b.count || 1)) * 100 : 100)
        return aPct - bPct
      })
      const lowest = sortedByApp[0]
      const lowestPct = lowest?.approved_pct ?? (lowest?.approval?.Approved?.count ? ((lowest.approval.Approved.count / (lowest.count || 1)) * 100).toFixed(1) : 0)
      if (lowest) {
        items.push({
          id: 'matrix-lowest-approval',
          icon: AlertTriangle,
          text: (
            <span>
              <strong>{lowest.region}</strong> has the lowest approval readiness at <strong>{lowestPct}%</strong> approved.
            </span>
          ),
          linkText: 'Inspect',
          onLinkClick: onDrill ? () => onDrill(`${lowest.region} Deals`, { region: lowest.region }) : undefined,
        })
      }
    }
  }

  return items
}

/** 3. Region Deep Dive Insights */
export function getRegionDeepDiveInsights(regionName: string, regData: any, portfolioTotal: number, onDrill?: (title: string, params: any) => void): InsightItem[] {
  const items: InsightItem[] = []
  if (!regData) return items

  const regAcv = regData.total?.acv || regData.acv || 0
  const portTotal = portfolioTotal || 1
  const shareOfPort = ((regAcv / portTotal) * 100).toFixed(1)

  items.push({
    id: 'rdd-share',
    icon: PieChart,
    text: (
      <span>
        <strong>{regionName}</strong> represents <strong>{shareOfPort}%</strong> ({acvM(regAcv)}) of total portfolio renewals.
      </span>
    ),
  })

  // Commit coverage
  const fcMap = (regData.forecast_categories || []).reduce((acc: any, c: any) => ({ ...acc, [c.category]: c.acv }), {})
  const commitAcv = regData.categories?.['Commit']?.acv || fcMap['Commit'] || 0
  const bestCaseAcv = regData.categories?.['Best Case']?.acv || fcMap['Best Case'] || 0
  if (regAcv > 0) {
    const covPct = regData.commit_pct != null ? regData.commit_pct : (((commitAcv + bestCaseAcv) / regAcv) * 100).toFixed(1)
    items.push({
      id: 'rdd-coverage',
      icon: ShieldCheck,
      text: (
        <span>
          Commit + Best Case coverage in {regionName} stands at <strong>{covPct}%</strong> ({acvM(commitAcv + bestCaseAcv || regAcv * (Number(covPct) / 100))}).
        </span>
      ),
    })
  }

  // Delayed / slippage
  const delayedAcv = regData.delayed_acv ?? regData.delayed?.acv ?? 0
  const delayedCount = regData.delayed_count ?? regData.delayed?.count ?? 0
  if (delayedAcv > 0 || delayedCount > 0) {
    items.push({
      id: 'rdd-delayed',
      icon: Clock,
      text: (
        <span>
          <strong>{acvM(delayedAcv)}</strong> ({delayedCount} deals) are currently classified as delayed in this region.
        </span>
      ),
      linkText: 'View delayed',
      onLinkClick: onDrill ? () => onDrill(`${regionName} Delayed Deals`, { region: regionName, kind: 'delayed' }) : undefined,
    })
  }

  // Top account
  const topAcc = regData.top_accounts?.[0]
  if (topAcc) {
    items.push({
      id: 'rdd-top-account',
      icon: Award,
      text: (
        <span>
          Key account: <strong>{topAcc.account_name || topAcc.name}</strong> holds <strong>{acvM(topAcc.acv)}</strong> of regional renewals.
        </span>
      ),
    })
  }

  // Signal / Concentration
  if (regData.concentration?.summary_text) {
    items.push({
      id: 'rdd-concentration',
      icon: Lightbulb,
      text: (
        <span>
          Concentration: <strong>{regData.concentration.summary_text}</strong>.
        </span>
      ),
    })
  }

  return items
}

/** 4. Business Units Insights Generator */
export function getBusinessUnitsInsights(buSummary: any, onDrill?: (title: string, params: any) => void): InsightItem[] {
  const items: InsightItem[] = []
  if (!buSummary) return items

  const rows = buSummary.rows || buSummary.by_bu || []
  const totalAcv = buSummary.total?.acv || 1

  if (rows.length > 0) {
    const sorted = [...rows].sort((a: any, b: any) => (b.acv || 0) - (a.acv || 0))
    const topBu = sorted[0]
    if (topBu) {
      const share = ((topBu.acv / totalAcv) * 100).toFixed(1)
      items.push({
        id: 'bu-top',
        icon: Award,
        text: (
          <span>
            <strong>{topBu.bu || topBu.name}</strong> is the primary business unit with <strong>{share}%</strong> ({acvM(topBu.acv)}) of portfolio ACV.
          </span>
        ),
        linkText: 'View BU',
        onLinkClick: onDrill ? () => onDrill(`${topBu.bu || topBu.name} Deals`, { bu: topBu.bu || topBu.name }) : undefined,
      })
    }

    if (sorted.length >= 3) {
      const top3Acv = (sorted[0]?.acv || 0) + (sorted[1]?.acv || 0) + (sorted[2]?.acv || 0)
      const top3Share = ((top3Acv / totalAcv) * 100).toFixed(1)
      items.push({
        id: 'bu-top-3-share',
        icon: PieChart,
        text: (
          <span>
            Top 3 business units account for <strong>{top3Share}%</strong> of overall renewal opportunities.
          </span>
        ),
      })
    }

    // BU with highest commit coverage
    const withCov = rows.map((r: any) => {
      const cAcv = r.cells?.['Commit']?.acv || r.categories?.['Commit']?.acv || r.commit_acv || 0
      const bAcv = r.acv || 1
      return { name: r.bu || r.name, cov: (cAcv / bAcv) * 100, commitAcv: cAcv }
    }).filter((r: any) => r.commitAcv > 0).sort((a: any, b: any) => b.cov - a.cov)

    if (withCov.length > 0) {
      const highestCov = withCov[0]
      items.push({
        id: 'bu-highest-cov',
        icon: CheckCircle2,
        text: (
          <span>
            <strong>{highestCov.name}</strong> has the strongest commitment rate at <strong>{highestCov.cov.toFixed(1)}%</strong> Commit coverage.
          </span>
        ),
      })
    }
  }

  return items
}

/** 4b. BU Top Deals Highlights Generator */
export function getBuTopDealsInsights(deals: any[], totalAcv: number, onSelectOpp?: (id: string) => void): InsightItem[] {
  const items: InsightItem[] = []
  if (!deals || deals.length === 0) return items

  const tot = totalAcv || 1
  const sorted = [...deals].sort((a: any, b: any) => (b.forecast_acv_amount || b.acv || 0) - (a.forecast_acv_amount || a.acv || 0))
  const topDeal = sorted[0]

  if (topDeal) {
    const dAcv = topDeal.forecast_acv_amount || topDeal.acv || 0
    const dShare = ((dAcv / tot) * 100).toFixed(1)
    items.push({
      id: 'bu-deal-top',
      icon: Award,
      text: (
        <span>
          Largest opportunity: <strong>{topDeal.opportunity_name}</strong> ({topDeal.account_name}) represents <strong>{acvM(dAcv)}</strong> ({dShare}% of total).
        </span>
      ),
      linkText: 'Inspect deal',
      onLinkClick: onSelectOpp && topDeal.opportunity_id_18 ? () => onSelectOpp(topDeal.opportunity_id_18) : undefined,
    })
  }

  // Concentration in top 5 deals
  if (sorted.length >= 5) {
    const top5Acv = sorted.slice(0, 5).reduce((sum: number, d: any) => sum + (d.forecast_acv_amount || d.acv || 0), 0)
    const top5Share = ((top5Acv / tot) * 100).toFixed(1)
    items.push({
      id: 'bu-deal-top5-share',
      icon: PieChart,
      text: (
        <span>
          Top 5 opportunities hold <strong>{acvM(top5Acv)}</strong>, representing <strong>{top5Share}%</strong> of total portfolio ACV.
        </span>
      ),
    })
  }

  // Highest uncommitted opportunity (Best Case or Pipeline)
  const uncommitted = sorted.find((d: any) => {
    const cat = (d.forecast_category || '').toLowerCase()
    return cat.includes('best case') || cat.includes('bestcase') || cat.includes('pipeline')
  })
  if (uncommitted) {
    const uAcv = uncommitted.forecast_acv_amount || uncommitted.acv || 0
    items.push({
      id: 'bu-deal-uncommitted',
      icon: TrendingUp,
      text: (
        <span>
          Key upside opportunity: <strong>{uncommitted.opportunity_name}</strong> ({acvM(uAcv)}) is currently in <strong>{uncommitted.forecast_category}</strong>.
        </span>
      ),
      linkText: 'View opportunity',
      onLinkClick: onSelectOpp && uncommitted.opportunity_id_18 ? () => onSelectOpp(uncommitted.opportunity_id_18) : undefined,
    })
  }

  return items
}

/** 5. Approvals Insights Generator */
export function getApprovalsInsights(approvalsData: any, onDrill?: (title: string, params: any) => void): InsightItem[] {
  const items: InsightItem[] = []
  if (!approvalsData) return items

  const totalAcv = approvalsData.total?.acv || 1
  const appMap = approvalsData.statuses || []

  // Commit unapproved
  const commitUnapproved = approvalsData.commit_not_approved || approvalsData.commit_unapproved || approvalsData.unapproved_commit
  if (commitUnapproved && commitUnapproved.count > 0) {
    items.push({
      id: 'app-commit-unapproved',
      icon: AlertTriangle,
      text: (
        <span>
          High priority: <strong>{commitUnapproved.count} Commit deals</strong> ({acvM(commitUnapproved.acv)}) are not yet approved.
        </span>
      ),
      linkText: 'Inspect',
      onLinkClick: onDrill ? () => onDrill('Unapproved Commit Deals', { forecast_category: 'Commit', approval_status: 'not_approved' }) : undefined,
    })
  }

  // Pending approval total
  const pendingStatus = appMap.find((s: any) => s.status === 'Pending Approval' || s.status === 'Pending')
  if (pendingStatus && pendingStatus.count > 0) {
    const pShare = ((pendingStatus.acv / totalAcv) * 100).toFixed(1)
    items.push({
      id: 'app-pending-share',
      icon: Clock,
      text: (
        <span>
          <strong>{pendingStatus.count} contracts</strong> ({acvM(pendingStatus.acv)}, {pShare}% of total) are currently waiting in approval workflow.
        </span>
      ),
      linkText: 'View pending',
      onLinkClick: onDrill ? () => onDrill('Pending Approval Deals', { approval_status: 'Pending Approval' }) : undefined,
    })
  }

  // Portfolio approved share
  const approvedStatus = appMap.find((s: any) => s.status === 'Approved')
  if (approvedStatus && approvedStatus.acv > 0) {
    const aShare = ((approvedStatus.acv / totalAcv) * 100).toFixed(1)
    items.push({
      id: 'app-approved-share',
      icon: ShieldCheck,
      text: (
        <span>
          Portfolio readiness: <strong>{aShare}%</strong> ({acvM(approvedStatus.acv)}) of contract value has achieved complete approval.
        </span>
      ),
    })
  }

  // Approval coverage benchmark
  if (approvalsData.approval_coverage?.portfolio_average_pct != null) {
    items.push({
      id: 'app-cov-benchmark',
      icon: CheckCircle2,
      text: (
        <span>
          Approval coverage benchmark: portfolio average stands at <strong>{approvalsData.approval_coverage.portfolio_average_pct}%</strong> approved ACV.
        </span>
      ),
    })
  }

  return items
}

/** 6. Delayed Renewals Insights Generator */
export function getDelayedInsights(summary: any, onDrill?: (title: string, params: any) => void): InsightItem[] {
  const items: InsightItem[] = []
  if (!summary) return items

  const delTot = summary.delayed_renewals_total || summary.delayed_renewals?.total || summary.total
  const qTotAcv = summary.quarter_total_acv || 1

  if (delTot && delTot.acv > 0) {
    const delPct = ((delTot.acv / qTotAcv) * 100).toFixed(1)
    items.push({
      id: 'delayed-pct-quarter',
      icon: AlertTriangle,
      text: (
        <span>
          Delayed contracts total <strong>{acvM(delTot.acv)}</strong> ({delTot.count || 0} deals), representing <strong>{delPct}%</strong> of quarterly volume.
        </span>
      ),
      linkText: 'View delayed',
      onLinkClick: onDrill ? () => onDrill('All Delayed Deals', { kind: 'delayed_total' }) : undefined,
    })
  }

  // Slippage share
  const slipTot = summary.slippage_total || summary.slippage?.total
  if (slipTot && slipTot.acv > 0) {
    items.push({
      id: 'delayed-slippage-share',
      icon: Clock,
      text: (
        <span>
          <strong>{acvM(slipTot.acv)}</strong> ({slipTot.count || 0} deals) have slipped their closing target into the next fiscal period.
        </span>
      ),
      linkText: 'View slipped',
      onLinkClick: onDrill ? () => onDrill('Slippage Deals', { kind: 'slippage' }) : undefined,
    })
  }

  // Lost summary
  const lostTot = summary.lost
  if (lostTot && lostTot.count > 0) {
    items.push({
      id: 'delayed-lost-summary',
      icon: TrendingDown,
      text: (
        <span>
          <strong>{lostTot.count} deals</strong> ({acvM(lostTot.acv)}) were deleted or lost since period start (tracked outside active pipeline).
        </span>
      ),
      linkText: 'View lost',
      onLinkClick: onDrill ? () => onDrill('Lost Deals', { kind: 'lost' }) : undefined,
    })
  }

  return items
}

/** 7. Expiry Schedule Insights Generator */
export function getExpiryInsights(sum: any, onDrill?: (title: string, params: any) => void): InsightItem[] {
  const items: InsightItem[] = []
  if (!sum) return items

  const grandTot = sum.grand_total || {}
  const gAcv = grandTot.acv || 1

  // Primary year expiry
  const fy1 = sum.fiscal_years?.[0]?.label
  if (fy1 && sum.acv_by_year?.[fy1]) {
    const yData = sum.acv_by_year[fy1]
    const yShare = ((yData.acv / gAcv) * 100).toFixed(1)
    items.push({
      id: 'exp-primary-fy',
      icon: Award,
      text: (
        <span>
          Primary focus <strong>FY{fy1}</strong> contains <strong>{yShare}%</strong> ({acvM(yData.acv)}, {yData.count} deals) of expiring contracts.
        </span>
      ),
    })
  }

  // Slippage to next fiscal year
  const fy2 = sum.fiscal_years?.[1]?.label
  if (sum.slippage && sum.slippage.count > 0) {
    items.push({
      id: 'exp-slippage-fy',
      icon: Clock,
      text: (
        <span>
          Slippage tracking: <strong>{sum.slippage.count} renewals</strong> ({acvM(sum.slippage.acv)}) are pushed to close in FY{fy2 || 'next year'}.
        </span>
      ),
      linkText: 'View deals',
      onLinkClick: onDrill ? () => onDrill(`Slippage to FY${fy2}`, { slippage: true }) : undefined,
    })
  }

  return items
}
