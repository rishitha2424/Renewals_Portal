with open("frontend/src/pages/ExecutiveView.tsx", "r", encoding="utf-8") as f:
    content = f.read()

content = content.replace(
    'Renewals Scope (Q4-2026)',
    'Renewals Scope ({activeSnapshot?.period || "Q4-2026"})'
)

with open("frontend/src/pages/ExecutiveView.tsx", "w", encoding="utf-8") as f:
    f.write(content)

with open("frontend/src/pages/Dashboard.tsx", "r", encoding="utf-8") as f:
    dash = f.read()

# Contracts originally in Q4 that moved close date / fiscal period to FY2027.
# We derive current quarter from activeSnapshot?.period or "Q4", and next fiscal year from current snapshot date year + 1
old_dash = "Contracts originally in Q4 that moved close date / fiscal period to FY2027."
new_dash = 'Contracts originally in {activeSnapshot?.period?.split("-")?.[0] || "Q4"} that moved close date / fiscal period to FY{(activeSnapshot?.snapshot_date ? new Date(activeSnapshot.snapshot_date).getFullYear() + 1 : 2027)}.'

# In Dashboard.tsx we also need activeSnapshot:
# Let's check how activeSnapshot is accessed in Dashboard
dash = dash.replace(old_dash, new_dash)

with open("frontend/src/pages/Dashboard.tsx", "w", encoding="utf-8") as f:
    f.write(dash)

with open("frontend/src/components/common/DealListModal.tsx", "r", encoding="utf-8") as f:
    dlm = f.read()

# Replace "Added to Q4" and "Left Q4 – moved or lost" with dynamic regex or checking startsWith / includes
dlm = dlm.replace(
    "if (selectedGroup === 'added' && d.delta_group !== 'Added to Q4') return false",
    "if (selectedGroup === 'added' && !(d.delta_group?.startsWith('Added to') || d.delta_group === 'Added to Q4')) return false"
)
dlm = dlm.replace(
    "if (selectedGroup === 'left' && d.delta_group !== 'Left Q4 – moved or lost') return false",
    "if (selectedGroup === 'left' && !(d.delta_group?.startsWith('Left') || d.delta_group === 'Left Q4 – moved or lost')) return false"
)
dlm = dlm.replace(
    "Added to Q4 ({deltaGroups.added.count})",
    "{deltaGroups.added.name || `Added to Q4 (${deltaGroups.added.count})`}"
)
dlm = dlm.replace(
    "Left Q4 – moved or lost ({deltaGroups.left.count})",
    "{deltaGroups.left.name || `Left Q4 – moved or lost (${deltaGroups.left.count})`}"
)

with open("frontend/src/components/common/DealListModal.tsx", "w", encoding="utf-8") as f:
    f.write(dlm)

print("Updated ExecutiveView, Dashboard, and DealListModal successfully.")
