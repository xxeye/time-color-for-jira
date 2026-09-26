// Uses an isolated temporary browser profile; never reads the user's Chrome profile.
const { chromium } = require(process.env.JPT_PLAYWRIGHT || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
// Accept any shipped UI language so the smoke test does not depend on the browser's locale.
const locales = ['en', 'zh_TW'].map((locale) => require(path.join(root, '_locales', locale, 'messages.json')));
const anyMessage = (key, params = {}) =>
  locales.map((messages) => messages[key].message.replace(/\{(\w+)\}/g, (match, name) => String(params[name])));
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jpt-smoke-'));
  const extension = path.join(root, 'dist/pt-timeline-color');
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.JPT_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const errors = [];
  context.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)));
  try {
    const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker', { timeout: 15000 }));
    const id = new URL(worker.url()).hostname;
    // Public calendar fixture: no network dependency and no real Jira data.
    await worker.evaluate(async () => {
      globalThis.fetch = async () =>
        new Response(
          'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n' +
            ['0101', '0401', '0925', '1225']
              .map((d) => 'BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:2026' + d + '\r\nEND:VEVENT\r\n')
              .join('') +
            'END:VCALENDAR\r\n',
        );
    });
    const page = await context.newPage();
    assert.ok(
      !context.pages().some((p) => p.url().includes('onboarding.html')),
      'install must not interrupt with onboarding',
    );
    await page.goto(`chrome-extension://${id}/options.html`);
    await page.locator('#config-file').waitFor();
    const S = require('../settings.js'),
      config = S.emptyConfig(),
      p = S.createProfile();
    p.issueTypes.planning = ['10001'];
    p.fields.startDate = 'customfield_10001';
    p.calendar.sourceUrl = 'https://cdn.twholidays.com/ical/tc.ics';
    p.settings.msShowProgress = false;
    p.settings.ptLockDrag = false;
    config.sites['https://smoke.atlassian.net'] = { defaults: p, projects: {} };
    await page
      .locator('#config-file')
      .setInputFiles({ name: 'smoke.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(config)) });
    await page.locator('#apply').click();
    await page.locator('#preview').waitFor({ state: 'hidden' });
    const saved = await page.evaluate(() => JptClient.exportConfig());
    assert.deepEqual(saved, config);
    let searches = 0,
      injectInitialCalendar = true;
    // Complete a first download while Jira metadata is pending (activation race).
    await page.evaluate(() => JptClient.refreshCalendar({ origin: 'https://smoke.atlassian.net' }));
    const calendarSnapshot = await worker.evaluate(async () => {
      const data = await chrome.storage.local.get('jpt:holiday-calendar');
      await chrome.storage.local.remove('jpt:holiday-calendar');
      return data;
    });
    await context.route('https://smoke.atlassian.net/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      let data;
      if (pathname === '/rest/api/3/project/SMOKE') data = { id: '10000' };
      else if (pathname === '/rest/api/3/myself') {
        if (injectInitialCalendar) {
          injectInitialCalendar = false;
          await worker.evaluate(async (data) => {
            await chrome.storage.local.set(data);
            for (const tab of await chrome.tabs.query({ url: 'https://smoke.atlassian.net/*' })) {
              try {
                await chrome.tabs.sendMessage(tab.id, { type: 'jpt:calendar-changed' });
              } catch {}
            }
          }, calendarSnapshot);
        }
        data = { accountId: 'synthetic-user' };
      } else if (pathname === '/rest/api/3/field') data = [{ id: 'customfield_10001', schema: { type: 'date' } }];
      else if (pathname === '/rest/api/3/issuetype') data = [{ id: '10001' }];
      else if (pathname === '/rest/api/3/search/jql') {
        searches++;
        data = {
          isLast: true,
          issues: [
            {
              key: 'SMOKE-1',
              fields: { issuetype: { id: '10001' }, customfield_10001: '2026-09-01', duedate: '2026-09-10' },
            },
          ],
        };
      } else if (pathname.includes('/timeline'))
        return route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><html data-color-mode="light"><body><main style="position:relative" data-testid="software-board.timeline"><table style="border-collapse:collapse"><thead><tr><th>Key</th><th id="date-head"><div style="width:600px;height:40px"><small>September</small></div></th></tr></thead><tbody><tr><td data-testid="native-issue-table.common.ui.issue-cells.issue-key.issue-key-cell">SMOKE-1</td><td><div style="position:relative;width:200px;height:30px" data-testid="draggable-bar-ari:cloud:jira:test:issue/1-container">synthetic task</div></td></tr></tbody></table><div style="position:absolute;inset:0;pointer-events:none"><div data-testid="timeline.chart-overlays.columns-overlay.column-0" style="height:100%"></div></div></main></body></html>',
        });
      else return route.abort();
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    });
    const jira = await context.newPage();
    await jira.goto('https://smoke.atlassian.net/jira/software/projects/SMOKE/boards/1/timeline');
    await jira.locator('.jpt-pt-bar').waitFor({ timeout: 10000 });
    assert.equal(searches, 1);
    await jira.locator('.jpt-cal-weekend').first().waitFor();
    await jira.locator('.jpt-cal-holiday').first().waitFor();
    const beforeCalendarRefresh = searches;
    await page.evaluate(() => JptClient.refreshCalendar({ origin: 'https://smoke.atlassian.net', projectId: '10000' }));
    assert.equal(searches, beforeCalendarRefresh, 'holiday refresh must not requery tasks');
    await jira.evaluate(() => (document.documentElement.dataset.colorMode = 'dark'));
    await jira.waitForFunction(() => document.body.classList.contains('jpt-theme-dark'));
    assert.equal(
      await jira
        .locator('.jpt-cal-holiday')
        .first()
        .evaluate((el) => getComputedStyle(el).mixBlendMode),
      'normal',
    );
    await jira.evaluate(() => (document.documentElement.dataset.colorMode = 'light'));
    for (const mode of ['month', 'quarter', 'week']) {
      await jira.evaluate((mode) => {
        history.replaceState(
          {},
          '',
          location.pathname + '?rangeMode=' + { week: 'WEEKS', month: 'MONTHS', quarter: 'QUARTERS' }[mode],
        );
        document.getElementById('date-head').innerHTML =
          mode === 'week'
            ? '<div style="display:flex">' +
              Array.from(
                { length: 4 },
                (_, week) =>
                  '<div style="width:140px;flex:none"><small>' +
                  (week === 0 ? 'Aug / Sep' : 'Sep') +
                  '</small><div style="display:flex">' +
                  Array.from(
                    { length: 7 },
                    (_, day) =>
                      '<span data-testid="timeline.ui.timeline-table-kit.header.chart.calendar-cells.week.day-' +
                      day +
                      '" style="width:20px;flex:none">' +
                      (week === 0 && day === 0 ? 31 : week * 7 + day) +
                      '</span>',
                  ).join('') +
                  '</div></div>',
              ).join('') +
              '</div>'
            : '<div style="width:600px;height:40px"><small>' +
              (mode === 'quarter' ? 'july - September' : 'September') +
              '</small></div>';
      }, mode);
      await jira.locator('.jpt-pt-bar').dispatchEvent('mouseover');
      await jira.locator('#jpt-wd-overlay').waitFor({ state: 'visible' });
      assert.ok(
        anyMessage('workingDays', { days: 8 }).includes(await jira.locator('#jpt-wd-overlay').innerText()),
        mode + ' must use saved dates',
      );
      await jira.locator('.jpt-cal-weekend').first().waitFor();
    }
    // A display preference must not clear task cache or remove active decorations.
    const beforePreference = searches;
    await page.evaluate(() => JptClient.savePreferences({ hideIssueKey: true, ptColor: '#123456' }));
    await jira.waitForFunction(() => document.body.classList.contains('jpt-hide-issue-key'));
    assert.equal(await jira.locator('.jpt-pt-bar').count(), 1);
    assert.equal(searches, beforePreference);
    await jira.evaluate(() => {
      const scroller = document.createElement('div');
      scroller.dataset.testid = 'scroll-container.scroll-container';
      scroller.style.cssText = 'width:100px;overflow:auto';
      scroller.innerHTML = '<div style="width:1000px;height:1px"></div>';
      document.body.append(scroller);
    });
    const move = jira.locator('[data-jpt-action="move"]');
    await move.focus();
    await move.press('ArrowLeft');
    await jira.waitForFunction(() => !document.querySelector('[data-jpt-action="toggle"]').disabled);
    assert.equal(
      await jira.locator('[data-testid="scroll-container.scroll-container"]').evaluate((el) => el.scrollLeft),
      0,
    );
    const beforeDrag = searches;
    await jira.locator('.jpt-pt-bar').dispatchEvent('mousedown', { clientX: 20, clientY: 20, button: 0 });
    await jira.locator('.jpt-pt-bar').evaluate((el) => {
      el.style.width = '220px';
    });
    await jira.waitForFunction(
      (texts) => texts.includes(document.querySelector('#jpt-wd-overlay')?.textContent),
      anyMessage('workingDays', { days: 9 }),
    );
    await jira.locator('.jpt-pt-bar').dispatchEvent('mouseup', { clientX: 40, clientY: 20, button: 0 });
    await new Promise((resolve, reject) => {
      const start = Date.now();
      const timer = setInterval(() => {
        if (searches > beforeDrag) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - start > 5000) {
          clearInterval(timer);
          reject(Error('drag did not invalidate cache'));
        }
      }, 50);
    });
    await jira.evaluate(() => {
      const old = document.querySelector('main');
      const next = old.cloneNode(true);
      next.querySelector('.jpt-pt-bar').className = '';
      old.replaceWith(next);
    });
    await jira.locator('.jpt-pt-bar').waitFor({ timeout: 5000 });
    await jira.locator('[data-jpt-action="toggle"]').click();
    await jira.locator('.jpt-pt-bar').waitFor({ state: 'detached' });
    await jira.locator('[data-jpt-action="toggle"]').click();
    await jira.locator('.jpt-pt-bar').waitFor();
    await jira.locator('[data-jpt-action="refresh"]').click();
    await jira.waitForFunction(
      (texts) => texts.some((text) => document.querySelector('#jpt-toolbar')?.textContent.includes(text)),
      anyMessage('tbRescanSent'),
    );
    await page.goto(`chrome-extension://${id}/popup.html`);
    await page.locator('input[type=checkbox]').first().waitFor();
    const qa = path.join(root, 'dist/qa');
    fs.mkdirSync(qa, { recursive: true });
    await page.setViewportSize({ width: 420, height: 900 });
    await page.screenshot({ path: path.join(qa, 'popup.png'), fullPage: true });
    await page.goto(`chrome-extension://${id}/options.html`);
    await page.locator('body').waitFor();
    await page.setViewportSize({ width: 1000, height: 850 });
    await page.screenshot({ path: path.join(qa, 'options.png'), fullPage: true });
    await page.setViewportSize({ width: 360, height: 850 });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      'settings should not overflow a narrow viewport',
    );
    // The admin generator tab embeds the bundled generator page inside the extension.
    await page.setViewportSize({ width: 1000, height: 850 });
    await page.goto(`chrome-extension://${id}/options.html#generator`);
    const embedded = await (
      await page.locator('#generator-frame[src="generator.html"]').elementHandle()
    ).contentFrame();
    await embedded
      .locator('#importFile')
      .setInputFiles({ name: 'smoke.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(config)) });
    await embedded.waitForFunction(() => document.getElementById('origin').value === 'https://smoke.atlassian.net');
    const embeddedDownload = page.waitForEvent('download');
    await embedded.locator('button[type=submit]').click();
    assert.deepEqual(JSON.parse(fs.readFileSync(await (await embeddedDownload).path(), 'utf8')), config);
    await page.waitForFunction(() => document.getElementById('generator-frame').getBoundingClientRect().height > 1000);
    await page.screenshot({ path: path.join(qa, 'options-generator.png'), fullPage: true });
    await page.locator('#tab-settings').click();
    await page.locator('#config-file').waitFor();
    const stored = await worker.evaluate(async () => ({
      sync: await chrome.storage.sync.get(null),
      local: await chrome.storage.local.get(null),
    }));
    assert.ok(!JSON.stringify(stored).includes('issuelinks'));
    assert.ok(!JSON.stringify(stored).includes('SMOKE-1'));
    assert.deepEqual(errors, []);
    console.log(
      'PASS: real MV3 worker, settings import and subscribed calendar refresh, config persistence, synthetic Jira rendering/toggle/refresh, popup/options loading, embedded generator download roundtrip',
    );
  } finally {
    await context.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
