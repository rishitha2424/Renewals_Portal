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

/** 2. Regions Matrix Insights Generator (Regional Signals with at least 6 points) */
export function getRegionsMatrixInsights(summaryOrRegional: any, summary?: any, onDrill?: (title: string, params: any) => void): InsightItem[] {
  const items: InsightItem[] = []
  const data = summaryOrRegional || summary
  if (!data) return items

  const trends: any[] = data.regional_trend || data.regions || summary?.regions || []
  const totalAcv = summary?.total?.acv || data.total?.acv || data.regional_sum || 1
  const categoriesTotal = summary?.totals?.categories || data.totals?.categories || {}

  if (trends.length > 0) {
    const getAcv = (r: any) => r.total_acv ?? r.acv ?? 0
    const getDeltaY = (r: any) => {
      if (r.delta_yesterday?.acv != null) return r.delta_yesterday.acv
      if (r.y_total_acv != null) return (r.total_acv || 0) - r.y_total_acv
      return 0
    }

    // 1. Top region share
    const sorted = [...trends].sort((a: any, b: any) => getAcv(b) - getAcv(a))
    const topReg = sorted[0]
    if (topReg && getAcv(topReg) > 0) {
      const share = ((getAcv(topReg) / totalAcv) * 100).toFixed(1)
      items.push({
        id: 'matrix-top-region',
        text: (
          <span>
            <strong>{topReg.region}</strong> is the primary territory representing <strong>{share}%</strong> ({acvM(getAcv(topReg))}) of portfolio renewals.
          </span>
        ),
        linkText: 'View region',
        onLinkClick: onDrill ? () => onDrill(`${topReg.region} Deals`, { region: topReg.region }) : undefined,
      })
    }

    // 2. Top-2 concentration
    if (sorted.length >= 2) {
      const top2Sum = getAcv(sorted[0]) + getAcv(sorted[1])
      const top2Share = ((top2Sum / totalAcv) * 100).toFixed(1)
      items.push({
        id: 'matrix-top2-concentration',
        text: (
          <span>
            Territory concentration: <strong>{sorted[0]?.region}</strong> and <strong>{sorted[1]?.region}</strong> hold <strong>{top2Share}%</strong> of total renewals.
          </span>
        ),
      })
    }

    // 3. Top gain vs comparison
    const gains = trends.filter((r: any) => getDeltaY(r) > 0)
    if (gains.length > 0) {
      const topGain = gains.sort((a: any, b: any) => getDeltaY(b) - getDeltaY(a))[0]
      const delta = getDeltaY(topGain)
      items.push({
        id: 'matrix-top-gain',
        text: (
          <span>
            Largest gain: <strong>{topGain.region}</strong> expanded by <strong>+{acvM(delta)}</strong> vs baseline.
          </span>
        ),
        linkText: 'View deals',
        onLinkClick: onDrill ? () => onDrill(`${topGain.region} Gains`, { region: topGain.region }) : undefined,
      })
    }

    // 4. Top drop vs comparison
    const drops = trends.filter((r: any) => getDeltaY(r) < 0)
    if (drops.length > 0) {
      const topDrop = drops.sort((a: any, b: any) => getDeltaY(a) - getDeltaY(b))[0]
      const delta = Math.abs(getDeltaY(topDrop))
      items.push({
        id: 'matrix-top-drop',
        text: (
          <span>
            Largest contraction: <strong>{topDrop.region}</strong> contracted by <strong>-{acvM(delta)}</strong> vs baseline.
          </span>
        ),
        linkText: 'Inspect',
        onLinkClick: onDrill ? () => onDrill(`${topDrop.region} Losses`, { region: topDrop.region }) : undefined,
      })
    }

    // 5. Lowest Commit coverage region
    const withCommit = trends.filter((r: any) => r.commit_pct != null || r.cells?.Commit != null || r.cells?.Closed != null)
    if (withCommit.length > 0) {
      const sortedByCommit = [...withCommit].sort((a: any, b: any) => {
        const aPct = parseFloat(String(a.commit_pct ?? (getAcv(a) > 0 ? (((a.cells?.Commit?.acv || 0) + (a.cells?.Closed?.acv || 0)) / getAcv(a)) * 100 : 0)))
        const bPct = parseFloat(String(b.commit_pct ?? (getAcv(b) > 0 ? (((b.cells?.Commit?.acv || 0) + (b.cells?.Closed?.acv || 0)) / getAcv(b)) * 100 : 0)))
        return aPct - bPct
      })
      const lowestCommit = sortedByCommit[0]
      if (lowestCommit) {
        const cPct = parseFloat(String(lowestCommit.commit_pct ?? (getAcv(lowestCommit) > 0 ? (((lowestCommit.cells?.Commit?.acv || 0) + (lowestCommit.cells?.Closed?.acv || 0)) / getAcv(lowestCommit)) * 100 : 0))).toFixed(1)
        items.push({
          id: 'matrix-lowest-commit',
          text: (
            <span>
              Lowest Commit coverage: <strong>{lowestCommit.region}</strong> is at <strong>{cPct}%</strong> (Closed + Commit).
            </span>
          ),
          linkText: 'Review pipeline',
          onLinkClick: onDrill ? () => onDrill(`${lowestCommit.region} Pipeline`, { region: lowestCommit.region, category: 'Pipeline' }) : undefined,
        })
      }
    }

    // 6. Highest Not submitted share
    const withNotSubmitted = trends.filter((r: any) => {
      const notSub = r.approval?.['Not submitted'] || r.approval?.['Blank'] || r.approval?.['not_submitted']
      return notSub && (notSub.count > 0 || notSub.acv > 0)
    })
    if (withNotSubmitted.length > 0) {
      const sortedNotSub = [...withNotSubmitted].sort((a: any, b: any) => {
        const aVal = a.approval?.['Not submitted']?.acv || a.approval?.['Blank']?.acv || 0
        const bVal = b.approval?.['Not submitted']?.acv || b.approval?.['Blank']?.acv || 0
        return bVal - aVal
      })
      const topNotSub = sortedNotSub[0]
      if (topNotSub) {
        const unsubmittedAcv = topNotSub.approval?.['Not submitted']?.acv || topNotSub.approval?.['Blank']?.acv || 0
        const unsubmittedCount = topNotSub.approval?.['Not submitted']?.count || topNotSub.approval?.['Blank']?.count || 0
        items.push({
          id: 'matrix-highest-not-submitted',
          text: (
            <span>
              Highest unsubmitted: <strong>{topNotSub.region}</strong> has <strong>{unsubmittedCount} deals</strong> ({acvM(unsubmittedAcv)}) awaiting proposal submission.
            </span>
          ),
          linkText: 'View deals',
          onLinkClick: onDrill ? () => onDrill(`${topNotSub.region} Unsubmitted`, { region: topNotSub.region, status: 'Not submitted' }) : undefined,
        })
      }
    }

    // 7. Largest Pending approval ACV region
    const withPending = trends.filter((r: any) => {
      const pending = r.approval?.['Pending Approval'] || r.approval?.['Waiting for approval']
      return pending && (pending.count > 0 || pending.acv > 0)
    })
    if (withPending.length > 0) {
      const sortedPending = [...withPending].sort((a: any, b: any) => {
        const aVal = a.approval?.['Pending Approval']?.acv || a.approval?.['Waiting for approval']?.acv || 0
        const bVal = b.approval?.['Pending Approval']?.acv || b.approval?.['Waiting for approval']?.acv || 0
        return bVal - aVal
      })
      const topPending = sortedPending[0]
      if (topPending) {
        const pAcv = topPending.approval?.['Pending Approval']?.acv || topPending.approval?.['Waiting for approval']?.acv || 0
        const pCount = topPending.approval?.['Pending Approval']?.count || topPending.approval?.['Waiting for approval']?.count || 0
        items.push({
          id: 'matrix-top-pending',
          text: (
            <span>
              Largest pending approval: <strong>{topPending.region}</strong> has <strong>{acvM(pAcv)}</strong> ({pCount} deals) currently in review.
            </span>
          ),
          linkText: 'Inspect',
          onLinkClick: onDrill ? () => onDrill(`${topPending.region} Pending Approval`, { region: topPending.region, status: 'Pending Approval' }) : undefined,
        })
      }
    }

    // 8. Share of Closed vs Best Case
    const totalClosed = categoriesTotal['Closed']?.acv || 0
    const totalBestCase = categoriesTotal['Best Case']?.acv || 0
    if (totalAcv > 0) {
      const closedPct = ((totalClosed / totalAcv) * 100).toFixed(1)
      const bestCasePct = ((totalBestCase / totalAcv) * 100).toFixed(1)
      items.push({
        id: 'matrix-closed-vs-bestcase',
        text: (
          <span>
            Forecast posture: Closed contracts represent <strong>{closedPct}%</strong> ({acvM(totalClosed)}) while Best Case stands at <strong>{bestCasePct}%</strong> ({acvM(totalBestCase)}).
          </span>
        ),
      })
    }
  }

  return items
}

