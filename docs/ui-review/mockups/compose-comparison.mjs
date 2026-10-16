import { chromium } from 'file:///D:/LIS/lis-platform/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const browser = await chromium.launch();

// Shot 1: the real Select component, loaded directly (already proven to render correctly).
const p1 = await browser.newPage({ viewport: { width: 300, height: 100 } });
await p1.goto('http://127.0.0.1:6011/iframe.html?id=primitives-select--default&viewMode=story', {
  waitUntil: 'networkidle',
});
await p1.waitForSelector('[data-slot="select"]');
const newSelectShot = await p1.locator('[data-slot="select"]').screenshot();
await p1.close();

// Shot 2: the raw <select>, exact className copied from apps/web/app/(app)/orders/page.tsx:147-150.
const p2 = await browser.newPage({ viewport: { width: 300, height: 100 } });
await p2.setContent(`<!doctype html><html><head><style>
  body { margin:0; padding:12px; background:#f7f8fa; font-family: -apple-system, sans-serif; }
  .raw-select {
    height: 2.25rem; border-radius: 0.375rem; border: 1px solid #e7e9ee;
    background: transparent; padding: 0 0.75rem; font-size: 0.875rem; outline: none;
    color: #0f1729; width: 260px;
  }
</style></head><body>
  <select class="raw-select">
    <option value="">Any</option>
    <option value="routine">Routine</option>
    <option value="stat">STAT</option>
  </select>
</body></html>`);
const rawSelectShot = await p2.locator('.raw-select').screenshot();
await p2.close();

// Compose both into one labeled side-by-side page via data: URIs (no iframe nesting involved).
const toDataUri = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
const composeHtml = `<!doctype html><html><head><style>
  body { margin:0; padding:24px; background:#f7f8fa; font-family: -apple-system, sans-serif; }
  .row { display:flex; gap:40px; }
  .col { display:flex; flex-direction:column; gap:6px; }
  .col h3 { margin:0; font-size:13px; font-weight:600; color:#0f1729; }
  .col p { margin:0; font-size:11px; color:#5b6472; font-family: monospace; }
  img { border: 1px dashed #c7cbd4; }
</style></head><body>
  <div class="row">
    <div class="col">
      <h3>New &lt;Select&gt; (packages/ui, real component, screenshotted from its own Storybook story)</h3>
      <p>packages/ui/src/components/select.tsx -- "Default" story, unmodified</p>
      <img src="${toDataUri(newSelectShot)}" />
    </div>
    <div class="col">
      <h3>Existing raw &lt;select&gt; (today, unmodified)</h3>
      <p>apps/web/app/(app)/orders/page.tsx:147-150 -- exact className string, same content</p>
      <img src="${toDataUri(rawSelectShot)}" />
    </div>
  </div>
</body></html>`;

const p3 = await browser.newPage({ viewport: { width: 700, height: 220 } });
await p3.setContent(composeHtml);
await p3.waitForTimeout(200);
await p3.screenshot({ path: 'D:/LIS/lis-platform/docs/ui-review/mockups/ui002-select-comparison.png' });
await p3.close();

await browser.close();
console.log('done');
