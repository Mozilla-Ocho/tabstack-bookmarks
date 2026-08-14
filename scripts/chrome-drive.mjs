/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Launches a throwaway Chrome, loads the built extension, and runs code inside
 * its pages — the Chrome counterpart to `scripts/firefox-drive.mjs`.
 *
 * Current Chrome ignores `--load-extension`, so the extension is installed over
 * CDP with `Extensions.loadUnpacked`, which needs
 * `--enable-unsafe-extension-debugging`. Nothing here touches your real profile.
 *
 *   pnpm build
 *   node scripts/chrome-drive.mjs options.html --shot=/tmp/options.png
 *   node scripts/chrome-drive.mjs options.html \
 *     --eval="return (await chrome.storage.local.get('settings')).settings.backend"
 *   node scripts/chrome-drive.mjs --keep options.html   # leave Chrome running
 *
 * `--eval` runs in the extension page, so `chrome.*` is available and the body
 * may await. Whatever it returns is printed as JSON.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME =
  process.env.CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.CHROME_CDP_PORT ?? 9333);

const argv = process.argv.slice(2);
const flag = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};
const page = argv.find((a) => !a.startsWith('--')) ?? 'options.html';
const keep = argv.includes('--keep');
const source = flag('source') ?? '.output/chrome-mv3';

const profile = mkdtempSync(join(tmpdir(), 'tabstack-chrome-'));
const chrome = spawn(
  CHROME,
  [
    `--user-data-dir=${profile}`,
    '--enable-unsafe-extension-debugging',
    `--remote-debugging-port=${PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,800',
    'about:blank',
  ],
  { stdio: 'ignore', detached: false },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      return (await res.json()).webSocketDebuggerUrl;
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`Chrome never opened a debugging port on ${PORT}`);
}

const ws = new WebSocket(await connect());
await new Promise((ok, err) => {
  ws.onopen = ok;
  ws.onerror = () => err(new Error('CDP connect failed'));
});

let id = 0;
const pending = new Map();
ws.onmessage = (raw) => {
  const msg = JSON.parse(raw.data);
  if (!msg.id || !pending.has(msg.id)) return;
  const { ok, err } = pending.get(msg.id);
  pending.delete(msg.id);
  if (msg.error) err(new Error(JSON.stringify(msg.error)));
  else ok(msg.result);
};
const send = (method, params = {}, sessionId) =>
  new Promise((ok, err) => {
    const msg = { id: ++id, method, params, ...(sessionId ? { sessionId } : {}) };
    pending.set(msg.id, { ok, err });
    ws.send(JSON.stringify(msg));
  });

let failed = false;
try {
  const { id: extensionId } = await send('Extensions.loadUnpacked', {
    path: new URL(source, `file://${process.cwd()}/`).pathname,
  });
  console.log(`extension: ${extensionId}`);

  const url = `chrome-extension://${extensionId}/${page}`;
  const { targetId } = await send('Target.createTarget', { url });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  await send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false },
    sessionId,
  );
  await sleep(1500);

  const body = flag('eval');
  if (body) {
    const result = await send(
      'Runtime.evaluate',
      {
        expression: `(async () => { ${body} })()`,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      },
      sessionId,
    );
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate threw');
    }
    console.log(JSON.stringify(result.result.value, null, 2));
  }

  const shot = flag('shot');
  if (shot) {
    const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(shot, Buffer.from(data, 'base64'));
    console.log(`screenshot: ${shot}`);
  }
} catch (error) {
  failed = true;
  console.error(String(error.message ?? error).slice(0, 500));
} finally {
  ws.close();
  if (keep) {
    // The profile holds whatever credentials the run set; say where it is.
    console.log(`Chrome left running. Profile: ${profile}`);
  } else {
    chrome.kill();
    await sleep(500);
    rmSync(profile, { recursive: true, force: true });
  }
  process.exit(failed ? 1 : 0);
}
