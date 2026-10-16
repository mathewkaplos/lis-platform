import { chromium } from 'file:///D:/LIS/lis-platform/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const viewports = [
  { name: '1366x768', width: 1366, height: 768 },
  { name: 'tablet-768x1024', width: 768, height: 1024 },
];
const pages = ['direction-a-refine.html', 'direction-b-elevate.html'];

const browser = await chromium.launch();
for (const pageFile of pages) {
  for (const vp of viewports) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    await page.goto('file://' + path.join(dir, pageFile));
    const outName = pageFile.replace('.html', '') + '--' + vp.name + '.png';
    await page.screenshot({ path: path.join(dir, outName), fullPage: false });
    console.log('wrote', outName);
    await page.close();
  }
}
await browser.close();
