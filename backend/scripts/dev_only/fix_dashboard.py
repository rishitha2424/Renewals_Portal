import re

with open("frontend/src/pages/Dashboard.tsx", "r", encoding="utf-8") as f:
    c = f.read()

# Replace any malformed arrow function
c = c.replace("activeSnapshot = snapshots.find(s = === activeSnapshotId)", "activeSnapshot = snapshots.find((s: any) => s.id === activeSnapshotId)")

with open("frontend/src/pages/Dashboard.tsx", "w", encoding="utf-8") as f:
    f.write(c)

print("Cleaned Dashboard.tsx")
