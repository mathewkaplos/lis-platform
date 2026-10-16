import { chromium } from 'file:///D:/LIS/lis-platform/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs';
import path from 'node:path';

const outDir = 'D:/LIS/lis-platform/docs/ui-review/mockups';
const stories = [
  { id: 'primitives-select--in-form-field', name: 'select-in-form-field' },
  { id: 'primitives-textarea--in-form-field', name: 'textarea-in-form-field' },
];

const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  for (const story of stories) {
    const page = await browser.newPage({ viewport: { width: 400, height: 220 } });
    const url = `http://127.0.0.1:6010/iframe.html?id=${story.id}&viewMode=story&globals=theme:${theme}`;
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, `ui002-${story.name}-${theme}.png`) });
    await page.close();
  }
}
await browser.close();
console.log('done');
