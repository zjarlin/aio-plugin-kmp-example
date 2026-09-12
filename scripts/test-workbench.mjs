import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const url = process.env.AIO_PREVIEW_URL || 'http://127.0.0.1:4189/';
const production = process.env.AIO_PUBLIC === '1';
const output = process.env.AIO_SCREENSHOTS || 'test-artifacts/workbench';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const reports = [];

async function openPlugin(page, mobile) {
  if (!production) return;
  await page.getByRole('navigation', { name: '场景' }).getByRole('button', { name: '社区插件', exact: true }).click();
  if (mobile) await page.getByRole('button', { name: '打开菜单', exact: true }).click();
  const sidebar = mobile ? page.getByRole('dialog') : page.locator('.application-shell__sidebar');
  await sidebar.getByRole('button', { name: '任务工作台示例', exact: true }).click();
}

function responseFor(page, method, path) {
  const pending = page.waitForResponse(response => {
    const endpoint = new URL(response.url()).pathname;
    if (!(production ? /^\/api\/runtime\/frontend\/[^/]+\/request$/.test(endpoint) : endpoint === '/invoke')) return false;
    const input = response.request().postDataJSON();
    return input?.method === method && input?.path === path;
  }, { timeout: 180000 });
  pending.catch(() => {});
  return pending;
}

async function payload(response, status = 200) {
  assert.equal(response.status(), 200);
  const body = await response.json();
  const wire = production ? body.data : body;
  assert.equal(wire.status, status);
  if (status === 204) return null;
  return JSON.parse(typeof wire.body === 'string' ? wire.body : Buffer.from(wire.body).toString());
}

// Compose 语义节点位于 canvas 下方；强制点击仍发送真实指针，不能派发伪造 DOM 事件。
async function click(locator) {
  await locator.waitFor();
  await new Promise(resolve => setTimeout(resolve, 350));
  await locator.click({ force: true });
  await new Promise(resolve => setTimeout(resolve, 200));
}

