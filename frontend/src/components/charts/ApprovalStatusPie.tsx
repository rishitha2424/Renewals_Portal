import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { useQuery } from '@tanstack/react-query'
import { getApprovalStatus } from '@/api/client'
import { APPROVAL_COLORS, APPROVAL_ORDER } from '@/design/tokens'
import { formatACV, formatCount } from '@/utils/format'
import { SkeletonChart } from '@/components/ui/Skeleton'
import InsightCaption from '@/components/ui/InsightCaption'
import { useAppStore } from '@/store/appStore'

interface Props { snapshotId?: string; data?: any }

export default function ApprovalStatusPie({ snapshotId, data: propData }: Props) {
  const activeId = useAppStore(s => s.activeSnapshotId)
  const snapId = snapshotId ?? activeId ?? undefined

  const { data: fetchedData, isLoading } = useQuery({
    queryKey: ['approval-status', snapId],
    queryFn: () => getApprovalStatus(snapId),
    enabled: !propData,
  })

  if (!propData && isLoading) return <SkeletonChart />

  const data = propData ?? fetchedData

  const rawList: any[] = data?.rows ?? (data?.statuses ? data.statuses.map((s: any) => ({
    approval_status: s.status,
    count: s.count,
    acv: s.acv,
    pct_count: s.pct_count,
    pct_acv: s.pct_acv,
  })) : [])

  const rows: any[] = rawList
    .filter((r: any) => r.count > 0)
    .sort((a: any, b: any) =>
      APPROVAL_ORDER.indexOf(a.approval_status) - APPROVAL_ORDER.indexOf(b.approval_status)
    )

  const topStatus = rows.reduce((a: any, b: any) => (b.count > (a?.count ?? 0) ? b : a), null)
  const totalAcv = data?.total_acv ?? data?.total?.acv ?? 0

  return (
    <div className="card p-5">
      <h3 className="font-semibold text-sm mb-1" style={{ color: 'var(--text-primary)' }}>
        Approval Status
      </h3>
      <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
        Count and ACV by approval state
      </p>

      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={rows}
            dataKey="count"
            nameKey="approval_status"
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={85}
            paddingAngle={3}
            animationBegin={0}
            animationDuration={900}
          >
            {rows.map((r: any) => (
              <Cell
                key={r.approval_status}
                fill={APPROVAL_COLORS[r.approval_status] ?? '#94A3B8'}
              />
            ))}
          </Pie>
          <Tooltip
            content={({ payload }) => {
              if (!payload?.length) return null
              const d = payload[0].payload
              return (
                <div className="card px-3 py-2 text-xs space-y-1">
                  <p className="font-semibold">{d.approval_status}</p>
                  <p>Count: {formatCount(d.count)}</p>
                  <p>ACV: {formatACV(d.acv)}</p>
                </div>
              )
            }}
          />
          <Legend
            iconType="circle"
            iconSize={8}
            formatter={(v) => <span className="text-xs" style={{ color: 'var(--text-primary)' }}>{v}</span>}
          />
        </PieChart>
      </ResponsiveContainer>

      <div className="grid grid-cols-2 gap-2 mt-3">
        {rows.map((r: any) => (
          <div key={r.approval_status} className="flex items-center gap-2 text-xs">
            <div
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: APPROVAL_COLORS[r.approval_status] ?? '#94A3B8' }}
            />
            <span style={{ color: 'var(--text-muted)' }}>{r.approval_status}</span>
            <span className="ml-auto font-semibold" style={{ color: 'var(--text-primary)' }}>
              {formatCount(r.count)}
            </span>
          </div>
        ))}
      </div>

      {topStatus && (
        <InsightCaption
          text={`${topStatus.approval_status} leads with ${formatCount(topStatus.count)} opps (${formatACV(topStatus.acv)})`}
        />
      )}
    </div>
  )
}
