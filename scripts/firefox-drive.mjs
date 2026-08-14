/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Drives a real Firefox that already has the extension installed, so the
 * options/popup/import pages can be exercised end to end without clicking.
 *
 * Why Marionette and not WebDriver BiDi: BiDi refuses to navigate to
 * privileged `moz-extension://` URLs, and the extension pages are only
 * reachable by opening a tab from the parent process. Marionette's chrome
 * context can do that.
 *
 * Start the browser first (Firefox 142+ needs -remote-allow-system-access):
 *
 *   pnpm build:firefox
 *   pnpm dlx web-ext run --source-dir .output/firefox-mv3 \
 *     --firefox-profile /tmp/ff-tabstack --profile-create-if-missing \
 *     --keep-profile-changes --no-reload \
 *     --arg=-no-remote --arg=-marionette --arg=-remote-allow-system-access \
 *     --pref=marionette.port=2828 \
 *     --pref=extensions.originControls.grantByDefault=true
 *
 * Then, for example:
 *
 *   node scripts/firefox-drive.mjs options.html --shot=/tmp/options.png
 *   node scripts/firefox-drive.mjs import.html --eval="return document.title"
 *   node scripts/firefox-drive.mjs options.html \
 *     --eval="return (await browser.storage.local.get('settings')).settings.backend"
 *
 * `--eval` runs inside the extension page, so `browser.*` is available and the
 * body may use await. Anything returned is printed as JSON.
 */
import net from 'node:net';
import { readFileSync, writeFileSync } from 'node:fs';

const EXTENSION_ID = 'bookmarks@tabstack.ai';
const MARIONETTE_PORT = 2828;

function parseArgs(argv) {
  const page = argv.find((a) => !a.startsWith('--')) ?? 'options.html';
  const flag = (name) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
  };
  return {
    page,
    shot: flag('shot'),
    body: flag('eval'),
    profile: flag('profile') ?? '/tmp/ff-tabstack',
    width: Number(flag('width') ?? 1280),
    height: Number(flag('height') ?? 1000),
  };
}

/** The internal UUID is per-profile and lives in prefs.js. */
function extensionUuid(profileDir) {
  const prefs = readFileSync(`${profileDir}/prefs.js`, 'utf8');
  // user_pref("extensions.webextensions.uuids", "{\"id\":\"uuid\", …}");
  const match = /user_pref\("extensions\.webextensions\.uuids",\s*"(.*)"\);/.exec(prefs);
  if (!match) throw new Error(`no extension UUIDs in ${profileDir}/prefs.js`);
  const map = JSON.parse(JSON.parse(`"${match[1]}"`));
  const uuid = map[EXTENSION_ID];
  if (!uuid) throw new Error(`${EXTENSION_ID} is not installed in that profile`);
  return uuid;
}

async function connect(port) {
  const socket = net.connect(port, '127.0.0.1');
  await new Promise((ok, err) => {
    socket.once('connect', ok);
    socket.once('error', () =>
      err(
        new Error(`nothing listening on ${port} — is Firefox running with -marionette?`),
      ),
    );
  });

  let buffer = Buffer.alloc(0);
  const ready = [];
  const waiting = [];
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const colon = buffer.indexOf(0x3a);
      if (colon < 0) return;
      const size = Number(buffer.subarray(0, colon).toString('ascii'));
      const start = colon + 1;
      if (buffer.length < start + size) return;
      const payload = JSON.parse(buffer.subarray(start, start + size).toString('utf8'));
      buffer = buffer.subarray(start + size);
      const waiter = waiting.shift();
      if (waiter) waiter(payload);
      else ready.push(payload);
    }
  });
  const next = () =>
    new Promise((ok) => (ready.length ? ok(ready.shift()) : waiting.push(ok)));
  await next(); // handshake

  let id = 0;
  const send = async (method, params = {}) => {
    const bytes = Buffer.from(JSON.stringify([0, ++id, method, params]), 'utf8');
    socket.write(`${bytes.length}:`);
    socket.write(bytes);
    const [, , error, result] = await next();
    if (error) throw new Error(`${error.error}: ${error.message}`);
    return result;
  };

  await send('WebDriver:NewSession', { capabilities: {} });
  return { send, close: () => socket.end() };
}

const args = parseArgs(process.argv.slice(2));
const url = `moz-extension://${extensionUuid(args.profile)}/${args.page}`;
const { send, close } = await connect(MARIONETTE_PORT);

try {
  // Only the parent process may open a privileged page in a tab.
  await send('Marionette:SetContext', { value: 'chrome' });
  await send('WebDriver:ExecuteScript', {
    script: `
      const [target] = arguments;
      const win = Services.wm.getMostRecentWindow('navigator:browser');
      const open = [...win.gBrowser.tabs].find(
        (tab) => tab.linkedBrowser.currentURI.spec === target,
      );
      if (open) {
        win.gBrowser.selectedTab = open;
        win.gBrowser.reloadTab(open);
        return;
      }
      win.gBrowser.selectedTab = win.gBrowser.addTab(target, {
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      });
    `,
    args: [url],
  });

  await send('Marionette:SetContext', { value: 'content' });

  let attached = false;
  for (let attempt = 0; attempt < 60 && !attached; attempt++) {
    for (const handle of await send('WebDriver:GetWindowHandles')) {
      await send('WebDriver:SwitchToWindow', { handle });
      const current = await send('WebDriver:GetCurrentURL');
      if ((current?.value ?? current) !== url) continue;
      const rendered = await send('WebDriver:ExecuteScript', {
        script: 'return !!document.querySelector("h1")',
        args: [],
      });
      if (rendered?.value) attached = true;
      break;
    }
    if (!attached) await new Promise((r) => setTimeout(r, 250));
  }
  if (!attached) throw new Error(`${args.page} never rendered`);

  // Size the window once a tab is attached; doing it earlier is racy.
  await send('WebDriver:SetWindowRect', { width: args.width, height: args.height });
  await new Promise((r) => setTimeout(r, 400));

  if (args.body) {
    // ExecuteScript is sync-only, so wrap the body for await support.
    const result = await send('WebDriver:ExecuteAsyncScript', {
      script: `
        const done = arguments[arguments.length - 1];
        (async () => { ${args.body} })().then(done, (e) => done({ __error: String(e) }));
      `,
      args: [],
      scriptTimeout: 180_000,
    });
    const value = result?.value;
    if (value && value.__error) throw new Error(value.__error);
    console.log(JSON.stringify(value, null, 2));
  }

  if (args.shot) {
    const shot = await send('WebDriver:TakeScreenshot', { hash: false });
    writeFileSync(args.shot, Buffer.from(shot.value, 'base64'));
    console.log(`screenshot: ${args.shot}`);
  }
} finally {
  close();
}
