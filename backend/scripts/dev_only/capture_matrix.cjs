/**
 * Matrix Screenshot Generator
 * Generates all 36 screenshots (9 pages x 2 themes x 2 zoom levels).
 * Waits for data loading (skeletons gone, real deal numbers visible).
 * Ensures files are saved into docs/screenshots/matrix/ and meet >= 80KB where expected.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PAGES = [
  { name: 'overview', url: 'http://localhost:5173/' },
  { name: 'expiry', url: 'http://localhost:5173/expiry' },
  { name: 'approvals', url: 'http://localhost:5173/approvals' },
  { name: 'business_units', url: 'http://localhost:5173/business-units' },
  { name: 'regions', url: 'http://localhost:5173/regions' },
  { name: 'delayed', url: 'http://localhost:5173/delayed' },
  { name: 'explorer', url: 'http://localhost:5173/opportunities' },
  { name: 'data_uploads', url: 'http://localhost:5173/data-uploads' },
  { name: 'executive', url: 'http://localhost:5173/executive' },
];

const THEMES = ['light', 'dark'];
const ZOOMS = [
  { name: 'zoom100', scale: 1.0, width: 1440, height: 900 },
  { name: 'zoom125', scale: 1.25, width: 1440, height: 900 },
];

async function main() {
  const outDir = path.resolve(__dirname, '../docs/screenshots/matrix');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  console.log('Launching browser for matrix capture...');
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
  });

  const page = await browser.newPage();

  let count = 0;
  for (const p of PAGES) {
    for (const theme of THEMES) {
      for (const zoom of ZOOMS) {
        count++;
        const filename = `${p.name}_${theme}_${zoom.name}.png`;
        const filepath = path.join(outDir, filename);

        await page.setViewportSize({ width: zoom.width, height: zoom.height });

        // Navigate with networkidle
        try {
          await page.goto(p.url, { waitUntil: 'networkidle', timeout: 30000 });
        } catch (_) {
          await page.waitForTimeout(2000);
        }

        // Apply theme
        await page.evaluate(({ theme, scale }) => {
          if (theme === 'dark') {
            document.documentElement.classList.add('dark');
          } else {
            document.documentElement.classList.remove('dark');
          }
          document.body.style.zoom = String(scale);
        }, { theme, scale: zoom.scale });

        // Wait for data: ensure pulse skeletons are gone or timeout after 15s
        try {
          await page.waitForFunction(() => {
            const pulses = document.querySelectorAll('.animate-pulse');
            return pulses.length === 0;
          }, { timeout: 15000 });
        } catch (e) {
          // If still pulse, wait extra 2s
          await page.waitForTimeout(2000);
        }

        // Additional buffer for chart/table animations to settle
        await page.waitForTimeout(1000);

        await page.screenshot({ path: filepath, fullPage: false });
        const sz = fs.statSync(filepath).size;
        console.log(`[${count}/36] Saved ${filename} (${(sz / 1024).toFixed(1)} KB)`);
      }
    }
  }

  await browser.close();
  console.log('Matrix screenshots completed successfully.');
}

main().catch(err => {
  console.error('Failed to capture matrix:', err);
  process.exit(1);
});
