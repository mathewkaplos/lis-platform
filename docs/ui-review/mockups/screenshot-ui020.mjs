import { chromium } from 'file:///D:/LIS/lis-platform/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs';
import path from 'node:path';

const outDir = 'D:/LIS/lis-platform/docs/ui-review/mockups';
const stories = [
  { id: 'appcomponents-leveyjenningschart--with-warning-and-rejection', name: 'lj' },
  { id: 'appcomponents-trendchart--with-normal-warning-and-critical', name: 'trend' },
];

const browser = await chromium.launch();

for (const theme of ['light', 'dark']) {
  for (const s of stories) {
    const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
    const url = `http://127.0.0.1:6080/iframe.html?id=${s.id}&viewMode=story&globals=theme:${theme}`;
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await page.waitForSelector('svg[role="img"]');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, `ui020-${s.name}-${theme}.png`) });
    await page.close();
  }
}

// Grayscale verification for both charts (dark theme, where the new token matters most).
for (const s of stories) {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  const url = `http://127.0.0.1:6080/iframe.html?id=${s.id}&viewMode=story&globals=theme:dark`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), 'dark');
  await page.waitForSelector('svg[role="img"]');
  await page.addStyleTag({ content: 'html { filter: grayscale(100%); }' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, `ui020-${s.name}-grayscale-dark.png`) });
  await page.close();
}

await browser.close();
console.log('done');
