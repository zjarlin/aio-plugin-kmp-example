import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const url = process.env.AIO_PREVIEW_URL ?? 'http://127.0.0.1:4187/';
const output = process.env.AIO_SCREENSHOTS ?? 'test-artifacts';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const reports = [];
function matches(method) { return response => response.url() === new URL('/invoke', url).href && response.request().postDataJSON()?.method === method; }
async function value(response) {
  assert.equal(response.status(), 200);
  const wire = await response.json();
  assert.equal(wire.status, 200);
  return JSON.parse(Buffer.from(wire.body).toString('utf8')).count;
}
try {
  for (const [name, viewport] of [['desktop', { width: 1280, height: 800 }], ['mobile', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const initial = page.waitForResponse(matches('GET'));
    await page.goto(url);
    const before = await value(await initial);
    const frame = page.frameLocator('iframe');
    const canvas = frame.locator('canvas');
    await canvas.waitFor();
    await page.waitForTimeout(600);
    const first = PNG.sync.read(await canvas.screenshot());
    const colors = new Set();
    for (let index = 0; index < first.data.length; index += 4) colors.add(first.data.readUInt32BE(index));
    assert.ok(colors.size > 20, `${name}: blank canvas`);
    const update = page.waitForResponse(matches('POST'));
    await canvas.click({ position: { x: 52, y: 160 } });
    const after = await value(await update);
    assert.equal(after, before + 1);
    await page.waitForTimeout(600);
    const second = PNG.sync.read(await canvas.screenshot());
    assert.equal(first.data.length, second.data.length);
    let changed = 0;
    for (let index = 0; index < first.data.length; index += 4) if (first.data.readUInt32BE(index) !== second.data.readUInt32BE(index)) changed++;
    assert.ok(changed > 30, `${name}: counter did not repaint`);
    const restored = page.waitForResponse(matches('GET'));
    await page.reload();
    assert.equal(await value(await restored), after);
    await page.waitForTimeout(600);
    const fits = await canvas.evaluate(canvas => ({ height: canvas.getBoundingClientRect().height, viewport: innerHeight }));
    assert.equal(await frame.locator('body').evaluate(body => body.scrollWidth > innerWidth), false);
    assert.ok(Math.abs(fits.height - fits.viewport) <= 1, `${name}: canvas does not fill the mount`);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
    reports.push({ name, before, after, canvasColors: colors.size, changedPixels: changed, errors });
    await page.close();
  }
  console.log(JSON.stringify(reports, null, 2));
} finally { await browser.close(); }