try {
  for (const [name, viewport] of [['desktop', { width: 1280, height: 800 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, storageState: process.env.AIO_STORAGE_STATE });
    const page = await context.newPage();
    const errors = [];
    const counterRequests = [];
    const bridgeRequests = [];
    page.on('request', request => {
      if (!/\/(invoke|request)$/.test(new URL(request.url()).pathname)) return;
      bridgeRequests.push(request.url());
      if (request.postDataJSON()?.path === '/counter') counterRequests.push(request.url());
    });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    try {
      if (production && process.env.AIO_ACCOUNT) {
        const login = await context.request.post(new URL('/api/auth/login', url).href, {
          data: { account: process.env.AIO_ACCOUNT, password: process.env.AIO_PASSWORD },
        });
        assert.equal(login.status(), 200, 'Authentication failed');
      }
      const initial = responseFor(page, 'GET', '/tasks');
      await page.goto(url);
      await openPlugin(page, name === 'mobile');
      const before = await payload(await initial);
      const frame = page.frameLocator(production ? 'iframe[title="任务工作台示例"]' : 'iframe');
      const canvas = frame.locator('canvas').first();
      await canvas.waitFor();
      await page.waitForTimeout(400);
      const first = PNG.sync.read(await canvas.screenshot());
      const colors = new Set();
      for (let i = 0; i < first.data.length; i += 4) colors.add(first.data.readUInt32BE(i));
      assert(colors.size > 30, 'Canvas must contain actual rendering');
      const points = {};
      for (const [key, locator] of Object.entries({
        search: frame.getByRole('textbox').filter({ visible: true }).first(),
        checkbox: frame.getByRole('button', { name: '', exact: true }).first(),
        remove: frame.getByRole('button', { name: `Delete ${before.items[0].title}`, exact: true }),
        refresh: frame.getByRole('button', { name: 'Refresh', exact: true }),
        counter: frame.getByRole('button', { name: 'Counter', exact: true }),
        tasks: frame.getByRole('button', { name: 'Tasks', exact: true }),
      })) {
        const box = await locator.boundingBox();
        assert(box, `Missing ${key} bounds`);
        points[key] = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }
      const pointer = async key => {
        await page.waitForTimeout(500);
        await page.mouse.click(points[key].x, points[key].y);
        await page.waitForTimeout(300);
      };
      await pointer('counter');
      const incrementButton = frame.getByRole('button', { name: '+1', exact: true });
      const counterBefore = 0;
      await frame.getByText('0', { exact: true }).waitFor();
      const counterImage = PNG.sync.read(await canvas.screenshot());
      const requestCount = bridgeRequests.length;
      const counterAfter = 20;
      const incrementBounds = await incrementButton.boundingBox();
      assert(incrementBounds, 'Counter button must have bounds');
      await context.setOffline(true);
      const start = performance.now();
      for (let index = 0; index < counterAfter; index++) {
        assert(await incrementButton.isEnabled(), 'Local counter must never wait for a server');
        await page.mouse.click(incrementBounds.x + incrementBounds.width / 2, incrementBounds.y + incrementBounds.height / 2, { delay: 50 });
        await frame.getByText(String(index + 1), { exact: true }).waitFor({ timeout: 1000 });
      }
      const offlineClickMs = performance.now() - start;
      assert.equal(bridgeRequests.length, requestCount, 'Local clicks must not send requests');
      await context.setOffline(false);
      const counterChanged = PNG.sync.read(await canvas.screenshot());
      let changed = 0;
      for (let i = 0; i < counterImage.data.length; i += 4) if (counterImage.data.readUInt32BE(i) !== counterChanged.data.readUInt32BE(i)) changed++;
      assert(changed > 30, 'Counter must repaint');
      const calibrateTasks = responseFor(page, 'GET', '/tasks');
      await pointer('tasks');
      await payload(await calibrateTasks);
      await pointer('counter');
      await frame.getByText(String(counterAfter), { exact: true }).waitFor();
      const returnTasks = responseFor(page, 'GET', '/tasks');
      await pointer('tasks');
      await payload(await returnTasks);

      const title = `Acceptance ${name} ${Date.now()}`;
      await click(frame.getByRole('button', { name: 'New task', exact: true }));
      await click(frame.getByRole('textbox').filter({ visible: true }).first());
      await page.keyboard.type(title);
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${output}/${name}-dialog.png` });
      const creation = responseFor(page, 'POST', '/tasks');
      const createdList = responseFor(page, 'GET', '/tasks');
      await click(frame.getByRole('button', { name: 'Create', exact: true }));
      const task = await payload(await creation, 201);
      assert.equal(task.title, title);
      let current = await payload(await createdList);
      assert.equal(current.total, before.total + 1);
      await page.waitForTimeout(200);

      await pointer('search');
      await page.keyboard.type(title);
      await page.waitForTimeout(300);
      const update = responseFor(page, 'PATCH', `/tasks/${task.id}`);
      const updatedList = responseFor(page, 'GET', '/tasks');
      await pointer('checkbox');
      assert.equal((await payload(await update)).done, true);
      current = await payload(await updatedList);
      assert(current.items.some(item => item.id === task.id && item.done));

      await pointer('remove');
      await click(frame.getByRole('button', { name: 'Cancel', exact: true }));
      assert.equal((await payload(await (async () => {
        const refreshed = responseFor(page, 'GET', '/tasks');
        await pointer('refresh');
        return refreshed;
      })())).total, current.total);
      await pointer('remove');
      const removal = responseFor(page, 'DELETE', `/tasks/${task.id}`);
      const removedList = responseFor(page, 'GET', '/tasks');
      await click(frame.getByRole('button', { name: 'Delete', exact: true }));
      await payload(await removal, 204);
      assert.equal((await payload(await removedList)).total, before.total);

      const reloaded = responseFor(page, 'GET', '/tasks');
      await page.reload();
      await openPlugin(page, name === 'mobile');
      await payload(await reloaded);
      await click(frame.getByRole('button', { name: 'Counter', exact: true }));
      await frame.getByText('0', { exact: true }).waitFor();
      assert.deepEqual(counterRequests, [], 'Workbench counter must remain entirely local');
      await page.screenshot({ path: `${output}/${name}-counter.png` });
      const tasks = responseFor(page, 'GET', '/tasks');
      await click(frame.getByRole('button', { name: 'Tasks', exact: true }));
      await payload(await tasks);
      await page.waitForTimeout(300);
      assert(await frame.locator('body').evaluate(body => body.scrollWidth <= innerWidth));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const isolation = await frame.locator('body').evaluate(() => {
        let parentBlocked = false, cookieBlocked = false;
        try { void parent.document.body; } catch { parentBlocked = true; }
        try { void document.cookie; } catch { cookieBlocked = true; }
        return { parentBlocked, cookieBlocked };
      });
      assert.deepEqual(isolation, { parentBlocked: true, cookieBlocked: true });
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
      reports.push({ name, tasks: before.total, crud: true, counterBefore, counterAfter, offlineClickMs, counterRequests: counterRequests.length, changedPixels: changed, canvasColors: colors.size, isolation, errors });
    } catch (error) {
      await page.screenshot({ path: `${output}/${name}-failure.png` });
      console.error(error, errors);
      throw error;
    } finally {
      if (production && process.env.AIO_ACCOUNT) await context.request.post(new URL('/api/auth/logout', url).href);
      await context.close();
    }
  }
  console.log(JSON.stringify(reports, null, 2));
} finally { await browser.close(); }
