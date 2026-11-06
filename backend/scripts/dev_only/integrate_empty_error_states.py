import os

# 1. Update Dashboard.tsx
with open("frontend/src/pages/Dashboard.tsx", "r", encoding="utf-8") as f:
    c = f.read()

# Add imports
if 'PageErrorState' not in c:
    c = c.replace(
        "import EmptyState from '@/components/ui/EmptyState'",
        "import EmptyState from '@/components/ui/EmptyState'\nimport PageErrorState from '@/components/ui/PageErrorState'\nimport PageNoSnapshotState from '@/components/ui/PageNoSnapshotState'"
    )

# Replace empty snapshots check
old_empty_snap = """  if (snapshots.length === 0 && !isLoading) {
    return (
      <EmptyState
        title="No Snapshot Data Found"
        description="Please upload renewal workbooks to initialize the pipeline intelligence platform."
      />
    )
  }"""
new_empty_snap = """  if (snapshots.length === 0 && !isLoading) {
    return <PageNoSnapshotState />
  }"""
c = c.replace(old_empty_snap, new_empty_snap)

# Replace error check
old_err = """  if (summary?.error || movements?.error || regional?.error) {
    return <div className="p-8 text-center text-rose-500 font-semibold bg-rose-50 border border-rose-200 rounded-xl m-6">{summary?.error || movements?.error || regional?.error}</div>
  }"""
new_err = """  if (summary?.error || movements?.error || regional?.error) {
    return <PageErrorState onRetry={refetchAll} />
  }"""
c = c.replace(old_err, new_err)

with open("frontend/src/pages/Dashboard.tsx", "w", encoding="utf-8") as f:
    f.write(c)


# 2. Update Expiry.tsx
with open("frontend/src/pages/Expiry.tsx", "r", encoding="utf-8") as f:
    c = f.read()

if 'PageErrorState' not in c:
    c = c.replace(
        "import { EmptyState } from '@/components/ui/EmptyState'",
        "import { EmptyState } from '@/components/ui/EmptyState'\nimport PageErrorState from '@/components/ui/PageErrorState'\nimport PageNoSnapshotState from '@/components/ui/PageNoSnapshotState'"
    )

old_exp_snap = """  if (!activeSnapshotId) {
    return <EmptyState title="No active snapshot" description="Please upload or select a snapshot." icon={<AlertTriangle className="w-10 h-10 text-[var(--text-muted)]" />} />
  }"""
new_exp_snap = """  if (!activeSnapshotId || snapshots.length === 0) {
    return <PageNoSnapshotState />
  }"""
c = c.replace(old_exp_snap, new_exp_snap)

old_exp_err = """  if (isError || !sum || sum.error) {
    return <div className="p-8 text-center text-rose-500 font-semibold bg-rose-50 border border-rose-200 rounded-xl m-6">{sum?.error || 'Failed to load Expiry view.'}</div>
  }"""
new_exp_err = """  if (isError || !sum || sum.error) {
    return <PageErrorState onRetry={() => window.location.reload()} />
  }"""
c = c.replace(old_exp_err, new_exp_err)

with open("frontend/src/pages/Expiry.tsx", "w", encoding="utf-8") as f:
    f.write(c)


# 3. Update Approvals.tsx
with open("frontend/src/pages/Approvals.tsx", "r", encoding="utf-8") as f:
    c = f.read()

if 'PageErrorState' not in c:
    c = c.replace(
        "import EmptyState from '@/components/ui/EmptyState'",
        "import EmptyState from '@/components/ui/EmptyState'\nimport PageErrorState from '@/components/ui/PageErrorState'\nimport PageNoSnapshotState from '@/components/ui/PageNoSnapshotState'"
    )

c = c.replace(
    'if (!activeSnapshotId) return <EmptyState title="No active snapshot" description="Select a snapshot to view data" />',
    'if (!activeSnapshotId) return <PageNoSnapshotState />'
)
c = c.replace(
    'if (error || data?.error) return <div className="p-8 text-center text-rose-500 font-semibold bg-rose-50 border border-rose-200 rounded-xl m-6">{(error as any)?.message || data?.error}</div>',
    'if (error || data?.error) return <PageErrorState onRetry={() => refetch()} />'
)

with open("frontend/src/pages/Approvals.tsx", "w", encoding="utf-8") as f:
    f.write(c)


# 4. Update Delayed.tsx
with open("frontend/src/pages/Delayed.tsx", "r", encoding="utf-8") as f:
    c = f.read()

if 'PageErrorState' not in c:
    c = c.replace(
        "import Card from '@/components/ui/Card'",
        "import Card from '@/components/ui/Card'\nimport PageErrorState from '@/components/ui/PageErrorState'\nimport PageNoSnapshotState from '@/components/ui/PageNoSnapshotState'"
    )

