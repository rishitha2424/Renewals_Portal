with open("frontend/src/store/appStore.ts", "r", encoding="utf-8") as f:
    store = f.read()

# Add period?: string to SnapshotItem
store = store.replace(
    "  yesterday_date?: string | null\n  row_count: number",
    "  yesterday_date?: string | null\n  period?: string\n  row_count: number"
)

with open("frontend/src/store/appStore.ts", "w", encoding="utf-8") as f:
    f.write(store)

with open("frontend/src/utils/format.ts", "r", encoding="utf-8") as f:
    fmt = f.read()

helper = '''
/** Derive quarter from date string (e.g. "2026-10-07" -> "Q4-2026") */
export function getQuarterFromDate(dateStr?: string | null): string {
  if (!dateStr) return 'Q4-2026'
  const d = new Date(dateStr.length === 10 ? dateStr + 'T00:00:00' : dateStr)
  if (isNaN(d.getTime())) return 'Q4-2026'
  const month = d.getMonth() + 1 // 1-12
  const q = Math.ceil(month / 3)
  return `Q${q}-${d.getFullYear()}`
}
'''

if 'getQuarterFromDate' not in fmt:
    fmt += helper

with open("frontend/src/utils/format.ts", "w", encoding="utf-8") as f:
    f.write(fmt)

# Now update ExecutiveView.tsx
with open("frontend/src/pages/ExecutiveView.tsx", "r", encoding="utf-8") as f:
    ev = f.read()

if 'getQuarterFromDate' not in ev:
    ev = ev.replace(
        "import { formatACV, formatCount, formatDate, formatCurrency } from '@/utils/format'",
        "import { formatACV, formatCount, formatDate, formatCurrency, getQuarterFromDate } from '@/utils/format'"
    )

ev = ev.replace(
    'Renewals Scope ({activeSnapshot?.period || "Q4-2026"})',
    'Renewals Scope ({getQuarterFromDate(activeSnapshot?.snapshot_date)})'
)

with open("frontend/src/pages/ExecutiveView.tsx", "w", encoding="utf-8") as f:
    f.write(ev)

# Now update Dashboard.tsx
with open("frontend/src/pages/Dashboard.tsx", "r", encoding="utf-8") as f:
    db = f.read()

if 'getQuarterFromDate' not in db:
    db = db.replace(
        "import { getForecastCategoryLabel, formatCurrency, formatNumber } from '@/utils/format'",
        "import { getForecastCategoryLabel, formatCurrency, formatNumber, getQuarterFromDate } from '@/utils/format'"
    )

# Target line in Dashboard.tsx:
# Contracts originally in {activeSnapshot?.period?.split("-")?.[0] || "Q4"} that moved close date / fiscal period to FY{(activeSnapshot?.snapshot_date ? new Date(activeSnapshot.snapshot_date).getFullYear() + 1 : 2027)}.
target_str = 'Contracts originally in {activeSnapshot?.period?.split("-")?.[0] || "Q4"} that moved close date / fiscal period to FY{(activeSnapshot?.snapshot_date ? new Date(activeSnapshot.snapshot_date).getFullYear() + 1 : 2027)}.'
replacement_str = 'Contracts originally in {getQuarterFromDate(activeSnapshot?.snapshot_date).split("-")[0]} that moved close date / fiscal period to FY{(activeSnapshot?.snapshot_date ? new Date(activeSnapshot.snapshot_date.length === 10 ? activeSnapshot.snapshot_date + "T00:00:00" : activeSnapshot.snapshot_date).getFullYear() + 1 : 2027)}.'

db = db.replace(target_str, replacement_str)

with open("frontend/src/pages/Dashboard.tsx", "w", encoding="utf-8") as f:
    f.write(db)

print("Applied getQuarterFromDate and updated types successfully.")
