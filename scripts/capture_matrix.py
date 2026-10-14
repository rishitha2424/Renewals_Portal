import subprocess
import time
from pathlib import Path

PAGES = [
    ("overview", "http://localhost:5173/"),
    ("expiry", "http://localhost:5173/expiry"),
    ("approvals", "http://localhost:5173/approvals"),
    ("business_units", "http://localhost:5173/business-units"),
    ("regions", "http://localhost:5173/regions"),
    ("delayed", "http://localhost:5173/delayed"),
    ("explorer", "http://localhost:5173/opportunities"),
    ("data_uploads", "http://localhost:5173/data-uploads"),
    ("executive", "http://localhost:5173/executive"),
]

THEMES = ["light", "dark"]
ZOOMS = [
    ("zoom100", "1440, 900"),
    ("zoom125", "1152, 720"),  # 1440/1.25, 900/1.25 emulating 125% zoom
]

out_dir = Path("docs/screenshots/matrix").resolve()
out_dir.mkdir(parents=True, exist_ok=True)

success_count = 0
total_count = len(PAGES) * len(THEMES) * len(ZOOMS)

print(f"Capturing {total_count} matrix screenshots waiting for data...")

for page_key, url in PAGES:
    for theme in THEMES:
        for zoom_key, viewport in ZOOMS:
            out_name = f"{page_key}_{theme}_{zoom_key}.png"
            out_path = out_dir / out_name

            cmd = [
                "npx", "playwright", "screenshot",
                "--channel=msedge",
                f"--viewport-size={viewport}",
                f"--color-scheme={theme}",
                "--wait-for-timeout=4000",
                url,
                str(out_path),
            ]

            res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            if res.returncode == 0 and out_path.exists():
                sz_kb = out_path.stat().st_size / 1024
                success_count += 1
                print(f"[{success_count}/{total_count}] OK: {out_name} ({sz_kb:.1f} KB)")
            else:
                print(f"FAIL: {out_name} - {res.stderr[:200]}")

print(f"\nCompleted {success_count}/{total_count} matrix screenshots in docs/screenshots/matrix/.")
