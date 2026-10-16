import { chromium } from 'file:///D:/LIS/lis-platform/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const url =
  'http://127.0.0.1:6042/iframe.html?id=appcomponents-leveyjenningschart--with-warning-and-rejection&viewMode=story';
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForSelector('svg[role="img"]');
// Full-page CSS grayscale filter -- simulates how this chart would look to a color-blind user
// or a grayscale printout, independent of the browser's own color rendering.
await page.addStyleTag({ content: 'html { filter: grayscale(100%); }' });
await page.waitForTimeout(300);
await page.screenshot({
  path: 'D:/LIS/lis-platform/docs/ui-review/mockups/ui009-chart-grayscale.png',
});
await browser.close();
console.log('done');
