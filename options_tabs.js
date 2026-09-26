/* Settings page tabs. The admin generator is a bundled extension page, loaded only when opened. */
(function (root) {
  'use strict';
  function createTabs(doc, win) {
    const tabs = ['settings', 'generator'].map((name) => ({
      name,
      tab: doc.getElementById('tab-' + name),
      panel: doc.getElementById('panel-' + name),
    }));
    const frame = doc.getElementById('generator-frame');
    let observer = null;
    // Size the frame to its content so the page has one scrollbar; a hidden frame reports no height.
    function fit() {
      const body = frame.contentDocument?.body;
      if (!body) return;
      const height = Math.ceil(body.getBoundingClientRect().height);
      if (height > 0) frame.style.height = height + 'px';
    }
    function loadGenerator() {
      if (frame.getAttribute('src')) return;
      frame.addEventListener('load', () => {
        fit();
        const Observer = frame.contentWindow?.ResizeObserver,
          body = frame.contentDocument?.body;
        if (Observer && body) {
          observer?.disconnect();
          observer = new Observer(fit);
          observer.observe(body);
        }
      });
      frame.setAttribute('src', frame.dataset.src);
    }
    function select(name, { focus = false, updateHash = true } = {}) {
      const target = tabs.find((t) => t.name === name) || tabs[0];
      for (const t of tabs) {
        const on = t === target;
        t.tab.setAttribute('aria-selected', String(on));
        t.tab.tabIndex = on ? 0 : -1;
        t.panel.hidden = !on;
      }
      if (target.name === 'generator') {
        loadGenerator();
        fit();
      }
      if (focus) target.tab.focus();
      if (updateHash)
        win.history?.replaceState(null, '', target.name === 'generator' ? '#generator' : win.location.pathname);
      return target.name;
    }
    tabs.forEach((t, i) => {
      t.tab.addEventListener('click', () => select(t.name));
      t.tab.addEventListener('keydown', (event) => {
        const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        select(tabs[(next + tabs.length) % tabs.length].name, { focus: true });
      });
    });
    const fromHash = () => (win.location.hash === '#generator' ? 'generator' : 'settings');
    win.addEventListener('hashchange', () => select(fromHash(), { updateHash: false }));
    select(fromHash(), { updateHash: false });
    return { select };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { createTabs };
  else createTabs(root.document, root);
})(globalThis);