old_del_err = """  if (error || summary?.error) {
    return (
      <div>
        <Card className="p-8 text-center text-red-500">
          <AlertCircle className="w-12 h-12 mx-auto mb-4" />
          <h2 className="text-lg font-semibold mb-2">Could not load Delayed data</h2>
          <p className="text-sm opacity-80">{summary?.error || 'Server error'}</p>
        </Card>
      </div>
    )
  }"""
new_del_err = """  if (!activeSnapshotId) {
    return <PageNoSnapshotState />
  }

  if (error || summary?.error) {
    return <PageErrorState />
  }"""
c = c.replace(old_del_err, new_del_err)

with open("frontend/src/pages/Delayed.tsx", "w", encoding="utf-8") as f:
    f.write(c)


# 5. Update Regions.tsx
with open("frontend/src/pages/Regions.tsx", "r", encoding="utf-8") as f:
    c = f.read()

if 'PageErrorState' not in c:
    c = c.replace(
        "import { Card } from '@/components/ui/Card'",
        "import { Card } from '@/components/ui/Card'\nimport PageErrorState from '@/components/ui/PageErrorState'\nimport PageNoSnapshotState from '@/components/ui/PageNoSnapshotState'"
    )

old_reg_err = """  if (error || (summary && summary.error)) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-3 text-red-500 mb-2">
          <AlertOctagon className="w-5 h-5" />
          <h2 className="text-lg font-semibold">Failed to load Regions</h2>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {error ? error.message : (summary?.error || "Unknown error")}
        </p>
      </Card>
    )
  }"""
new_reg_err = """  if (!activeSnapshotId) {
    return <PageNoSnapshotState />
  }

  if (error || (summary && summary.error)) {
    return <PageErrorState />
  }"""
c = c.replace(old_reg_err, new_reg_err)

with open("frontend/src/pages/Regions.tsx", "w", encoding="utf-8") as f:
    f.write(c)


# 6. Update BusinessUnits.tsx
with open("frontend/src/pages/BusinessUnits.tsx", "r", encoding="utf-8") as f:
    c = f.read()

if 'PageErrorState' not in c:
    c = c.replace(
        "import { Card } from '@/components/ui/Card'",
        "import { Card } from '@/components/ui/Card'\nimport PageErrorState from '@/components/ui/PageErrorState'\nimport PageNoSnapshotState from '@/components/ui/PageNoSnapshotState'"
    )

old_bu_err = """  if (error || (summary && summary.error)) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-3 text-red-500 mb-2">
          <AlertOctagon className="w-6 h-6" />
          <h2 className="text-lg font-bold">Error loading Business Units</h2>
        </div>
        <p className="text-sm text-[var(--text-muted)]">{error?.toString() || summary?.error}</p>
      </Card>
    )
  }"""
new_bu_err = """  if (!activeSnapshotId) {
    return <PageNoSnapshotState />
  }

  if (error || (summary && summary.error)) {
    return <PageErrorState />
  }"""
c = c.replace(old_bu_err, new_bu_err)

with open("frontend/src/pages/BusinessUnits.tsx", "w", encoding="utf-8") as f:
    f.write(c)


# 7. Update ExecutiveView.tsx
with open("frontend/src/pages/ExecutiveView.tsx", "r", encoding="utf-8") as f:
    c = f.read()

if 'PageErrorState' not in c:
    c = c.replace(
        "import Card from '@/components/ui/Card'",
        "import Card from '@/components/ui/Card'\nimport PageErrorState from '@/components/ui/PageErrorState'\nimport PageNoSnapshotState from '@/components/ui/PageNoSnapshotState'"
    )

target_exec_before_return = """  return (
    <div className="min-h-screen bg-[var(--bg-primary)] p-6 space-y-5 max-w-7xl mx-auto pb-10" id="executive-view">"""

new_exec_check = """  if (!activeSnapshotId || snapshots.length === 0) {
    return <PageNoSnapshotState />
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] p-6 space-y-5 max-w-7xl mx-auto pb-10" id="executive-view">"""
c = c.replace(target_exec_before_return, new_exec_check)

with open("frontend/src/pages/ExecutiveView.tsx", "w", encoding="utf-8") as f:
    f.write(c)


# 8. Update Opportunities.tsx
with open("frontend/src/pages/Opportunities.tsx", "r", encoding="utf-8") as f:
    c = f.read()

if 'PageErrorState' not in c:
    c = c.replace(
        "import { Card } from '@/components/ui/Card'",
        "import { Card } from '@/components/ui/Card'\nimport PageErrorState from '@/components/ui/PageErrorState'\nimport PageNoSnapshotState from '@/components/ui/PageNoSnapshotState'"
    )

target_opp_return = """  return (
    <div className="space-y-4 max-w-full" id="data-explorer-page">"""

new_opp_check = """  if (!activeSnapshotId) {
    return <PageNoSnapshotState />
  }

  return (
    <div className="space-y-4 max-w-full" id="data-explorer-page">"""
c = c.replace(target_opp_return, new_opp_check)

with open("frontend/src/pages/Opportunities.tsx", "w", encoding="utf-8") as f:
    f.write(c)

print("Empty and Error states integrated across all pages.")
