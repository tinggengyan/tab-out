#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Chrome verification requires Node.js 22 or later. Use the project Node version.');

async function chromeBinary() {
  if (process.env.CHROME_FOR_TESTING) { await access(process.env.CHROME_FOR_TESTING); return process.env.CHROME_FOR_TESTING; }
  const cache = join(homedir(), '.cache/puppeteer/chrome');
  const suffix = process.platform === 'darwin'
    ? 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
    : process.platform === 'win32' ? 'chrome-win64/chrome.exe' : 'chrome-linux64/chrome';
  for (const directory of (await readdir(cache).catch(() => [])).sort().reverse()) {
    const binary = join(cache, directory, suffix);
    try { await access(binary); return binary; } catch { /* try another installed version */ }
  }
  throw new Error('Set CHROME_FOR_TESTING to an installed Chrome for Testing executable. This runner never uses your personal Chrome profile.');
}

const suiteNames = process.argv.includes('--saved-flow-only') ? ['saved-flow'] : process.argv.includes('--unified-only') ? ['unified'] : process.argv.includes('--release-only') ? ['release'] : process.argv.includes('--i18n-only') ? ['i18n'] : process.argv.includes('--layout-only') ? ['layout'] : process.argv.includes('--memory-only') ? ['memory'] : process.argv.includes('--projects-only') ? ['projects'] : process.argv.includes('--regression-only') ? ['regression'] : ['regression', 'projects'];
const output = resolve(process.env.TAB_OUT_TEST_ARTIFACTS || await mkdtemp(join(tmpdir(), 'tab-out-verification-')));
await mkdir(output, { recursive: true });
const binary = await chromeBinary();
const manifest = JSON.parse(await readFile(resolve('extension/manifest.json'), 'utf8'));
const extensionId = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32)
  .replace(/[0-9a-f]/g, value => String.fromCharCode(97 + parseInt(value, 16)));
const results = [];

for (const name of suiteNames) {
  const profile = await mkdtemp(join(tmpdir(), `tab-out-${name}-`));
  const directory = join(output, name);
  await mkdir(directory, { recursive: true });
  let extensionPath = resolve('extension');
  if (name === 'memory') {
    // Headless Chrome cannot approve the native extension permission prompt.
    // Pre-grant ONLY in a disposable copy. Permission gesture/denial are separate UI unit tests.
    extensionPath = join(profile, 'test-extension');
    await cp(resolve('extension'), extensionPath, { recursive: true });
    const testManifest = { ...manifest, permissions: [...manifest.permissions, ...manifest.optional_permissions],
      host_permissions: [...manifest.host_permissions, ...manifest.optional_host_permissions] };
    delete testManifest.optional_permissions;
    delete testManifest.optional_host_permissions;
    await writeFile(join(extensionPath, 'manifest.json'), JSON.stringify(testManifest, null, 2));
  }
  let chromeLog = '';
  const chrome = spawn(binary, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--window-size=1440,1024', '--user-data-dir=' + profile, '--disable-extensions-except=' + extensionPath,
    '--load-extension=' + extensionPath, '--remote-debugging-port=0', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr.on('data', data => { chromeLog += data; });
  try {
    const endpoint = await new Promise((done, reject) => {
      const timer = setTimeout(() => reject(new Error('Chrome startup timed out')), 15000);
      chrome.stderr.on('data', () => {
        const match = chromeLog.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) { clearTimeout(timer); done(match[1]); }
      });
      chrome.once('error', error => { clearTimeout(timer); reject(error); });
      chrome.once('exit', code => { clearTimeout(timer); reject(new Error(`Chrome exited during startup: ${code}`)); });
    });
    const origin = 'http://' + new URL(endpoint).host;
    const version = await (await fetch(origin + '/json/version')).json();
    process.stdout.write(`Starting ${name}: ${version.Browser}; disposable profile\n`);
    const script = name === 'saved-flow' ? 'tools/chrome-saved-flow-e2e.mjs' : name === 'unified' ? 'tools/chrome-unified-projects-e2e.mjs' : name === 'release' ? 'tools/chrome-release-e2e.mjs' : name === 'i18n' ? 'tools/chrome-i18n-e2e.mjs' : name === 'layout' ? 'tools/chrome-dashboard-layout-e2e.mjs' : name === 'memory' ? 'tools/chrome-memory-e2e.mjs' : name === 'projects' ? 'tools/chrome-project-e2e.mjs' : 'tools/chrome-e2e.mjs';
    const runner = spawn(process.execPath, [script], { env: { ...process.env, TAB_OUT_CDP_ORIGIN: origin,
      TAB_OUT_EXTENSION_ID: extensionId, TAB_OUT_E2E_SCREENSHOT_DIR: directory }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    runner.stdout.on('data', data => { log += data; process.stdout.write(data); });
    runner.stderr.on('data', data => { log += data; process.stderr.write(data); });
    const code = await new Promise((done, reject) => {
      const timer = setTimeout(() => { runner.kill('SIGKILL'); reject(new Error(`${name} timed out after 240 seconds`)); }, 240000);
      runner.once('error', error => { clearTimeout(timer); reject(error); });
      runner.once('exit', status => { clearTimeout(timer); done(status); });
    });
    await writeFile(join(directory, 'result.log'), log);
    results.push({ name, ok: code === 0, exitCode: code, browser: version.Browser });
    if (code !== 0) throw new Error(`${name} failed with exit code ${code}`);
  } catch (error) {
    if (!results.some(result => result.name === name)) results.push({ name, ok: false, error: error.message });
    process.exitCode = 1;
    process.stderr.write(error.message + '\n');
    break;
  } finally {
    await writeFile(join(directory, 'chrome.log'), chromeLog);
    if (chrome.exitCode === null) {
      await new Promise(done => {
        const force = setTimeout(() => chrome.kill('SIGKILL'), 5000);
        chrome.once('exit', () => { clearTimeout(force); done(); });
        chrome.kill();
      });
    }
    await rm(profile, { recursive: true, force: true });
  }
}
await writeFile(join(output, 'result.json'), JSON.stringify({ ok: results.length === suiteNames.length && results.every(result => result.ok), extensionId, results }, null, 2));
process.stdout.write(`Evidence: ${output}\n`);