/** 3. Region Deep Dive Insights (at least 6 points) */
export function getRegionDeepDiveInsights(regionName: string, regData: any, portfolioTotal: number, onDrill?: (title: string, params: any) => void): InsightItem[] {
  const items: InsightItem[] = []
  if (!regData) return items

  const regAcv = regData.total?.acv || regData.acv || 0
  const portTotal = portfolioTotal || 1
  const shareOfPort = ((regAcv / portTotal) * 100).toFixed(1)

  // 1. Portfolio share
  items.push({
    id: 'rdd-share',
    text: (
      <span>
        <strong>{regionName}</strong> represents <strong>{shareOfPort}%</strong> ({acvM(regAcv)}) of total portfolio renewals.
      </span>
    ),
  })

  // 2. Commit coverage
  const fcMap = (regData.forecast_categories || []).reduce((acc: any, c: any) => ({ ...acc, [c.category]: c.acv }), {})
  const commitAcv = regData.categories?.['Commit']?.acv || fcMap['Commit'] || 0
  const closedAcv = regData.categories?.['Closed']?.acv || fcMap['Closed'] || 0
  const bestCaseAcv = regData.categories?.['Best Case']?.acv || fcMap['Best Case'] || 0
  if (regAcv > 0) {
    const covPct = regData.commit_pct != null ? regData.commit_pct : (((commitAcv + closedAcv) / regAcv) * 100).toFixed(1)
    items.push({
      id: 'rdd-coverage',
      text: (
        <span>
          Commit coverage in {regionName} stands at <strong>{covPct}%</strong> ({acvM(commitAcv + closedAcv)} Closed + Commit).
        </span>
      ),
    })
  }

  // 3. Delayed / slippage
  const delayedAcv = regData.delayed_acv ?? regData.delayed?.acv ?? 0
  const delayedCount = regData.delayed_count ?? regData.delayed?.count ?? 0
  if (delayedAcv > 0 || delayedCount > 0) {
    items.push({
      id: 'rdd-delayed',
      text: (
        <span>
          <strong>{acvM(delayedAcv)}</strong> ({delayedCount} deals) are currently classified as delayed in this region.
        </span>
      ),
      linkText: 'View delayed',
      onLinkClick: onDrill ? () => onDrill(`${regionName} Delayed Deals`, { region: regionName, kind: 'delayed' }) : undefined,
    })
  } else {
    items.push({
      id: 'rdd-delayed-clean',
      text: (
        <span>
          Clean execution: <strong>Zero deals</strong> are currently flagged as overdue or delayed in {regionName}.
        </span>
      ),
    })
  }

  // 4. Top account
  const topAcc = regData.top_accounts?.[0]
  if (topAcc) {
    items.push({
      id: 'rdd-top-account',
      text: (
        <span>
          Key account: <strong>{topAcc.account_name || topAcc.name}</strong> holds <strong>{acvM(topAcc.acv)}</strong> ({topAcc.pct_acv || '—'}% of territory).
        </span>
      ),
      linkText: 'View account',
      onLinkClick: onDrill ? () => onDrill(`${topAcc.account_name} Deals`, { region: regionName, account_name: topAcc.account_name }) : undefined,
    })
  }

  // 5. Governance / Approval status
  const approvedPct = regData.approved_pct ?? '—'
  const unsubmitted = regData.approval_statuses?.find((s: any) => s.status === 'Not submitted' || s.status === 'Blank')
  if (unsubmitted && (unsubmitted.count > 0 || unsubmitted.acv > 0)) {
    items.push({
      id: 'rdd-governance',
      text: (
        <span>
          Governance readiness: <strong>{approvedPct}%</strong> approved; <strong>{unsubmitted.count} deals</strong> ({acvM(unsubmitted.acv)}) not yet submitted.
        </span>
      ),
      linkText: 'View unsubmitted',
      onLinkClick: onDrill ? () => onDrill(`${regionName} Unsubmitted`, { region: regionName, status: 'Not submitted' }) : undefined,
    })
  } else {
    items.push({
      id: 'rdd-governance-clean',
      text: (
        <span>
          Governance posture: <strong>{approvedPct}%</strong> of {regionName} renewals have secured formal approval.
        </span>
      ),
    })
  }

  // 6. Business Unit mix
  const topBu = regData.business_units?.[0]
  if (topBu) {
    items.push({
      id: 'rdd-top-bu',
      text: (
        <span>
          Leading business unit: <strong>{topBu.bu}</strong> contributes <strong>{acvM(topBu.acv)}</strong> ({topBu.share_pct || '—'}% of region).
        </span>
      ),
      linkText: 'View BU',
      onLinkClick: onDrill ? () => onDrill(`${regionName} - ${topBu.bu}`, { region: regionName, bu: topBu.bu }) : undefined,
    })
  }

  return items
}

