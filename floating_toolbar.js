(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  root.__jptIsTimelinePage = () => !!root.JptTimeline?.isTimelinePage(root.location, root.document);
  if (!root.JptClient || !root.JptTimeline || !root.JptTimeline.isJiraApp(root.location)) return;
  root.__jptToolbar?.destroy();
  root.__jptToolbar = api.createToolbar({
    window: root,
    document: root.document,
    client: root.JptClient,
    adapter: root.JptTimeline,
    isAlive: () => {
      try {
        return !!root.chrome?.runtime?.id;
      } catch {
        return false;
      }
    },
  });
  root.__jptToolbar.start();
})(globalThis, function (root) {
  'use strict';
  const t = (key, params) => (root.JptI18n || require('./i18n.js').forLocale()).t(key, params);
  const DEFAULT_POS = { side: 'right', ratio: 0.92 };
  const validPosition = (p) =>
    p && (p.side === 'right' || p.side === 'top') && Number.isFinite(p.ratio) && p.ratio >= 0 && p.ratio <= 1;
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const TOOLBAR_STYLE = `
    #jpt-toolbar {position:fixed;z-index:9998;display:inline-flex;align-items:stretch;max-width:calc(100vw - 16px);background:var(--ds-surface-raised,#2C333A);border:1px solid var(--ds-border,#596773);border-radius:3px;font-family:'Atlassian Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;font-weight:500;color:var(--ds-text,#B6C2CF);user-select:none;overflow:visible}
    #jpt-toolbar button {display:inline-flex;align-items:center;justify-content:center;min-height:36px;cursor:pointer;padding:6px 12px;white-space:nowrap}
    #jpt-toolbar button:hover {background:var(--ds-background-neutral-hovered,#38414A)!important}
    #jpt-toolbar button:focus-visible {outline:2px solid var(--ds-border-focused,#85B8FF);outline-offset:2px}
    #jpt-toolbar button:disabled {cursor:wait;opacity:.6}
    #jpt-toolbar .jpt-tb-handle {padding:0 8px;cursor:grab;touch-action:none}
    #jpt-toolbar.dragging {box-shadow:0 6px 28px #669df166;opacity:.9}
    #jpt-toolbar.dragging .jpt-tb-handle {cursor:grabbing}
    #jpt-toolbar .jpt-tb-label::before {content:'';width:8px;height:8px;border-radius:50%;margin-right:8px;background:var(--ds-icon-disabled,#5A5A5E)}
    #jpt-toolbar.jpt-tb-on .jpt-tb-label::before {background:var(--ds-icon-success,#4BCE97)}
    #jpt-toolbar .jpt-tb-flash {position:absolute;bottom:calc(100% + 6px);right:0;box-sizing:border-box;width:max-content;max-width:min(300px,calc(100vw - 16px));background:var(--ds-surface-overlay,#282A2E);border:1px solid var(--ds-border,#596773);border-radius:3px;padding:6px 10px;font-size:12px;white-space:normal;pointer-events:none}
    #jpt-toolbar .jpt-tb-flash:empty {display:none}
    #jpt-toolbar[data-side="top"] .jpt-tb-flash {bottom:auto;top:calc(100% + 6px);left:0;right:auto}
  `;
  function createToolbar(env) {
    const { window: win, document: doc, client, adapter } = env;
    const interval = env.setInterval || win.setInterval.bind(win),
      clear = env.clearInterval || win.clearInterval.bind(win);
    const later = env.setTimeout || win.setTimeout.bind(win),
      cancelLater = env.clearTimeout || win.clearTimeout.bind(win);
    const alive = env.isAlive || (() => true);
    let bar = null,
      toggle = null,
      status = null,
      enabled = true,
      pos = { ...DEFAULT_POS },
      disposed = false,
      paused = false,
      started = false,
      busy = false,
      version = 0,
      readVersion = 0,
      lastUrl = '',
      poll = null,
      unsubscribe = null,
      stopDrag = null,
      pendingSync = false,
      reading = false;
    let refreshButton = null,
      configured = false,
      projectReady = false,
      notice = '',
      noticeTimer = null;
    const listeners = [];
    // An imported file or the Jira project property (reported by the page) both configure the project.
    function applyPage(context) {
      let page = null;
      try {
        page = win.__jptPageState?.();
      } catch {}
      configured = !!context.configured || !!page?.configured;
      enabled = typeof page?.enabled === 'boolean' && page.configured ? page.enabled : context.settings?.enabled !== false;
    }
    function listen(target, type, handler) {
      target.addEventListener(type, handler);
      listeners.push(() => target.removeEventListener(type, handler));
    }
    function place() {
      if (!bar) return;
      const r = bar.getBoundingClientRect();
      bar.setAttribute('data-side', pos.side);
      Object.assign(bar.style, { left: 'auto', right: 'auto', top: 'auto', bottom: 'auto' });
      if (pos.side === 'top') {
        bar.style.top = '8px';
        bar.style.left = pos.ratio * Math.max(0, win.innerWidth - (r.width || 160)) + 'px';
      } else {
        bar.style.right = '8px';
        bar.style.top = pos.ratio * Math.max(0, win.innerHeight - (r.height || 40)) + 'px';
      }
    }
    function renderMessage() {
      if (status) status.textContent = notice || (projectReady && !configured ? t('tbNotConfigured') : '');
    }
    function clearMessage() {
      if (noticeTimer !== null) cancelLater(noticeTimer);
      noticeTimer = null;
      notice = '';
      renderMessage();
    }
    function message(text) {
      clearMessage();
      notice = text;
      renderMessage();
      noticeTimer = later(() => {
        noticeTimer = null;
        notice = '';
        renderMessage();
      }, 3500);
    }
    function reflect() {
      if (!bar) return;
      const ready = projectReady && configured,
        on = ready && enabled;
      bar.classList.toggle('jpt-tb-on', on);
      bar.classList.toggle('jpt-tb-off', !on);
      toggle.textContent = t(!projectReady ? 'tbChecking' : !configured ? 'tbNotSetUp' : enabled ? 'tbOn' : 'tbOff');
      toggle.setAttribute('aria-pressed', on);
      toggle.disabled = !ready || busy;
      if (refreshButton) refreshButton.disabled = !ready || busy;
      renderMessage();
    }
    function fail(error, action = t('tbActionReadSettings')) {
      if (!alive() || error?.code === 'disconnected') {
        destroy();
        return;
      }
      message(t('tbActionFailed', { action, reason: error?.message || t('tbTryAgain') }));
    }
    function done(token) {
      if (token !== version) return;
      busy = false;
      reflect();
      if (pendingSync) {
        pendingSync = false;
        void sync(true);
      }
    }
    function begin() {
      busy = true;
      readVersion++;
      reading = false;
      clearMessage();
      reflect();
    }
    async function savePosition(next) {
      if (busy) return;
      begin();
      const previous = pos,
        token = version;
      pos = next;
      place();
      try {
        await client.savePosition(next);
      } catch (error) {
        if (token === version) {
          pos = previous;
          place();
          fail(error, t('tbActionMove'));
        }
      } finally {
        done(token);
      }
    }
    function addButton(action, label, title, className) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = className;
      button.dataset.jptAction = action;
      button.textContent = label;
      button.title = title;
      button.setAttribute('aria-label', title);
      Object.assign(button.style, { font: 'inherit', color: 'inherit', background: 'transparent', border: '0' });
      bar.appendChild(button);
      return button;
    }
    function inject(context, ready) {
      bar = doc.createElement('div');
      bar.id = 'jpt-toolbar';
      bar.setAttribute('role', 'group');
      bar.setAttribute('aria-label', t('tbGroupLabel'));
      const style = doc.createElement('style');
      style.textContent = TOOLBAR_STYLE;
      bar.appendChild(style);
      const handle = addButton('move', '⠿', t('tbMoveTitle'), 'jpt-tb-handle');
      toggle = addButton('toggle', t('tbLoading'), t('tbToggleTitle'), 'jpt-tb-seg jpt-tb-label');
      const refresh = addButton('refresh', '↻', t('tbRescanTitle'), 'jpt-tb-seg jpt-tb-icon');
      refreshButton = refresh;
      status = doc.createElement('span');
      status.className = 'jpt-tb-flash show';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      bar.appendChild(status);
      doc.body.appendChild(bar);
      projectReady = ready;
      applyPage(context);
      pos = validPosition(context.position) ? { ...context.position } : { ...DEFAULT_POS };
      reflect();
      place();
      toggle.addEventListener('click', async () => {
        if (busy || !projectReady || !configured) return;
        begin();
        const next = !enabled,
          token = version;
        try {
          await client.savePreferences({ enabled: next });
          if (token === version) {
            enabled = next;
            reflect();
          }
        } catch (error) {
          if (token === version) fail(error, t('tbActionToggle'));
        } finally {
          done(token);
        }
      });
      refresh.addEventListener('click', async () => {
        if (busy || !projectReady || !configured) return;
        if (!enabled) {
          message(t('tbTurnOnFirst'));
          return;
        }
        begin();
        refresh.disabled = true;
        const token = version;
        try {
          const result = await (win.__jptRefresh ? win.__jptRefresh() : client.refresh());
          if (token === version) message(result?.delivered > 0 ? t('tbRescanSent') : t('tbRescanNotDelivered'));
        } catch (error) {
          if (token === version) fail(error, t('tbActionRescan'));
        } finally {
          if (token === version) refresh.disabled = false;
          done(token);
        }
      });
      handle.addEventListener('keydown', (event) => {
        const next = { ...pos };
        if (event.key === 'Home') next.ratio = 0;
        else if (event.key === 'End') next.ratio = 1;
        else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next.ratio = clamp(pos.ratio - 0.05);
        else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next.ratio = clamp(pos.ratio + 0.05);
        else return;
        event.preventDefault();
        void savePosition(next);
      });
      // Enter and Space use the button's native click activation.
      handle.addEventListener('click', (event) => {
        if (event.detail === 0) void savePosition({ ...pos, side: pos.side === 'top' ? 'right' : 'top' });
      });
      handle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || busy) return;
        event.preventDefault();
        stopDrag?.();
        const rect = bar.getBoundingClientRect(),
          x = event.clientX,
          y = event.clientY;
        let moved = false;
        const move = (e) => {
          if (e.pointerId !== event.pointerId) return;
          if (e.buttons === 0) {
            finish();
            return;
          }
          const dx = e.clientX - x,
            dy = e.clientY - y;
          if (!moved && Math.hypot(dx, dy) < 4) return;
          moved = true;
          bar.classList.add('dragging');
          Object.assign(bar.style, { right: 'auto', left: rect.left + dx + 'px', top: rect.top + dy + 'px' });
        };
        const cleanup = () => {
          doc.removeEventListener('pointermove', move);
          doc.removeEventListener('pointerup', up);
          doc.removeEventListener('pointercancel', cancel);
          win.removeEventListener('blur', cancel);
          bar?.classList.remove('dragging');
          stopDrag = null;
        };
        const finish = () => {
          const r = bar?.getBoundingClientRect();
          cleanup();
          if (!moved || !r) return;
          const side = Math.max(0, r.top) < Math.max(0, win.innerWidth - r.right) ? 'top' : 'right';
          void savePosition({
            side,
            ratio: clamp(
              side === 'top'
                ? r.left / Math.max(1, win.innerWidth - r.width)
                : r.top / Math.max(1, win.innerHeight - r.height),
            ),
          });
        };
        const up = (e) => {
          if (e.pointerId === event.pointerId) finish();
        };
        const cancel = () => {
          cleanup();
          place();
        };
        stopDrag = cancel;
        doc.addEventListener('pointermove', move);
        doc.addEventListener('pointerup', up);
        doc.addEventListener('pointercancel', cancel);
        win.addEventListener('blur', cancel);
      });
    }
    function remove() {
      version++;
      readVersion++;
      reading = false;
      stopDrag?.();
      clearMessage();
      bar?.remove();
      bar = null;
      toggle = null;
      refreshButton = null;
      status = null;
      configured = false;
      projectReady = false;
      busy = false;
      pendingSync = false;
    }
    async function sync(force = false) {
      if (disposed || paused) return;
      if (!alive()) {
        destroy();
        return;
      }
      const url = win.location.href,
        changed = url !== lastUrl;
      if (changed) {
        lastUrl = url;
        remove();
      }
      if (!adapter.isTimelinePage(win.location, doc)) {
        if (bar) remove();
        return;
      }
      if (busy) {
        if (force) pendingSync = true;
        return;
      }
      if ((bar && !force) || (reading && !force)) return;
      const resolved = win.__jptGetProjectId?.();
      const token = version,
        read = ++readVersion,
        project = /^\d+$/.test(resolved || '') ? String(resolved) : adapter.getProjectKey(win.location);
      reading = true;
      const ready = !project || /^\d+$/.test(project);
      try {
        const context = await client.getContext({
          origin: win.location.origin,
          ...(/^\d+$/.test(project || '') ? { projectId: project } : {}),
        });
        if (
          disposed ||
          token !== version ||
          read !== readVersion ||
          win.location.href !== url ||
          !adapter.isTimelinePage(win.location, doc)
        )
          return;
        if (!alive()) {
          destroy();
          return;
        }
        if (!bar) inject(context, ready);
        else {
          projectReady = ready;
          applyPage(context);
          if (validPosition(context.position)) pos = { ...context.position };
          reflect();
          if (!stopDrag) place();
        }
      } catch (error) {
        if (token === version && read === readVersion) fail(error);
      } finally {
        if (read === readVersion) reading = false;
      }
    }
    function suspend() {
      paused = true;
      remove();
      if (poll !== null) clear(poll);
      poll = null;
      unsubscribe?.();
      unsubscribe = null;
    }
    function connect() {
      paused = false;
      unsubscribe = client.subscribe(() => void sync(true));
      poll = interval(() => void sync(), 750);
      void sync(true);
    }
    function destroy() {
      if (disposed) return;
      disposed = true;
      suspend();
      listeners.splice(0).forEach((fn) => fn());
    }
    function start() {
      if (started || disposed) return;
      started = true;
      listen(win, 'pagehide', (event) => {
        if (event.persisted) suspend();
        else destroy();
      });
      listen(win, 'pageshow', () => {
        if (paused && !disposed) connect();
      });
      listen(win, 'jpt:context-ready', () => void sync(true));
      listen(win, 'popstate', () => void sync());
      listen(win, 'hashchange', () => void sync());
      listen(win, 'resize', () => {
        if (!stopDrag) place();
      });
      if (win.visualViewport)
        listen(win.visualViewport, 'resize', () => {
          if (!stopDrag) place();
        });
      connect();
    }
    return { start, sync, destroy };
  }
  return { createToolbar };
});
