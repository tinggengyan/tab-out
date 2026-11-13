import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Attaches to a target that already exists: a page the extension opened itself, or its service worker.
export async function attachTarget(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  const pending = new Map();
  const events = new Map();
  let sequence = 0;
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id); clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
    }
    for (const listener of events.get(message.method) || []) listener(message.params || {});
  });
  await new Promise((done, reject) => {
    socket.addEventListener('open', done, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP request timed out: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async (expression, description = expression, timeout = 12000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await evaluate(`(async () => Boolean(await (${expression})))()`)) return;
      await new Promise(done => setTimeout(done, 80));
    }
    throw new Error(`Timed out: ${description}`);
  };
  return { send, evaluate, waitFor,
    on(method, handler) { events.set(method, [...(events.get(method) || []), handler]); },
    close() { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Test target closed')); } pending.clear(); socket.close(); },
  };
}

export async function connectPage(origin, url) {
  const response = await fetch(`${origin}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  assert.equal(response.ok, true, 'could not open test target');
  const target = await response.json();
  const client = await attachTarget(target.webSocketDebuggerUrl);
  const { send, evaluate, waitFor } = client;
  const click = async selector => {
    await send('Page.bringToFront');
    await waitFor(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); return element && !element.disabled && element.getBoundingClientRect().height > 0; })()`, `clickable ${selector}`);
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
    await evaluate(`Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().iterations)).map(animation => animation.finished.catch(() => {})))`);
    const point = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      const rect = element.getBoundingClientRect();
      const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
      const hit = document.elementFromPoint(x,y);
      return { x, y, hit: hit === element || element.contains(hit), target: element.outerHTML.slice(0,250), actual: hit?.outerHTML.slice(0,250) };
    })()`);
    if (!point.hit) await screenshot('blocked-click');
    assert.equal(point.hit, true, `mouse input is blocked for ${selector}: ${JSON.stringify(point)}`);
    const { x, y } = point;
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  const fill = async (selector, value) => {
    await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); element.focus(); element.value = ${JSON.stringify(value)}; element.dispatchEvent(new Event('input',{bubbles:true})); element.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  };
  const screenshot = async name => {
    if (!process.env.TAB_OUT_E2E_SCREENSHOT_DIR) return;
    await send('Page.bringToFront');
    await evaluate('Promise.all(document.getAnimations().filter(animation=>Number.isFinite(animation.effect?.getComputedTiming().iterations)).map(animation=>animation.finished.catch(()=>{})))');
    // Allow scroll/viewport changes to reach the compositor before capturing its frame.
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await mkdir(process.env.TAB_OUT_E2E_SCREENSHOT_DIR, { recursive: true });
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(process.env.TAB_OUT_E2E_SCREENSHOT_DIR, name + '.png'), Buffer.from(data, 'base64'));
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1024, deviceScaleFactor: 1, mobile: false });
  if (process.env.TAB_OUT_TEST_LOCALE) {
    const userAgent = await evaluate('navigator.userAgent');
    await send('Network.setUserAgentOverride', { userAgent, acceptLanguage: process.env.TAB_OUT_TEST_LOCALE });
    await send('Emulation.setLocaleOverride', { locale: process.env.TAB_OUT_TEST_LOCALE });
    await send('Page.reload');
  }
  return { ...client, click, fill, screenshot };
}
