import { chromium } from '../frontend/node_modules/playwright/index.mjs';

const VIEWPORTS = [
  { width: 1366, height: 768, label: '1366x768' },
  { width: 1920, height: 1080, label: '1920x1080' },
];

const ROUTES = [
  { path: '/', name: 'Overview' },
  { path: '/executive', name: 'Executive Summary' },
  { path: '/regions', name: 'Regions' },
  { path: '/business-units', name: 'Business Units' },
  { path: '/approvals', name: 'Approvals' },
  { path: '/delayed', name: 'Delayed Renewals' },
  { path: '/expiry', name: 'Expiry' },
  { path: '/opportunities', name: 'Opportunities' },
  { path: '/uploads', name: 'Data Uploads' },
];

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

async function checkLayout() {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    console.log(`[check_layout] Playwright browser executable is not installed in this environment (${err.message}).`);
    console.log('[check_layout] Skipping live automated layout measurement as instructed.');
    process.exit(0);
  }

  let totalViolations = 0;

  for (const vp of VIEWPORTS) {
    console.log(`\n=== Checking Viewport: ${vp.label} ===`);
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });

    for (const route of ROUTES) {
      const url = `${BASE_URL}${route.path}`;
      try {
        await page.goto(url, { timeout: 20000, waitUntil: 'networkidle' });
      } catch (e) {
        console.warn(`[WARN] Failed to load ${route.name} (${url}): ${e.message}`);
        continue;
      }

      // 1. Horizontal overflow: document.documentElement.scrollWidth > clientWidth
      const horizontalOverflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return {
          hasOverflow: doc.scrollWidth > doc.clientWidth,
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
        };
      });

      if (horizontalOverflow.hasOverflow) {
        console.error(`[VIOLATION] [${vp.label}] ${route.name}: Horizontal overflow detected! (scrollWidth: ${horizontalOverflow.scrollWidth} > clientWidth: ${horizontalOverflow.clientWidth})`);
        totalViolations++;
      }

      // 2. Any <table> whose right edge is beyond its nearest card's right edge by > 1px
      const tableOverflows = await page.evaluate(() => {
        const tables = Array.from(document.querySelectorAll('table'));
        const issues = [];
        for (const tbl of tables) {
          const card = tbl.closest('.card, [class*="card"]');
          if (!card) continue;
          const tblRect = tbl.getBoundingClientRect();
          const cardRect = card.getBoundingClientRect();
          if (tblRect.right > cardRect.right + 1) {
            issues.push({
              tableClass: tbl.className,
              diff: Math.round(tblRect.right - cardRect.right),
            });
          }
        }
        return issues;
      });

      for (const issue of tableOverflows) {
        console.error(`[VIOLATION] [${vp.label}] ${route.name}: Table right edge exceeds nearest card by ${issue.diff}px!`);
        totalViolations++;
      }

      // 3. Any card taller than 1.6 x viewport height
      const tallCards = await page.evaluate((maxHeight) => {
        const cards = Array.from(document.querySelectorAll('.card, [class*="card"]'));
        const issues = [];
        for (const c of cards) {
          const rect = c.getBoundingClientRect();
          if (rect.height > maxHeight) {
            issues.push({
              height: Math.round(rect.height),
              title: c.querySelector('h2, h3, h4')?.textContent?.trim() || 'Untitled card',
            });
          }
        }
        return issues;
      }, 1.6 * vp.height);

      for (const tc of tallCards) {
        console.error(`[VIOLATION] [${vp.label}] ${route.name}: Card "${tc.title}" is excessively tall (${tc.height}px > ${Math.round(1.6 * vp.height)}px)!`);
        totalViolations++;
      }

      // 4. Any CardRow whose children's bottom edges differ by > 4px
      const cardRowMismatches = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('.card-row-grid'));
        const issues = [];
        for (let i = 0; i < rows.length; i++) {
          const children = Array.from(rows[i].children);
          if (children.length < 2) continue;
          const bottoms = children.map(c => Math.round(c.getBoundingClientRect().bottom));
          const maxBottom = Math.max(...bottoms);
          const minBottom = Math.min(...bottoms);
          if (maxBottom - minBottom > 4) {
            issues.push({
              rowIndex: i,
              diff: maxBottom - minBottom,
            });
          }
        }
        return issues;
      });

      for (const cr of cardRowMismatches) {
        console.error(`[VIOLATION] [${vp.label}] ${route.name}: CardRow #${cr.rowIndex} children bottom edge mismatch (${cr.diff}px > 4px)!`);
        totalViolations++;
      }
    }

    await page.close();
  }

  await browser.close();

  if (totalViolations > 0) {
    console.error(`\nFound ${totalViolations} layout violations.`);
    process.exit(1);
  } else {
    console.log('\nAll routes passed layout checks with 0 violations!');
  }
}

checkLayout();