/** 4. Business Units Insights Generator (at least 6 points) */
export function getBusinessUnitsInsights(buSummary: any, onDrill?: (title: string, params: any) => void): InsightItem[] {
  const items: InsightItem[] = []
  if (!buSummary) return items

  const rows = buSummary.rows || buSummary.by_bu || []
  const totalAcv = buSummary.total?.acv || 1

  if (rows.length > 0) {
    const sorted = [...rows].sort((a: any, b: any) => (b.acv || 0) - (a.acv || 0))
    const topBu = sorted[0]

    // 1. Top BU share
    if (topBu) {
      const share = ((topBu.acv / totalAcv) * 100).toFixed(1)
      items.push({
        id: 'bu-top',
        text: (
          <span>
            <strong>{topBu.bu || topBu.name}</strong> leads with <strong>{share}%</strong> ({acvM(topBu.acv)}) of portfolio renewals.
          </span>
        ),
        linkText: 'View BU',
        onLinkClick: onDrill ? () => onDrill(`${topBu.bu || topBu.name} Deals`, { bu: topBu.bu || topBu.name }) : undefined,
      })
    }

    // 2. Top 3 BU concentration
    if (sorted.length >= 3) {
      const top3Acv = (sorted[0]?.acv || 0) + (sorted[1]?.acv || 0) + (sorted[2]?.acv || 0)
      const top3Share = ((top3Acv / totalAcv) * 100).toFixed(1)
      items.push({
        id: 'bu-top-3-share',
        text: (
          <span>
            Territory concentration: Top 3 business units hold <strong>{top3Share}%</strong> ({acvM(top3Acv)}) of overall renewals.
          </span>
        ),
      })
    }

    // 3. Highest commit coverage
    const withCov = rows.map((r: any) => {
      const cAcv = r.cells?.['Commit']?.acv || r.categories?.['Commit']?.acv || r.commit_acv || 0
      const clAcv = r.cells?.['Closed']?.acv || r.categories?.['Closed']?.acv || r.closed_acv || 0
      const bAcv = r.acv || 1
      return { name: r.bu || r.name, cov: ((cAcv + clAcv) / bAcv) * 100, commitAcv: cAcv + clAcv, bu: r.bu || r.name }
    }).filter((r: any) => r.commitAcv > 0).sort((a: any, b: any) => b.cov - a.cov)

    if (withCov.length > 0) {
      const highestCov = withCov[0]
      items.push({
        id: 'bu-highest-cov',
        text: (
          <span>
            Strongest commitment: <strong>{highestCov.name}</strong> has a <strong>{highestCov.cov.toFixed(1)}%</strong> coverage rate (Closed + Commit).
          </span>
        ),
        linkText: 'Review',
        onLinkClick: onDrill ? () => onDrill(`${highestCov.bu} Commit`, { bu: highestCov.bu, category: 'Commit' }) : undefined,
      })
    }

    // 4. Lowest commit coverage
    if (withCov.length > 1) {
      const lowestCov = withCov[withCov.length - 1]
      items.push({
        id: 'bu-lowest-cov',
        text: (
          <span>
            Upside opportunity: <strong>{lowestCov.name}</strong> has lowest coverage at <strong>{lowestCov.cov.toFixed(1)}%</strong> with higher Best Case/Pipeline reserves.
          </span>
        ),
        linkText: 'Inspect',
        onLinkClick: onDrill ? () => onDrill(`${lowestCov.bu} Pipeline`, { bu: lowestCov.bu }) : undefined,
      })
    }

    // 5. Largest delta gain vs baseline
    const getDeltaY = (r: any) => r.delta_yesterday?.acv ?? r.delta_lastweek?.acv ?? 0
    const gains = rows.filter((r: any) => getDeltaY(r) > 0)
    if (gains.length > 0) {
      const topGain = gains.sort((a: any, b: any) => getDeltaY(b) - getDeltaY(a))[0]
      items.push({
        id: 'bu-top-gain',
        text: (
          <span>
            Largest expansion: <strong>{topGain.bu || topGain.name}</strong> expanded by <strong>+{acvM(getDeltaY(topGain))}</strong> vs baseline.
          </span>
        ),
      })
    }

    // 6. Largest delta contraction vs baseline
    const drops = rows.filter((r: any) => getDeltaY(r) < 0)
    if (drops.length > 0) {
      const topDrop = drops.sort((a: any, b: any) => getDeltaY(a) - getDeltaY(b))[0]
      items.push({
        id: 'bu-top-drop',
        text: (
          <span>
            Largest contraction: <strong>{topDrop.bu || topDrop.name}</strong> contracted by <strong>-{acvM(Math.abs(getDeltaY(topDrop)))}</strong> vs baseline.
          </span>
        ),
      })
    } else {
      items.push({
        id: 'bu-stable-trajectory',
        text: (
          <span>
            Portfolio stability: <strong>Zero business units</strong> experienced net ACV contraction vs comparison baseline.
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

/** 5. Approvals Insights Generator (Approval Watchlist with at least 6 points) */
export function getApprovalsInsights(approvalsData: any, onDrill?: (title: string, params: any) => void): InsightItem[] {
  const items: InsightItem[] = []
  if (!approvalsData) return items

  const totalAcv = approvalsData.total?.acv || 1
  const appMap = approvalsData.statuses || []

  // 1. Commit unapproved
  const commitUnapproved = approvalsData.commit_not_approved || approvalsData.commit_unapproved || approvalsData.unapproved_commit
  if (commitUnapproved && commitUnapproved.count > 0) {
    items.push({
      id: 'app-commit-unapproved',
      text: (
        <span>
          Commit risk: <strong>{commitUnapproved.count} Commit contracts</strong> ({acvM(commitUnapproved.acv)}) are awaiting sign-off.
        </span>
      ),
      linkText: 'Inspect deals',
      onLinkClick: onDrill ? () => onDrill('Commit Deals Awaiting Approval', { forecast_category: 'Commit', approval_status: 'not_approved' }) : undefined,
    })
  }

  // 2. Pending approval total
  const pendingStatus = appMap.find((s: any) => s.status === 'Pending Approval' || s.status === 'Pending')
  if (pendingStatus && pendingStatus.count > 0) {
    const pShare = ((pendingStatus.acv / totalAcv) * 100).toFixed(1)
    items.push({
      id: 'app-pending-share',
      text: (
        <span>
          In-flight queue: <strong>{pendingStatus.count} deals</strong> ({acvM(pendingStatus.acv)}, {pShare}% of ACV) are undergoing formal review.
        </span>
      ),
      linkText: 'View pending',
      onLinkClick: onDrill ? () => onDrill('Pending Deals', { approval_status: 'Pending Approval' }) : undefined,
    })
  }

  // 3. Portfolio approved share
  const approvedStatus = appMap.find((s: any) => s.status === 'Approved')
  if (approvedStatus && approvedStatus.acv > 0) {
    const aShare = ((approvedStatus.acv / totalAcv) * 100).toFixed(1)
    items.push({
      id: 'app-approved-share',
      text: (
        <span>
          Governance readiness: <strong>{aShare}%</strong> ({acvM(approvedStatus.acv)}) of contract value is fully approved.
        </span>
      ),
    })
  }

  // 4. Unsubmitted / Blank status
  const unsubmitted = appMap.find((s: any) => s.status === 'Blank' || s.status === 'Not submitted')
  if (unsubmitted && (unsubmitted.count > 0 || unsubmitted.acv > 0)) {
    const uShare = ((unsubmitted.acv / totalAcv) * 100).toFixed(1)
    items.push({
      id: 'app-unsubmitted-share',
      text: (
        <span>
          Not submitted: <strong>{unsubmitted.count} deals</strong> ({acvM(unsubmitted.acv)}, {uShare}% of portfolio) have no governance record.
        </span>
      ),
      linkText: 'View unsubmitted',
      onLinkClick: onDrill ? () => onDrill('Not Submitted Deals', { approval_status: 'Blank' }) : undefined,
    })
  }

  // 5. Approval coverage benchmark
  if (approvalsData.approval_coverage?.portfolio_average_pct != null) {
    items.push({
      id: 'app-cov-benchmark',
      text: (
        <span>
          Benchmark pace: Portfolio average approval coverage currently stands at <strong>{approvalsData.approval_coverage.portfolio_average_pct}%</strong>.
        </span>
      ),
    })
  }

  // 6. Ageing queue exposure
  const ageing = approvalsData.pending_ageing
  if (ageing && (ageing.count > 0 || ageing.acv > 0)) {
    items.push({
      id: 'app-ageing-alert',
      text: (
        <span>
          Ageing queue: <strong>{ageing.count} pending deals</strong> ({acvM(ageing.acv)}) have extended review duration.
        </span>
      ),
      linkText: 'Review ageing',
      onLinkClick: onDrill ? () => onDrill('Pending Ageing Deals', { approval_status: 'Pending Approval' }) : undefined,
    })
  } else {
    items.push({
      id: 'app-ageing-clean',
      text: (
        <span>
          Workflow velocity: <strong>Zero deals</strong> are currently delayed beyond SLA guidelines in the approval queue.
        </span>
      ),
    })
  }

  return items
}

/** 6. Delayed Renewals Summary Generator (at least 6 points without decorative icons) */
export function getDelayedInsights(
  summary: any,
  onDrill?: (title: string, params: any) => void,
  onSelectOpp?: (id: string) => void
): InsightItem[] {
  const items: InsightItem[] = []
  if (!summary) return items

  const delRenewals = summary.delayed_renewals
  const delTot = summary.delayed_renewals_total || delRenewals?.total || summary.total || { count: 0, acv: 0 }
  const qTotAcv = summary.quarter_total_acv || 1
  const overdue = delRenewals?.overdue || summary.overdue || { count: 0, acv: 0 }
  const ahead = delRenewals?.ahead || summary.ahead || delRenewals?.later_close || summary.later_close || { count: 0, acv: 0 }

  // 1. Total delayed
  const delPct = ((delTot.acv / qTotAcv) * 100).toFixed(1)
  items.push({
    id: 'delayed-total-summary',
    text: (
      <span>
        Delayed volume: <strong>{delTot.count || 0} contracts</strong> ({acvM(delTot.acv)}) represent <strong>{delPct}%</strong> of quarterly renewals.
      </span>
    ),
    linkText: 'View delayed',
    onLinkClick: onDrill ? () => onDrill('All Delayed Deals', { kind: 'delayed_total' }) : undefined,
  })

  // 2. Close date ahead
  items.push({
    id: 'delayed-ahead-summary',
    text: (
      <span>
        Close date ahead: <strong>{ahead.count || 0} deals</strong> ({acvM(ahead.acv || 0)}) have service active while target close remains in future.
      </span>
    ),
    linkText: 'View ahead',
    onLinkClick: onDrill ? () => onDrill('Delayed Close Date Ahead Deals', { kind: 'later_close' }) : undefined,
  })

  // 3. Overdue count
  if ((overdue.count || 0) > 0) {
    items.push({
      id: 'delayed-overdue-summary',
      text: (
        <span>
          Overdue contracts: <strong>{overdue.count} deals</strong> ({acvM(overdue.acv || 0)}) are past their scheduled close target.
        </span>
      ),
      linkText: 'View overdue',
      onLinkClick: onDrill ? () => onDrill('Overdue Deals', { kind: 'overdue' }) : undefined,
    })
  } else {
    items.push({
      id: 'delayed-overdue-clean',
      text: (
        <span>
          Past-due exposure: <strong>Zero deals</strong> are currently overdue past their target close date.
        </span>
      ),
    })
  }

  // 4. Largest single delayed deal
  const topDeals = summary.top_deals || []
  if (topDeals.length > 0) {
    const topDeal = topDeals[0]
    items.push({
      id: 'delayed-largest-deal',
      text: (
        <span>
          Largest delayed contract: <strong>{topDeal.opportunity_name}</strong> ({acvM(topDeal.forecast_acv_amount || 0)}) targeting close on {topDeal.close_date || 'scheduled date'}.
        </span>
      ),
      linkText: 'Inspect deal',
      onLinkClick: onSelectOpp && topDeal.opportunity_id_18
        ? () => onSelectOpp(topDeal.opportunity_id_18)
        : onDrill
          ? () => onDrill(`Inspect Deal: ${topDeal.opportunity_name}`, {
              kind: 'delayed_total',
              opp_id: topDeal.opportunity_id_18,
              deal_ids: topDeal.opportunity_id_18,
              deals: [topDeal],
            })
          : undefined,
    })
  }

  // 5. Top delayed BU
  const buRows = summary.by_bu || []
  if (buRows.length > 0) {
    const sortedBu = [...buRows].sort((a: any, b: any) => (b.acv || 0) - (a.acv || 0))
    const topBu = sortedBu[0]
    items.push({
      id: 'delayed-top-bu',
      text: (
        <span>
          Primary BU concentration: <strong>{topBu.label || topBu.name}</strong> accounts for <strong>{acvM(topBu.acv || 0)}</strong> ({topBu.count || 0} delayed deals).
        </span>
      ),
      linkText: 'View BU',
      onLinkClick: onDrill ? () => onDrill(`Delayed Deals · ${topBu.label || topBu.name}`, { kind: 'delayed_total', bu: topBu.label || topBu.name }) : undefined,
    })
  }

  // 6. Forecast category with the most delayed ACV
  const catMap: Record<string, { count: number; acv: number }> = {}
  buRows.forEach((r: any) => {
    Object.entries(r.categories || {}).forEach(([cat, val]: [string, any]) => {
      if (!catMap[cat]) catMap[cat] = { count: 0, acv: 0 }
      catMap[cat].count += val.count || 0
      catMap[cat].acv += val.acv || 0
    })
  })
  const sortedCats = Object.entries(catMap).sort((a, b) => b[1].acv - a[1].acv)
  if (sortedCats.length > 0) {
    const topCat = sortedCats[0]
    items.push({
      id: 'delayed-top-category',
      text: (
        <span>
          Forecast risk: <strong>{topCat[0]}</strong> holds highest delayed volume with <strong>{acvM(topCat[1].acv)}</strong> ({topCat[1].count} contracts).
        </span>
      ),
      linkText: 'View category',
      onLinkClick: onDrill ? () => onDrill(`Delayed Deals · ${topCat[0]}`, { kind: 'delayed_total', category: topCat[0] }) : undefined,
    })
  }

  return items
}

/** 6b. Top Delayed Deals Signals Generator (at least 6 points without decorative icons) */
export function getTopDelayedDealsSignals(summary: any, onSelectOpp?: (id: string) => void): InsightItem[] {
  const items: InsightItem[] = []
  if (!summary) return items

  const topDeals = summary.top_deals || []
  if (topDeals.length === 0) return items

  const delTot = summary.delayed_renewals_total || summary.delayed_renewals?.total || summary.total || { count: 0, acv: 0 }
  const totalDelayedAcv = delTot.acv || 1
  const top10Acv = topDeals.reduce((s: number, d: any) => s + (d.forecast_acv_amount || 0), 0)
  const top10Pct = ((top10Acv / totalDelayedAcv) * 100).toFixed(1)

  // 1. Largest deal ACV and close date
  const topDeal = topDeals[0]
  if (topDeal) {
    items.push({
      id: 'tds-largest-deal',
      text: (
        <span>
          Largest delayed deal: <strong>{topDeal.opportunity_name}</strong> holds <strong>{acvM(topDeal.forecast_acv_amount || 0)}</strong> with close target {topDeal.close_date || 'scheduled date'}.
        </span>
      ),
      linkText: 'Inspect deal',
      onLinkClick: onSelectOpp && topDeal.opportunity_id_18 ? () => onSelectOpp(topDeal.opportunity_id_18) : undefined,
    })
  }

  // 2. Average deal size
  const avgSize = top10Acv / topDeals.length
  items.push({
    id: 'tds-avg-size',
    text: (
      <span>
        Average deal size: Top delayed opportunities average <strong>{acvM(avgSize)}</strong> across {topDeals.length} high-value contracts.
      </span>
    ),
  })

  // 3. Account concentration
  items.push({
    id: 'tds-concentration',
    text: (
      <span>
        Portfolio concentration: Top {topDeals.length} delayed contracts represent <strong>{top10Pct}%</strong> ({acvM(top10Acv)}) of total delayed capital.
      </span>
    ),
  })

  // 4. Region with most delayed deals in top 10
  const regCounts: Record<string, { count: number; acv: number }> = {}
  topDeals.forEach((d: any) => {
    const r = d.region || 'Unknown'
    if (!regCounts[r]) regCounts[r] = { count: 0, acv: 0 }
    regCounts[r].count += 1
    regCounts[r].acv += d.forecast_acv_amount || 0
  })
  const sortedRegs = Object.entries(regCounts).sort((a, b) => b[1].count - a[1].count)
  if (sortedRegs.length > 0) {
    const topReg = sortedRegs[0]
    items.push({
      id: 'tds-top-region',
      text: (
        <span>
          Regional cluster: <strong>{topReg[0]}</strong> holds <strong>{topReg[1].count} of top deals</strong> ({acvM(topReg[1].acv)}).
        </span>
      ),
    })
  }

  // 5. Count with missing service start date / review exceptions
  const missingItem = summary.needs_review?.items?.find((i: any) => i.type === 'missing_service_start' || i.type === 'missing_start_date')
  const missingCount = missingItem?.count || topDeals.filter((d: any) => !d.service_start_date).length
  const missingAcv = missingItem?.acv || topDeals.filter((d: any) => !d.service_start_date).reduce((s: number, d: any) => s + (d.forecast_acv_amount || 0), 0)
  items.push({
    id: 'tds-missing-service-start',
    text: (
      <span>
        Verification required: <strong>{missingCount} contracts</strong> ({acvM(missingAcv)}) in review have missing or unconfirmed service start dates.
      </span>
    ),
  })

  // 6. Next closing deal
  const soonestDeal = [...topDeals]
    .filter((d: any) => d.days_to_close > 0)
    .sort((a: any, b: any) => a.days_to_close - b.days_to_close)[0]
  if (soonestDeal) {
    items.push({
      id: 'tds-next-closing',
      text: (
        <span>
          Next closing renewal: <strong>{soonestDeal.opportunity_name}</strong> ({acvM(soonestDeal.forecast_acv_amount || 0)}) target close in <strong>{soonestDeal.days_to_close} days</strong>.
        </span>
      ),
      linkText: 'Inspect deal',
      onLinkClick: onSelectOpp && soonestDeal.opportunity_id_18 ? () => onSelectOpp(soonestDeal.opportunity_id_18) : undefined,
    })
  } else {
    items.push({
      id: 'tds-closing-schedule',
      text: (
        <span>
          Closing cadence: All top delayed deals have active timing buffers under review.
        </span>
      ),
    })
  }

  return items
}

/** 6b. Lost Deals Insights Generator */
export function getLostInsights(lostSummary: any, lostByRegion: any[] = [], lostByBu: any[] = [], onDrill?: (title: string, params: any) => void): InsightItem[] {
  const items: InsightItem[] = []
  if (!lostSummary) return items

  const count = lostSummary.count || 0
  const acv = lostSummary.acv || 0

  items.push({
    id: 'lost-overview',
    icon: TrendingDown,
    text: (
      <span>
        A total of <strong>{count} deals ({acvM(acv)})</strong> have been removed or lost since the baseline period start.
      </span>
    ),
    linkText: 'View all lost',
    onLinkClick: onDrill ? () => onDrill('Lost Deals', { kind: 'lost' }) : undefined,
  })

  if (lostByRegion.length > 0) {
    const topReg = lostByRegion[0]
    items.push({
      id: 'lost-top-region',
      icon: Award,
      text: (
        <span>
          Highest regional loss: <strong>{topReg.name}</strong> accounts for <strong>{acvM(topReg.acv)}</strong> ({topReg.pct?.toFixed(1)}% of total lost ACV).
        </span>
      ),
      linkText: 'View region',
      onLinkClick: onDrill ? () => onDrill(`Lost Deals · ${topReg.name}`, { kind: 'lost', region: topReg.name }) : undefined,
    })
  }

  if (lostByBu.length > 0) {
    const topBu = lostByBu[0]
    items.push({
      id: 'lost-top-bu',
      icon: PieChart,
      text: (
        <span>
          Leading BU loss: <strong>{topBu.name}</strong> accounts for <strong>{acvM(topBu.acv)}</strong> across {topBu.count} deals.
        </span>
      ),
      linkText: 'View BU',
      onLinkClick: onDrill ? () => onDrill(`Lost Deals · ${topBu.name}`, { kind: 'lost', business_unit: topBu.name }) : undefined,
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
          Slippage to 2027 tracking: <strong>{sum.slippage.count} renewals</strong> ({acvM(sum.slippage.acv)}) are pushed to close in FY{fy2 || '2027'}.
        </span>
      ),
      linkText: 'View deals',
      onLinkClick: onDrill ? () => onDrill(`Slippage to 2027`, { slippage: true }) : undefined,
    })
  }

  return items
}
