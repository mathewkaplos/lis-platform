import { chromium } from 'file:///D:/LIS/lis-platform/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs';
import path from 'node:path';

const outDir = 'D:/LIS/lis-platform/docs/ui-review/mockups';
const storyId = 'appcomponents-leveyjenningschart--with-warning-and-rejection';
const viewports = [
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1024x768', width: 1024, height: 768 },
];

const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  for (const vp of viewports) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    const url = `http://127.0.0.1:6042/iframe.html?id=${storyId}&viewMode=story&globals=theme:${theme}`;
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await page.waitForSelector('svg[role="img"]');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, `ui009-chart-${vp.name}-${theme}.png`) });
    await page.close();
  }
}
await browser.close();
console.log('done');
