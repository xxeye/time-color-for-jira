// Optional local acceptance test: input remains local and all web requests are blocked.
const { chromium } = require(process.env.JPT_PLAYWRIGHT || 'playwright');
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
// Accept any shipped UI language so the smoke test does not depend on the browser's locale.
const locales = ['en', 'zh_TW'].map((locale) => require(path.join(root, '_locales', locale, 'messages.json')));
const anyMessage = (key, params = {}) =>
  locales.map((messages) => messages[key].message.replace(/\{(\w+)\}/g, (match, name) => String(params[name])));
let stage = 'launch';
(async () => {
  if (!process.env.JPT_CONFIG) throw Error('Provide JPT_CONFIG for the local settings file');
  const input = fs.readFileSync(process.env.JPT_CONFIG),
    raw = JSON.parse(input);
  const checked = require('../settings.js').validateConfig(raw);
  if (!checked.ok) throw Error('Configuration validation failed (contents omitted)');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jpt-private-smoke-'));
  let context;
  try {
    const extension = path.join(root, 'dist/pt-timeline-color');
    context = await chromium.launchPersistentContext(profile, {
      executablePath: process.env.JPT_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      headless: true,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    await context.route(/^https?:/, (route) => route.abort());
    const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
    await worker.evaluate(() => {
      globalThis.fetch = async () => {
        throw new Error('Offline acceptance test');
      };
    });
    const id = new URL(worker.url()).hostname,
      page = await context.newPage();
    const errors = [];
    page.on('pageerror', () => errors.push('page-error'));
    stage = 'popup';
    await page.goto(`chrome-extension://${id}/popup.html`);
    await page.locator('#manage-settings').click();
    stage = 'options';
    const settings =
      context.pages().find((p) => p.url().endsWith('/options.html')) || (await context.waitForEvent('page'));
    stage = 'import';
    await settings
      .locator('#config-file')
      .setInputFiles({ name: 'administrator-settings.json', mimeType: 'application/json', buffer: input });
    await settings.locator('#preview').waitFor({ state: 'visible' });
    assert.ok((await settings.locator('#preview-list .scope-row').count()) > 0);
    stage = 'save';
    await settings.locator('#apply').click();
    await settings.locator('#preview').waitFor({ state: 'hidden' });
    assert.ok((await settings.locator('#sites .site-row').count()) > 0);
    assert.ok(
      require('node:util').isDeepStrictEqual(await settings.evaluate(() => JptClient.exportConfig()), checked.value),
      'stored settings must match',
    );
    await settings
      .locator('#config-file')
      .setInputFiles({ name: 'administrator-settings.json', mimeType: 'application/json', buffer: input });
    stage = 'duplicate';
    settings.once('dialog', (dialog) => dialog.dismiss());
    await settings.locator('#apply').click();
    assert.equal(await settings.locator('#preview').isVisible(), true);
    await settings.locator('#discard').click();
    await settings
      .locator('#config-file')
      .setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{invalid') });
    await settings.locator('#notice.error').waitFor();
    assert.ok(
      require('node:util').isDeepStrictEqual(await settings.evaluate(() => JptClient.exportConfig()), checked.value),
    );
    const next = Object.entries(checked.value.sites).flatMap(([origin, site]) =>
      [site.defaults, ...Object.values(site.projects)]
        .filter((p) => p?.timelinePath)
        .map((p) => new URL(p.timelinePath, origin).href),
    )[0];
    stage = 'open-target';
    if (next) {
      const opened = context.waitForEvent('page');
      await settings
        .getByRole('button', { name: new RegExp('^(?:' + anyMessage('openTimeline').join('|') + ')$') })
        .first()
        .click();
      const tab = await opened;
      await tab.waitForURL(next).catch(() => {});
      // Read the requested URL from extension-side tabs; network remains blocked.
      assert.equal(
        await settings.evaluate(
          async (expected) => (await chrome.tabs.query({})).some((t) => (t.pendingUrl || t.url) === expected),
          next,
        ),
        true,
      );
    }
    assert.equal(errors.length, 0);
    console.log(
      'PASS: supplied config, popup entry, preview/save, duplicate cancellation, invalid file recovery, optional Timeline target; no web requests or screenshots',
    );
  } finally {
    await context?.close();
    const resolved = fs.realpathSync(profile),
      temp = fs.realpathSync(os.tmpdir());
    if (path.dirname(resolved) !== temp || !path.basename(resolved).startsWith('jpt-private-smoke-'))
      throw Error('Unexpected cleanup path');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(
    'Private configuration test failed at ' + stage + ' (' + error.name + '); configuration and URLs omitted.',
  );
  process.exitCode = 1;
});
