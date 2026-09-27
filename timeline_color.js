// timeline_color.js
// 在 Jira Timeline 把 Planning Task / Milestone 的時間軸條塊染色
//
// Jira Timeline DOM 結構（2026-08-26 改版後重新實測，取代 2026-05 那版）：
//   一個 issue = 一張 <table> 裡的一個 <tr>；key/summary/status/assignee/甘特圖
//   bar 全部是同一列的儲存格，不再有獨立的 list-item / chart-item 兩組虛擬列表
//   靠數字 ID 互相對應——直接在同一個 <tr> 裡找就好，見 getTimelineRows() /
//   extractIssueId() / extractIssueKey()。
//   key text: [data-testid="native-issue-table.common.ui.issue-cells.issue-key.issue-key-cell"]
//   bar:      [data-testid*="draggable-bar-"][data-testid$="-container"]
//             （testid 內容形如 ...draggable-bar-ari:cloud:jira:<uuid>:issue/<數字ID>-container）
// 這次改版詳情、逐項選擇器對照表見同目錄 UI_MIGRATION_2026-08.md。
//
//   ptColor    Planning Task 顏色（預設 #6a9a23）
//   msColor    Milestone 顏色（預設 #FF8B00）
//   msDiamond  Milestone 是否顯示為菱形（預設 false）
//

(() => {
  // Confluence shares the atlassian.net origin but has no Jira Timeline; stay completely inactive there.
  if (!JptTimeline.isJiraApp(location)) return;
  const DEBUG = false;
  const DEFAULTS = JptSettings.DEFAULTS;
  let settings = { ...DEFAULTS, enabled: false },
    profile = null;
  let active = false,
    disposed = false,
    generation = 0,
    activationEpoch = 0;
  let requests = new AbortController();
  const lifetime = new AbortController();
  const session = new JptSession.RuntimeSession({ api: JiraApi, client: JptClient });
  const t = (key, params) => JptI18n.t(key, params);
  let status = { state: 'checking', message: t('statusCheckingSettings'), details: [], projectId: null };
  window.__jptGetProjectId = () => status.projectId;
  // The toolbar asks the page whether it is configured: the Jira project property counts, not just an imported file.
  window.__jptPageState = () => ({
    configured: !!status.source,
    enabled: inputSignature ? JSON.parse(inputSignature).settings.enabled !== false : null,
  });
  window.__jptRefresh = async () => {
    if (disposed) return { delivered: 0 };
    stopActive();
    session.clear();
    requestSettingsReload();
    return { delivered: 1 };
  };
  const isActive = () => active && settings.enabled && !disposed && isTimelinePage();
  const on = (target, type, handler, options = {}) => {
    const opt = typeof options === 'boolean' ? { capture: options } : options;
    const input = ['keydown', 'mouseover', 'mouseout', 'mousedown', 'mouseup', 'scroll'].includes(type);
    target.addEventListener(
      type,
      (event) => {
        if (!disposed && (!input || isActive())) handler(event);
      },
      { ...opt, signal: lifetime.signal },
    );
  };
  let FIELD_ROLE = null,
    FIELD_EPIC_HIGHLIGHT = null,
    FIELD_START_DATE = null,
    FIELD_TARGET_END = null;

  // 染色標記類
  const PT_CLASS = 'jpt-pt-bar';
  const MS_CLASS = 'jpt-ms-bar';
  const DIA_CLASS = 'jpt-ms-diamond';
  const EPIC_HIGHLIGHT_CLASS = 'jpt-epic-highlight';
  const PROGRESS_CLASS = 'jpt-ms-progress';
  const PT_TARGET_SHADE_CLASS = 'jpt-pt-target-end-shade';
  const ALL_CLASSES = [PT_CLASS, MS_CLASS, DIA_CLASS, EPIC_HIGHLIGHT_CLASS, PT_TARGET_SHADE_CLASS];

  const TYPE_TO_CLASS = { planning: PT_CLASS, milestone: MS_CLASS };
  const EPIC_TYPE_NAMES = new Set(['epic']);

  // ─── 選擇器（2026-08 Jira Timeline 改版後重新對應）──────
  // 舊版：list-item / chart-item 各自帶數字 ID 的獨立 testid，靠 ID 互相對應。
  // 新版：整個 Timeline 變成一張 <table>，一個 issue = 一個 <tr>，
  //       key/summary/bar 都是同一個 <tr> 裡的儲存格，不再需要 ID 對應，
  //       直接在同一列裡找就好。
  const SEL_KEY = '[data-testid="native-issue-table.common.ui.issue-cells.issue-key.issue-key-cell"]';
  const SEL_BAR_CONTAINER = '[data-testid*="draggable-bar-"][data-testid$="-container"]';

  // 找目前 Timeline 用的那張 table：優先用 issue key cell 反查（最準），
  // 找不到（頁面還沒渲染完）就退回抓頁面上第一張有 <thead> 的 table。
  const getTimelineTable = () => JptTimeline.getTable(document);

  const getTimelineRows = () => {
    const table = getTimelineTable();
    return table ? [...table.querySelectorAll('tbody tr')] : [];
  };

  // bar 的 data-testid 現在長這樣（前綴沒變，但 <ID> 從純數字換成完整 ARI）：
  //   roadmap.timeline-table-kit.ui.chart-item-content.date-content.bar.draggable-bar-ari:cloud:jira:<uuid>:issue/<數字ID>-container
  // 我們只在乎結尾的數字 issue id，用「結尾符合」選取器直接比對，不用管中間的 uuid。
  const extractIssueIdFromBar = (bar) => {
    const m = (bar?.getAttribute('data-testid') || '').match(/issue\/(\d+)-container$/);
    return m ? m[1] : null;
  };
  const findBarById = (id) => document.querySelector(`[data-testid$="issue/${id}-container"]`);

  // Only bounded, short-lived memory. No issue data is written into browser storage.
  const DATA_TTL_MS = 300000;
  const TTL_JITTER_MS = 0;
  const typeCache = new JptCache.MemoryCache({ ttl: 3600000, max: 1000 });
  const dataCache = new JptCache.MemoryCache({ ttl: DATA_TTL_MS, max: 1000 });
  const detailCache = new JptCache.MemoryCache({ ttl: DATA_TTL_MS, max: 200 });
  const getData = (key) => ({ ...dataCache.get(key), ...detailCache.get(key) });
  const pending = new Set();
  const isDataFresh = (entry) => !!entry && Date.now() - entry.ts < DATA_TTL_MS;
  const needsFetch = (key) => !typeCache.has(key) || !isDataFresh(dataCache.get(key));

  // ─── 設定：套到 :root CSS 變數 + body class ─────────
  const applyCssVars = () => {
    const r = document.documentElement.style;
    r.setProperty('--jpt-pt-color', settings.ptColor);
    r.setProperty('--jpt-ms-color', settings.msColor);
    // 關閉上色時保留 Jira 原本的顏色（例如管理員設定的 Issue color）
    document.body?.classList.toggle('jpt-pt-native', settings.ptColorEnabled === false && isActive());
    document.body?.classList.toggle('jpt-ms-native', settings.msColorEnabled === false && isActive());
    // CSS 效果類 class 全部 gate on settings.enabled — 停用時務必同步移除
    document.body?.classList.toggle('jpt-hide-current-month', !!settings.hideCurrentMonth && isActive());
    document.body?.classList.toggle('jpt-hide-issue-key', !!settings.hideIssueKey && isActive());
    // Milestone 鎖定前後拉長 — 固化為預設行為，但只在啟用時生效
    document.body?.classList.toggle('jpt-ms-lock-edges', isActive());
    // 「目前時段」高亮：不是靜態 CSS 規則了，設定一變就重新找一次目標欄位
    try {
      applyCurrentPeriodHide();
    } catch {}
  };

  // ─── 週末/假日 strip 渲染（universal：支援週/月/季 view）───
  const STRIP_CLASS = 'jpt-cal-strip';

  // 2026-08 改版後這兩個 testid 都消失了，改用結構/幾何特徵抓：
  //   header row → table 的 <thead><tr>，最後一個儲存格就是甘特圖表頭
  //   （工作/狀態/受託人在前面幾格，甘特圖表頭固定是最後一個）
  //   today marker → 全頁掃 <div>，找「窄（≤4px）+ 高（>300px）+ 實色背景」的
  //   那個（原本的 testid 保護沒了，抓到後 cache 住，元素被移出 DOM 才重新掃，
  //   避免每次呼叫都全頁掃一輪 div）
  const getHeaderRow = () => {
    const headerTr = getTimelineTable()?.querySelector('thead tr');
    return headerTr ? headerTr.lastElementChild : null;
  };

  // ─── 隱藏「目前時段」高亮（2026-08 改版後重新對應）──────
  // 舊版純 CSS 寫死雜湊 class：body.jpt-hide-current-month ._1kl7ia51._1s7zia51
  // 新版沒有雜湊 class 可預先寫死了，但這次改版意外地讓這格「有 testid 了」：
  // 一組 [data-testid^="timeline.chart-overlays.columns-overlay.column-N"]
  // 裡，背景不透明的那一個就是目前高亮的月/週/季欄。用 JS 動態找到它，直接在
  // 該元素上加 class 蓋掉背景（取代原本寫死選擇器的 CSS 規則）。
  const SEL_COLUMN_OVERLAY = '[data-testid^="timeline.chart-overlays.columns-overlay.column-"]';
  const CURRENT_PERIOD_HIDE_CLASS = 'jpt-current-period-hidden';
  // 實測發現：同一個 column-N testid 在 DOM 裡其實有「兩份」——一份活在
  // <thead> 底下（尺寸只有 header cell 高，通常background transparent，
  // 是虛擬化/複用機制留下的殘影節點）、另一份活在 table 外層的
  // chart-overlays.container（真正貫穿 header+body 整欄高度的那個，才是
  // 畫面上實際看得到的高亮）。哪一份「目前是非透明」會隨著虛擬化/捲動變化，
  // 舊版「找到第一個非透明的就 break」的寫法，遇到捲動那個瞬間可能剛好抓到
  // thead 那份短命的殘影，把 hide class 蓋在錯的節點上，結果真正畫在畫面上
  // 的欄位反而沒被隱藏——使用者看到的就是「標頭那格看起來被處理過，但下面
  // 整欄的高亮還在」。改成不 break、每次重新整理全部符合條件的節點，並且
  // 每次都先清掉舊的 hide class 再重算，才不會被虛擬化的殘影節點誤導。
  const applyCurrentPeriodHide = () => {
    if (!isActive() || !settings.hideCurrentMonth) {
      document
        .querySelectorAll(`.${CURRENT_PERIOD_HIDE_CLASS}`)
        .forEach((el) => el.classList.remove(CURRENT_PERIOD_HIDE_CLASS));
      return;
    }
    for (const col of document.querySelectorAll(SEL_COLUMN_OVERLAY)) {
      if (col.classList.contains(CURRENT_PERIOD_HIDE_CLASS)) continue;
      const bg = getComputedStyle(col).backgroundColor;
      if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
        col.classList.add(CURRENT_PERIOD_HIDE_CLASS);
      }
    }
  };

  // 舊版讀 URL ?timeline=WEEKS|MONTHS|QUARTERS；2026-08 改版後 URL 不再帶這個
  // 參數（純前端 state，實測切視圖 URL 完全不變），改成讀「週/月/季」三顆切換
  // 按鈕，找目前背景不透明（= 被選中）的那顆，用按鈕文字對應模式。
  // 文字依站台語系而定，對照表在 timeline_dates.js 的 JptDates.modeFromLabel。
  const SEL_MODE_SWITCHER_BUTTON = '[data-testid="aais-timeline-toolbar.ui.timeline-mode-switcher.expand-button"]';
  const getTimelineMode = () => {
    const params = new URLSearchParams(location.search);
    const fromUrl = params.get('rangeMode') || params.get('timeline');
    if (['WEEKS', 'MONTHS', 'QUARTERS'].includes(fromUrl)) return fromUrl;
    for (const radio of document.querySelectorAll('[role="radio"][aria-checked="true"]')) {
      const mode = JptDates.modeFromLabel(radio.textContent);
      if (mode) return mode;
    }
    for (const b of document.querySelectorAll(SEL_MODE_SWITCHER_BUTTON)) {
      const bg = getComputedStyle(b).backgroundColor;
      const selected =
        b.getAttribute('aria-pressed') === 'true' ||
        b.getAttribute('aria-selected') === 'true' ||
        b.getAttribute('data-state') === 'active';
      if (!selected && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) continue;
      const label = JptDates.modeFromLabel(b.textContent);
      if (label) return label;
    }
    return null; // Unknown mode must not produce guessed date geometry.
  };

  let stripLayer = null;
  const calendarScale = () => JptGeometry.readScale(getTimelineTable(), JptDates, getTimelineMode());
  const clearHolidayStrips = () => {
    stripLayer?.remove();
    stripLayer = null;
  };
  const drawHolidayStrips = () => {
    if (!isActive()) return;
    applyCurrentPeriodHide();
    if (!settings.showWeekends && !settings.showHolidays) {
      clearHolidayStrips();
      return;
    }
    const table = getTimelineTable(),
      scale = calendarScale();
    const parent = JptTimeline.getOverlay(table);
    if (!scale || !parent) {
      clearHolidayStrips();
      return;
    }
    if (!stripLayer || stripLayer.parentElement !== parent) {
      clearHolidayStrips();
      stripLayer = document.createElement('div');
      stripLayer.className = 'jpt-calendar-layer';
      Object.assign(stripLayer.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
      parent.appendChild(stripLayer);
    }
    const parentRect = parent.getBoundingClientRect(),
      wanted = new Set();
    const existing = new Map([...stripLayer.children].map((el) => [el.dataset.day, el]));
    for (const cell of scale.cells) {
      const first = Date.parse(cell.start + 'T00:00:00Z'),
        end = Date.parse(cell.endExclusive + 'T00:00:00Z');
      for (let stamp = first; stamp < end && stamp - first < 370 * 86400000; stamp += 86400000) {
        const date = new Date(stamp),
          iso = date.toISOString().slice(0, 10);
        const next = new Date(stamp + 86400000).toISOString().slice(0, 10);
        // 補班日（週末但上班）不畫週末色帶
        const kind = JptCalendar.kindOf(iso, calendarInfo);
        const holiday = settings.showHolidays && kind === 'holiday';
        const weekend = settings.showWeekends && kind === 'weekend';
        if (!holiday && !weekend) continue;
        const left = scale.dateToX(iso),
          right = scale.dateToX(next);
        if (left == null || right == null || right <= left) continue;
        wanted.add(iso);
        let strip = existing.get(iso);
        if (!strip) {
          strip = document.createElement('div');
          strip.dataset.day = iso;
          stripLayer.appendChild(strip);
        }
        const cls = STRIP_CLASS + ' ' + (holiday ? 'jpt-cal-holiday' : 'jpt-cal-weekend');
        if (strip.className !== cls) strip.className = cls;
        const x = left - parentRect.left + parent.scrollLeft + 'px',
          width = right - left + 'px';
        if (strip.style.left !== x) strip.style.left = x;
        if (strip.style.width !== width) strip.style.width = width;
      }
    }
    for (const [day, el] of existing) if (!wanted.has(day)) el.remove();
  };

  // ─── 方向鍵左右捲動時間軸 ─────────────────────────
  // capture 階段攔截，避免 Jira row-navigation 接走方向鍵
  const SCROLL_STEP = 200; // 一次 ~ 一週（月視圖）
  const SCROLL_BIG = 800; // Shift 修飾鍵
  // Widgets that use arrow keys themselves; never steal their keyboard input.
  const ARROW_KEY_EXCLUDED =
    'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"], [role="menu"], [role="menubar"], [role="listbox"], [role="combobox"], [role="slider"], [role="spinbutton"], [role="tablist"], [role="tree"], [role="radiogroup"], #jpt-toolbar';
  const onArrowKey = (e) => {
    if (!isActive()) return; // 方向鍵捲動已固化為預設行為
    if (!isTimelinePage()) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    // jira-people-view modal 開著時不搶方向鍵（讓它自己捲自己的時間軸）
    if (document.getElementById('jpv-modal')) return;
    // 修飾鍵（除 Shift）放行給瀏覽器/Jira
    if (e.altKey || e.ctrlKey || e.metaKey) return;

    // 舊 testid「sr-timeline」2026-08 改版後也消失了，實測新版捲動容器換成
    // scroll-container.scroll-container。
    const scroller = document.querySelector('[data-testid="scroll-container.scroll-container"]');
    if (!scroller) return;
    // Only handle keys aimed at the Timeline itself or the page background; the side panel,
    // dialogs, menus, pickers and text fields keep their own keyboard behaviour.
    const t = e.target;
    const onPageBackground = t === document || t === document.body || t === document.documentElement;
    if (!onPageBackground && !scroller.contains(t)) return;
    if (t?.closest?.(ARROW_KEY_EXCLUDED) || document.querySelector('[aria-modal="true"]')) return;

    const step = e.shiftKey ? SCROLL_BIG : SCROLL_STEP;
    const dir = e.key === 'ArrowLeft' ? -1 : 1;
    scroller.scrollLeft += step * dir;
    e.preventDefault();
    e.stopPropagation();
  };
  on(document, 'keydown', onArrowKey, true); // capture 階段

  // 假日、補班日與涵蓋年份都來自設定（專案屬性或設定檔），不再另外下載
  let calendarInfo = JptCalendar.dayInfo();
  let reloadTimer = null,
    inputSignature = null,
    settingsReadVersion = 0;
  const loadSettings = async () => {
    const epoch = ++activationEpoch;
    stopActive({ keepAppearance: !!profile && settings.enabled && isTimelinePage() });
    if (document.visibilityState === 'hidden') {
      session.clear();
      status = { ...status, state: 'checking', message: t('statusReturnToTab'), details: [] };
      return;
    }
    if (!isTimelinePage()) {
      session.clear();
      status = { state: 'unsupported', message: t('statusOpenTimeline'), details: [], projectId: null };
      return;
    }
    status = { state: 'checking', message: t('statusCheckingJira'), details: [], projectId: null };
    try {
      const result = await session.load(location.origin, JptTimeline.getProjectKey(location));
      if (epoch !== activationEpoch || disposed || !isTimelinePage()) return;
      profile = result.profile;
      calendarInfo = JptCalendar.dayInfo(profile?.calendar);
      inputSignature = result.inputSignature;
      settings = { ...DEFAULTS, ...result.settings, enabled: !!profile && result.settings.enabled !== false };
      FIELD_ROLE = profile?.fields.role;
      FIELD_EPIC_HIGHLIGHT = profile?.fields.epicHighlight;
      FIELD_START_DATE = profile?.fields.startDate;
      FIELD_TARGET_END = profile?.fields.targetEnd;
      status = {
        state: result.state,
        message: result.message,
        details: result.details,
        projectId: result.projectId,
        source: result.source || null,
        sourceLabel: result.sourceLabel || '',
        sourceUpdatedAt: result.sourceUpdatedAt || '',
        years: calendarInfo.years,
      };
      updateActivation();
      window.dispatchEvent(new Event('jpt:context-ready'));
    } catch (error) {
      if (epoch !== activationEpoch || disposed || error.name === 'AbortError') return;
      settings.enabled = false;
      session.clear();
      stopActive();
      status = {
        state: error.status === 401 ? 'login' : 'unavailable',
        message: error.status === 401 ? t('statusSignIn') : t('statusCantCheck'),
        details: [],
        projectId: null,
      };
    }
  };
  const requestSettingsReload = () => {
    clearTimeout(reloadTimer);
    if (disposed || document.visibilityState === 'hidden') {
      reloadTimer = null;
      return;
    }
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      void loadSettings();
    }, 350);
  };

  // ─── 抽 ID / Key ────────────────────────────────────
  // row 現在就是 <tr>：key 直接在同一列裡找；id 則從同一列裡的 bar 反推
  // （bar 不一定存在——例如任務沒填日期就不會有 bar，這時 id 會是 null，
  //   跟舊版「這個 issue 沒東西可上色」的行為一致）。
  // findBarById 定義移到檔案上方的選擇器區塊，跟 extractIssueIdFromBar 放一起。
  const extractIssueId = (row) => extractIssueIdFromBar(row.querySelector(SEL_BAR_CONTAINER));
  const extractIssueKey = (row) => {
    const keyEl = row.querySelector(SEL_KEY);
    return keyEl?.textContent?.trim() || null;
  };

  // ─── Milestone 進度 badge ──────────────────────────
  const progressColorTier = (pct) => {
    if (pct >= 100) return 'jpt-ms-progress-done';
    if (pct >= 50) return 'jpt-ms-progress-mid';
    if (pct > 0) return 'jpt-ms-progress-low';
    return 'jpt-ms-progress-zero';
  };

  const formatDueMonthDay = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? `${Number(m[2])}/${Number(m[3])}` : '';
  };

  const renderProgressBadge = (bar, progress, dueDate) => {
    const existing = bar.querySelector(`:scope > .${PROGRESS_CLASS}`);
    const dueText = formatDueMonthDay(dueDate);
    // 完成度與 Due date 各自可顯示；兩者都沒有或設定關閉才清掉 badge。
    const hasProgress =
      progress &&
      Number.isFinite(progress.pct) &&
      Number.isFinite(progress.total) &&
      progress.total > 0 &&
      Number.isFinite(progress.done) &&
      Number.isFinite(progress.wip);
    if ((!hasProgress && !dueText) || !settings.msShowProgress) {
      existing?.remove();
      return;
    }
    // 分子 = 已開始的任務數（done + wip）；% 數仍以「進行中算半分」計算
    const progressText = hasProgress ? `${progress.done}/${progress.total} ${progress.pct}%` : '';
    const text = [progressText, dueText ? `DUE ${dueText}` : ''].filter(Boolean).join(' · ');
    const progressTitle = !hasProgress
      ? ''
      : progress.wip > 0
        ? t('progressTitleWip', {
            done: progress.done,
            wip: progress.wip,
            weight: profile?.progress.inProgressWeight ?? 0,
            total: progress.total,
            pct: progress.pct,
          })
        : t('progressTitle', { done: progress.done, total: progress.total, pct: progress.pct });
    const title = [progressTitle, dueText ? t('progressTitleDue', { date: dueDate }) : '']
      .filter(Boolean)
      .join(t('titleSeparator'));
    const tier = hasProgress ? progressColorTier(progress.pct) : 'jpt-ms-progress-zero';
    // 冪等：內容/色階一致就不動 DOM（避免 MutationObserver 雪球）
    if (existing && existing.textContent === text && existing.classList.contains(tier) && existing.title === title) {
      return;
    }
    if (existing) existing.remove();
    const span = document.createElement('span');
    span.className = `${PROGRESS_CLASS} ${tier}`;
    span.textContent = text;
    span.title = title;
    bar.appendChild(span);
  };
  // ─── 套色到單一 bar ──────────────────────────────────
  // 冪等實作：先算出目標 class set，再跟 bar 現有 class 比對，差異才動 DOM。
  // 之前無條件 remove(...ALL_CLASSES) + add 會在新一輪掃描期間短暫露出 Jira
  // 預設樣式（捲動時尤其明顯），現在 class 沒變就完全不寫入。
  // badge 透過 renderProgressBadge 冪等處理（只在內容改變時才動 DOM）。
  const parseDateOnlyMs = (value) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
  };

  const renderPtTargetEndShade = (bar, data) => {
    const clear = () => {
      bar.classList.remove(PT_TARGET_SHADE_CLASS);
      bar.style.removeProperty('--jpt-target-end-ratio');
    };
    if (!settings.ptTargetEndShade || !data) {
      clear();
      return;
    }
    const start = parseDateOnlyMs(data.startDate);
    const target = parseDateOnlyMs(data.targetEndDate);
    const due = parseDateOnlyMs(data.dueDate);
    if (![start, target, due].every(Number.isFinite) || !(start <= target && target <= due)) {
      clear();
      return;
    }
    const dayMs = 86_400_000;
    const totalDays = Math.floor((due - start) / dayMs) + 1;
    const targetOffsetDays = Math.floor((target - start) / dayMs);
    const ratio = Math.max(0, Math.min(1, targetOffsetDays / totalDays));
    bar.style.setProperty('--jpt-target-end-ratio', `${(ratio * 100).toFixed(3)}%`);
    bar.classList.add(PT_TARGET_SHADE_CLASS);
  };
  const applyColor = (issueId, issueKey) => {
    if (!isActive()) return; // 防呆：停用時絕不上色（含已排隊的 scan timer）
    if (!typeCache.has(issueKey)) return; // 還沒抓過 type，等 fetch 完才上色
    const type = typeCache.get(issueKey);
    const data = dataCache.get(issueKey) || { epicHighlight: false, progress: null };
    const bar = findBarById(issueId);
    if (!bar) return;

    // 目標狀態
    const cls = type ? TYPE_TO_CLASS[type] : null;
    const isMs = cls === MS_CLASS;
    const isEpic = !cls && type && EPIC_TYPE_NAMES.has(type);
    const wantPT = cls === PT_CLASS;
    const wantMS = isMs;
    const wantDIA = isMs && !!settings.msDiamond;
    const wantEpic = isEpic && !!settings.epicStripe && !!data.epicHighlight;

    const cl = bar.classList;
    if (cl.contains(PT_CLASS) !== wantPT) cl.toggle(PT_CLASS, wantPT);
    if (cl.contains(MS_CLASS) !== wantMS) cl.toggle(MS_CLASS, wantMS);
    if (cl.contains(DIA_CLASS) !== wantDIA) cl.toggle(DIA_CLASS, wantDIA);
    if (cl.contains(EPIC_HIGHLIGHT_CLASS) !== wantEpic) cl.toggle(EPIC_HIGHLIGHT_CLASS, wantEpic);

    // Milestone 才顯示 badge；其他類型清掉（renderProgressBadge 自身冪等）
    renderPtTargetEndShade(bar, wantPT ? data : null);
    renderProgressBadge(bar, isMs ? data.progress : null, isMs ? data.dueDate : null);
  };

  // ─── 全頁重渲染（settings 變動時呼叫）──────────────
  const rerenderAll = () => {
    if (!isActive()) return; // 防呆：停用時絕不上色
    getTimelineRows().forEach((row) => {
      const id = extractIssueId(row);
      const key = extractIssueKey(row);
      if (id && key) applyColor(id, key);
    });
  };

  // ─── 從 issuelinks 算 Milestone relates 完成度 ─────
  // Jira API 回的 issuelinks 直接帶 outwardIssue/inwardIssue.fields.status
  // 一次 batch fetch 就拿到所有資料，無需第二輪查。
  // 「relates to」link 類型偵測：可能是 `Relates`、`01_Relates`（客製排序前綴）等。
  // 用 regex 容錯，所有以「relates」結尾／開頭的 link type 都算。
  const computeMsProgress = (links) => JptRules.computeProgress(links, profile);

  // 從 issuelinks 抽出 relates 任務清單（給 hover tooltip 用）
  // typeIconUrl / typeName：用來在 tooltip 每列前面顯示議題類型圖示，一眼辨識任務類型
  // （Story / Task / Bug / Sub-task / Planning Task ...）
  // Apply at fetch time and again at render time so cached lists cannot retain an old order.
  const RELATES_STATUS_ORDER = { indeterminate: 0, new: 1, done: 2 };
  const sortRelatesList = (items) =>
    items.slice().sort((a, b) => {
      const statusOrder = (RELATES_STATUS_ORDER[a.statusCat] ?? 0) - (RELATES_STATUS_ORDER[b.statusCat] ?? 0);
      if (statusOrder !== 0) return statusOrder;
      const typeOrder = (a.typeName || '').localeCompare(b.typeName || '', undefined, {
        numeric: true,
        sensitivity: 'base',
      });
      if (typeOrder !== 0) return typeOrder;
      const summaryOrder = (a.summary || '').localeCompare(b.summary || '', undefined, {
        numeric: true,
        sensitivity: 'base',
      });
      return summaryOrder !== 0
        ? summaryOrder
        : (a.key || '').localeCompare(b.key || '', undefined, { numeric: true, sensitivity: 'base' });
    });

  const computeRelatesList = (links) =>
    sortRelatesList(
      JptRules.peers(links, profile)
        .map((peer) => ({
          key: /^[A-Z][A-Z0-9_]*-\d+$/i.test(peer.key || '') ? peer.key : '',
          summary: typeof peer.fields?.summary === 'string' ? peer.fields.summary.slice(0, 2000) : '',
          statusCat: peer.fields?.status?.statusCategory?.key || '',
          typeIconUrl: JptRules.safeIcon(peer.fields?.issuetype?.iconUrl || '', location.origin),
          typeName: typeof peer.fields?.issuetype?.name === 'string' ? peer.fields.issuetype.name.slice(0, 100) : '',
        }))
        .filter((peer) => peer.key),
    );

  // ─── 批次查 issue 資料 ─────────────────────────────
  // - issuelinks 只在 msShowProgress 開啟時才抓（response size 大幅縮小）
  // Epic 高亮欄位可能是 string / 單選 object / 多選 array — 容錯三種形式
  const isEpicHighlightOn = (raw) => JptRules.highlight(raw, profile?.highlightRule);

  const BATCH_SIZE = 50;
  // API 持續失敗（session 過期 401 / infra 5xx）時的退避 — 沒有這個的話，
  // 失敗的 key 不會進 cache，needsFetch 永遠 true，MutationObserver → scheduleScan
  // 會每 300ms 重發同一批失敗請求無限重打
  let fetchBackoffUntil = 0;
  const FETCH_BACKOFF_MS = 60000;
  const fetchTypes = async (keys) => {
    if (!isActive() || !keys.length || Date.now() < fetchBackoffUntil) return;
    const epoch = generation,
      signal = requests.signal;
    keys = keys.filter((key) => !pending.has(key));
    if (!keys.length) return;
    keys.forEach((key) => pending.add(key));
    try {
      const issues = await JiraApi.searchByKeys(keys, JptRules.requiredFields(profile, settings), { signal });
      if (epoch !== generation || !isActive()) return;
      const seen = new Set();
      for (const issue of issues) {
        if (!keys.includes(issue.key)) continue;
        const fields = issue.fields || {},
          type = JptRules.classifyIssue(issue, profile);
        const role = fields[FIELD_ROLE];
        const roles = (Array.isArray(role) ? role : role == null ? [] : [role])
          .map((value) => (typeof value === 'string' ? value : value?.value || value?.name))
          .filter((value) => typeof value === 'string')
          .slice(0, 30)
          .map((value) => value.slice(0, 100));
        const date = (value) => (JptCalendar.parseDate(value) !== null ? value : null);
        typeCache.set(issue.key, type);
        dataCache.set(issue.key, {
          epicHighlight: isEpicHighlightOn(fields[FIELD_EPIC_HIGHLIGHT]),
          progress: type === 'milestone' && settings.msShowProgress ? computeMsProgress(fields.issuelinks) : null,
          startDate: date(fields[FIELD_START_DATE]),
          dueDate: date(fields.duedate),
          targetEndDate: date(fields[FIELD_TARGET_END]),
          ts: Date.now(),
        });
        detailCache.set(issue.key, {
          relates: type === 'milestone' && settings.msShowProgress ? computeRelatesList(fields.issuelinks) : [],
          roles,
        });
        seen.add(issue.key);
      }
      for (const key of keys)
        if (!seen.has(key)) {
          typeCache.set(key, 'other', 60000);
          dataCache.set(key, { progress: null, relates: [], roles: [], ts: Date.now() }, 60000);
        }
      fetchBackoffUntil = 0;
    } catch (error) {
      if (error.name === 'AbortError' || epoch !== generation) return;
      fetchBackoffUntil = Date.now() + Math.max(FETCH_BACKOFF_MS, error.retryAfterMs || 0);
      if (error.status === 401 || error.status === 403) {
        stopActive();
        session.clear();
        status = {
          ...status,
          state: error.status === 401 ? 'login' : 'unavailable',
          message: t('statusAccessChanged'),
          details: [],
        };
      } else status = { ...status, state: 'partial', message: t('statusPartialData'), details: [] };
    } finally {
      if (epoch === generation) keys.forEach((key) => pending.delete(key));
    }
  };

  // ─── 主掃描（debounce）────────────────────────────
  let scanTimer = null;
  let scanRetryTimer = null;
  const scheduleScan = () => {
    if (!isActive()) return;
    if (scanTimer) return;
    scanTimer = setTimeout(async () => {
      scanTimer = null;
      await scan();
    }, 300);
  };

  const scan = async () => {
    if (!isActive()) return; // 防呆：停用時不掃描（含 cacheBuster / 殘留 timer）
    const listItems = getTimelineRows();
    if (DEBUG) console.log(`[jpt] scan: ${listItems.length} rows`);
    if (!listItems.length) {
      // F5 後 Jira 渲染慢、或 filter 套用時 DOM 暫時空 — 排程一次延遲重試
      if (!scanRetryTimer) {
        scanRetryTimer = setTimeout(() => {
          scanRetryTimer = null;
          scheduleScan();
          drawHolidayStrips();
        }, 1500);
      }
      return;
    }

    const idByKey = new Map();
    idToKey.clear();
    for (const item of listItems) {
      const id = extractIssueId(item);
      const key = extractIssueKey(item);
      if (id && key) {
        idByKey.set(key, id);
        idToKey.set(id, key); // 給 hover tooltip 用（從 bar testid 反查 key）
      }
    }

    // 套已快取（type 有 + data fresh 的；type 有但 data 過期也先用舊資料上色，
    // 避免 60 秒過期那一刻 bar 短暫失色，後面 fetch 完會 re-apply）
    for (const [key, id] of idByKey) {
      if (typeCache.has(key)) applyColor(id, key);
    }

    // 排 fetch：type 沒抓過 OR data 過期
    const unknown = [...idByKey.keys()].filter((k) => needsFetch(k) && !pending.has(k));
    if (!unknown.length) return;
    if (DEBUG)
      console.log(
        `[jpt] fetching ${unknown.length} keys (typeMiss=${unknown.filter((k) => !typeCache.has(k)).length}, dataStale=${unknown.filter((k) => typeCache.has(k)).length})`,
      );

    const epoch = generation;
    for (let i = 0; i < unknown.length; i += BATCH_SIZE) {
      if (!isActive() || epoch !== generation) return;
      const batch = unknown.slice(i, i + BATCH_SIZE);
      await fetchTypes(batch);
      if (!isActive() || epoch !== generation) return;
      for (const k of batch) {
        const id = idByKey.get(k);
        if (id) applyColor(id, k);
      }
      if (i + BATCH_SIZE < unknown.length) await JiraApi.sleep(120).catch(() => {});
    }
  };

  // ─── Timeline 頁面偵測 + 啟用/停用切換 ──────────────
  // 只在 timeline 頁啟用 DOM observer 與 scan，省掉其他頁面的渲染損耗。
  // 判定與 floating_toolbar.js 共用同一份（該檔先載入並掛在 window 上），
  // 避免兩處條件不同步造成「toolbar 有出現但染色沒啟用」。
  const isTimelinePage = () => JptTimeline.isTimelinePage(location, document);

  // ─── Hover tooltip：bar 滑入顯示職種 / Milestone relates 任務 ─────
  // 設計：tooltip 永遠在 bar **上方** 顯示（必要時翻到下方），避免遮到 Jira 原生
  //       的左右日期標籤（May 25, 2026 那種會出現在 bar 左右兩側）
  const idToKey = new Map(); // 由 scan() 維護：numeric id → issue key
  let hoverTipEl = null;
  let hoverTipHideTimer = null;
  let lazyFetchTimer = null; // Milestone hover 補抓 peer 起訖日的 debounce timer
  const LAZY_FETCH_DELAY_MS = 400; // 滑鼠停留 > 400ms 才打 API 補抓（避免滑鼠掃過大量 milestone 連續打 API）

  const STATUS_ICON = { done: '✓', indeterminate: '◐', new: '○' };

  const ensureHoverTip = () => {
    if (hoverTipEl) return hoverTipEl;
    hoverTipEl = document.createElement('div');
    hoverTipEl.id = 'jpt-hover-tip';
    hoverTipEl.style.display = 'none';
    hoverTipEl.textContent = '';
    document.body.appendChild(hoverTipEl);
    hoverTipEl.addEventListener('mouseenter', () => clearTimeout(hoverTipHideTimer));
    hoverTipEl.addEventListener('mouseleave', () => {
      hoverTipEl.style.display = 'none';
      hoverTipEl.textContent = '';
    });
    return hoverTipEl;
  };

  const escapeHtml = (s) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  // 'YYYY-MM-DD' → 'M/D'；空值回 '-'
  const fmtMonthDay = (iso) => {
    if (!iso) return '-';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!m) return '-';
    return `${parseInt(m[2], 10)}/${parseInt(m[3], 10)}`;
  };
  // 「起 ~ 訖」字串；任一沒填補 '-'，都沒填顯示 '- ~ -'
  const fmtDateRange = (start, due) => `${fmtMonthDay(start)} ~ ${fmtMonthDay(due)}`;

  const buildTipHtml = (type, data) => {
    if (type === 'planning') {
      if (!data.roles?.length) return null;
      return `<div class="jpt-tip-row"><span class="jpt-tip-label">${escapeHtml(t('tipRoles'))}</span><span class="jpt-tip-roles">${data.roles.map((r) => `<span class="jpt-tip-role-chip">${escapeHtml(r)}</span>`).join('')}</span></div>`;
    }
    if (type === 'milestone') {
      if (!data.relates?.length) return null;
      const relates = sortRelatesList(data.relates);
      const done = relates.filter((r) => r.statusCat === 'done').length;
      const wip = relates.filter((r) => r.statusCat === 'indeterminate').length;
      const total = relates.length;
      return `
        <div class="jpt-tip-header">${escapeHtml(t(wip ? 'tipLinkedHeaderWip' : 'tipLinkedHeader', { done, total, wip }))}</div>
        <div class="jpt-tip-body">
          ${relates
            .map((r) => {
              // 每筆 relates 任務的 start/due 日期，需從 dataCache 查（issuelinks 不會回 peer 的日期）
              // 沒抓過或抓不到 → fmtMonthDay 自動回 '-'
              const peer = dataCache.get(r.key);
              const dateRange = fmtDateRange(peer?.startDate, peer?.dueDate);
              return `
            <div class="jpt-tip-item jpt-tip-${escapeHtml(r.statusCat || 'new')}">
              <span class="jpt-tip-status">${STATUS_ICON[r.statusCat] || '·'}</span>
              ${r.typeIconUrl ? `<img class="jpt-tip-type-icon" src="${escapeHtml(r.typeIconUrl)}" alt="${escapeHtml(r.typeName)}" title="${escapeHtml(r.typeName)}">` : '<span class="jpt-tip-type-icon jpt-tip-type-icon-empty"></span>'}
              <span class="jpt-tip-daterange" title="${escapeHtml(r.key)}">${escapeHtml(dateRange)}</span>
              <span class="jpt-tip-summary">${escapeHtml(r.summary)}</span>
            </div>`;
            })
            .join('')}
        </div>`;
    }
    return null;
  };

  const positionTipAboveBar = (bar) => {
    if (!isActive() || !bar?.isConnected || !hoverTipEl) return;
    const r = bar.getBoundingClientRect();
    const t = hoverTipEl.getBoundingClientRect();
    const GAP = 10;
    let top = r.top - t.height - GAP;
    if (top < 8) top = r.bottom + GAP; // 上方放不下 → 改放下方
    let left = r.left + r.width / 2 - t.width / 2;
    if (left < 8) left = 8;
    if (left + t.width > window.innerWidth - 8) left = window.innerWidth - t.width - 8;
    hoverTipEl.style.left = left + 'px';
    hoverTipEl.style.top = top + 'px';
  };

  // tooltip 顯示期間的目標 bar — 捲動時要跟著 bar 重新定位（不然 tip 留在原地脫節）
  let hoverTipBar = null;
  let tipScrollRaf = 0;
  on(
    document,
    'scroll',
    () => {
      scheduleDrawHolidayStrips();
      if (!hoverTipEl || hoverTipEl.style.display !== 'block' || !hoverTipBar) return;
      if (tipScrollRaf) return;
      tipScrollRaf = requestAnimationFrame(() => {
        tipScrollRaf = 0;
        if (!hoverTipEl || hoverTipEl.style.display !== 'block' || !hoverTipBar) return;
        // bar 被 virtualizer 卸載 → tip 沒東西可跟，直接收
        if (!hoverTipBar.isConnected) {
          hoverTipEl.style.display = 'none';
          hoverTipEl.textContent = '';
          hoverTipBar = null;
          return;
        }
        positionTipAboveBar(hoverTipBar);
      });
    },
    true,
  ); // capture：Jira timeline 的捲動發生在內層 scroller，不冒泡到 document

  const showHoverTip = (bar, key) => {
    if (!isActive()) return;
    const type = typeCache.get(key);
    if (!type) return;
    if (!detailCache.has(key) && !pending.has(key)) {
      clearTimeout(lazyFetchTimer);
      const epoch = generation;
      lazyFetchTimer = setTimeout(async () => {
        await fetchTypes([key]);
        if (epoch === generation && isActive() && bar.isConnected && bar.matches(':hover') && detailCache.has(key))
          showHoverTip(bar, key);
      }, LAZY_FETCH_DELAY_MS);
    }
    const data = getData(key);
    const html = buildTipHtml(type, data);
    if (!html) return;
    const tip = ensureHoverTip();
    clearTimeout(hoverTipHideTimer);
    tip.innerHTML = html;
    tip.dataset.key = key; // 標記是哪個任務的 tip — lazy 補抓完才知道要不要更新
    tip.className = `jpt-hover-tip-${type === 'planning' ? 'pt' : 'ms'}`;
    tip.style.display = 'block';
    hoverTipBar = bar;
    // 等下一個 frame 拿正確尺寸再定位
    requestAnimationFrame(() => positionTipAboveBar(bar));

    // Milestone：補抓尚未在 dataCache 的 relates 任務（issuelinks 不會回 peer 的起訖日，
    // 必須對每個 relates key 個別查）。先 debounce — 滑鼠掃過不打 API，真的停留才打。
    // 完成後若 tip 還在顯示同一個 milestone 才更新 HTML。
    if (detailCache.has(key)) clearTimeout(lazyFetchTimer);
    if (type === 'milestone' && Array.isArray(data.relates) && data.relates.length) {
      const missing = data.relates.map((r) => r.key).filter((k) => k && !dataCache.has(k) && !pending.has(k));
      if (missing.length) {
        const epoch = generation;
        lazyFetchTimer = setTimeout(async () => {
          // 起跑前再 check 一次 — 滑鼠已離開或換 bar 就不打
          if (!hoverTipEl || hoverTipEl.style.display !== 'block' || hoverTipEl.dataset.key !== key) return;
          for (let i = 0; i < missing.length; i += BATCH_SIZE) {
            if (epoch !== generation || !isActive() || !bar.isConnected) return;
            await fetchTypes(missing.slice(i, i + BATCH_SIZE));
          }
          if (
            epoch === generation &&
            isActive() &&
            hoverTipEl &&
            hoverTipEl.style.display === 'block' &&
            hoverTipEl.dataset.key === key
          ) {
            const fresh = getData(key);
            hoverTipEl.innerHTML = buildTipHtml(type, fresh) || hoverTipEl.innerHTML;
            requestAnimationFrame(() => positionTipAboveBar(bar));
          }
        }, LAZY_FETCH_DELAY_MS);
      }
    }
  };

  const hideHoverTip = () => {
    if (!hoverTipEl) return;
    clearTimeout(hoverTipHideTimer);
    clearTimeout(lazyFetchTimer); // 滑鼠離開 → 取消還沒打的 peer 起訖日補抓
    hoverTipHideTimer = setTimeout(() => {
      hoverTipEl.style.display = 'none';
      hoverTipEl.textContent = '';
      hoverTipBar = null;
    }, 150);
  };

  // 砍掉 Milestone 結束日標籤的「(N 天)」時長後綴 — 時間點不需顯示時長
  // 文字部分隱藏 CSS 做不到，用 JS：hover 時等 Jira 渲染完 label 再 mutate text

  // ─── 工作天數標籤（hover / 拖拉時 append 到結束日 label）─────────
  // Jira 的 hover/drag label 文字模板：
  //   靜態：「May 21, 2026 (8 天)」  → 8 天為總天數（含頭含尾）
  //   拖拉：「Jun 22, 2026 (+17 天)」→ 17 天為相對 delta
  //
  // 我們不解析 label 文字日期（語系變動會壞），改用 bar 幾何對應 today-marker 算 day offset：
  //   today-marker.offsetLeft（以及 BCR.left + 半寬）≈ 今天那欄的中央
  //   bar.BCR.left  = 起始日欄中央（Jira 條塊 center-to-center 慣例）
  //   bar.BCR.right = 結束日欄中央
  //   day_offset = round((x - todayCenterX) / pxPerDay)
  // 工作天 = start ~ end 區間內排除週六/日 + 訂閱假日的天數。
  const ymdStr = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const countWorkingDays = (start, end) =>
    JptCalendar.countWorkingDays(ymdStr(start), ymdStr(end), calendarInfo);

  const computeBarDayRange = (bar) => {
    const key = idToKey.get(extractIssueIdFromBar(bar)),
      cached = dataCache.get(key);
    const toRange = (start, end) => {
      if (JptCalendar.parseDate(start) === null || JptCalendar.parseDate(end) === null || start > end) return null;
      const local = (iso) => {
        const [y, m, d] = iso.split('-').map(Number);
        return new Date(y, m - 1, d);
      };
      return { start: local(start), end: local(end) };
    };
    // Saved dates are authoritative while hovering, regardless of zoom or label format.
    if (!wdDragLocked && cached?.startDate && cached?.dueDate) return toRange(cached.startDate, cached.dueDate);
    // Rolled-up ranges (e.g. an Epic without its own dates) show both dates in one label: "A - B (75 days)".
    const labels = JptDates.parseLabelDates(
      [...bar.querySelectorAll('small,time')]
        .filter((el) => el.getBoundingClientRect().width > 0)
        .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
        .map((el) => el.textContent),
    );
    if (labels.length >= 2) return toRange(labels[0], labels[labels.length - 1]);
    if (!wdDragLocked) return null;
    // During a drag, translate the original saved boundaries with a calendar scale.
    // Never derive an absolute duration from the rounded width of a bar.
    if (!dragStart?.rect || !dragStart.startDate || !dragStart.dueDate) return null;
    const rect = bar.getBoundingClientRect(),
      dx = rect.left - dragStart.rect.left,
      dr = rect.right - dragStart.rect.right;
    if (Math.abs(dx) < 0.5 && Math.abs(dr) < 0.5) return toRange(dragStart.startDate, dragStart.dueDate);
    const scale = calendarScale();
    if (!scale) return null;
    const endExclusive = new Date(Date.parse(dragStart.dueDate + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
    const startX = scale.dateToX(dragStart.startDate),
      endX = scale.dateToX(endExclusive);
    if (startX == null || endX == null) return null;
    const start = scale.xToDate(startX + dx),
      end = scale.xToDate(endX + dr);
    if (!start || !end) return null;
    return toRange(start, new Date(Date.parse(end + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10));
  };

  // 浮動 overlay：不碰 Jira `<small>` 的 textContent（會撞 React reconciler 拋
  // 「DOM 與 vDOM 不一致」例外讓整個 timeline 掛掉）。改用 body-level <span>
  // 靠 BCR 貼在 bar 結束日標籤右邊 — 純視覺，不污染 Jira DOM。
  const WD_DURATION_RE = JptDates.DURATION_LABEL;
  let wdOverlayEl = null;
  let wdRafId = null;
  let wdActiveBar = null;

  const ensureWdOverlay = () => {
    if (wdOverlayEl && document.body.contains(wdOverlayEl)) return wdOverlayEl;
    wdOverlayEl = document.createElement('span');
    wdOverlayEl.id = 'jpt-wd-overlay';
    wdOverlayEl.style.display = 'none';
    document.body.appendChild(wdOverlayEl);
    return wdOverlayEl;
  };

  // 找 bar 內最右邊那個有「(N 天) / (+N 天)」字樣的 <small>（結束日標籤）
  const findEndDateLabel = (bar) => {
    const smalls = bar.querySelectorAll('small');
    let best = null,
      bestRight = -Infinity;
    for (const s of smalls) {
      if (!WD_DURATION_RE.test(s.textContent || '')) continue;
      const r = s.getBoundingClientRect();
      if (!r.width) continue;
      if (r.right > bestRight) {
        bestRight = r.right;
        best = s;
      }
    }
    return best;
  };

  const updateWdOverlay = () => {
    wdRafId = null;
    const bar = wdActiveBar;
    if (!bar || !document.body.contains(bar)) {
      hideWdOverlay();
      return;
    }
    if (!isActive() || !settings.showWorkingDays) {
      hideWdOverlay();
      return;
    }
    const small = findEndDateLabel(bar);
    const range = computeBarDayRange(bar);
    if (!range) {
      hideWdOverlay();
      return;
    }
    const wd = countWorkingDays(range.start, range.end);
    const overlay = ensureWdOverlay();
    if (!wd || !wd.complete) {
      hideWdOverlay();
      return;
    }
    const text = t('workingDays', { days: wd.days });
    if (overlay.textContent !== text) overlay.textContent = text;
    const sr = (small || bar).getBoundingClientRect();
    overlay.style.display = '';
    // 對齊原 label 垂直中心（CSS 配 transform: translateY(-50%) 用）
    overlay.style.top = `${sr.top + sr.height / 2}px`;
    // 貼在原 label 右邊；用 BCR 即時貼齊（拖拉時也能跟）
    overlay.style.left = `${Math.max(4, Math.min(sr.right + 4, window.innerWidth - overlay.offsetWidth - 8))}px`;
  };

  const hideWdOverlay = () => {
    if (wdOverlayEl) wdOverlayEl.style.display = 'none';
  };

  // 拖拉時 Jira 持續 re-render label，用 rAF loop 持續更新 overlay 位置與工作天數
  const startWdLoop = (bar) => {
    if (!settings.showWorkingDays) return;
    if (bar.classList.contains(DIA_CLASS)) return; // 菱形是時間點，沒區間意義
    wdActiveBar = bar;
    if (wdRafId) cancelAnimationFrame(wdRafId);
    const tick = () => {
      if (!isActive() || wdActiveBar !== bar) return; // 換 bar 或停了
      updateWdOverlay();
      wdRafId = requestAnimationFrame(tick);
    };
    wdRafId = requestAnimationFrame(tick);
  };

  const stopWdLoop = () => {
    wdActiveBar = null;
    if (wdRafId) {
      cancelAnimationFrame(wdRafId);
      wdRafId = null;
    }
    hideWdOverlay();
  };

  on(
    document,
    'mouseover',
    (e) => {
      if (!isActive()) return;
      const bar = e.target.closest?.(SEL_BAR_CONTAINER);
      if (!bar) return;
      const id = extractIssueIdFromBar(bar);
      if (!id) return;
      const key = idToKey.get(id);
      if (!key) return;
      showHoverTip(bar, key);
      // Milestone 菱形 → 砍掉「(N 天)」後綴。等下個 frame 讓 Jira 先渲染 label
      // 工作天數 — 啟動 overlay rAF loop（持續貼在結束日 label 右邊，跟拖拉更新）
      // 拖拉中滑過別的 bar 時不切換 wdActiveBar，避免 overlay 跑去別條
      if (settings.showWorkingDays && !bar.classList.contains('jpt-ms-diamond') && !wdDragLocked) {
        startWdLoop(bar);
      }
    },
    true,
  );

  // ─── 偵測「使用者拖完 bar 改日期」→ 主動失效該 issue 的 cache，下次 scan 重抓 ─
  // bar 拖拉時：mousedown on bar → mousemove → mouseup（座標可能變了）
  // 這邊不嚴謹判斷成功與否，只要 mouseup 跟 mousedown 距離 > 4px 就視為可能改了日期
  let dragStart = null;
  let wdDragLocked = false; // 拖拉中：mouseout 不收 overlay（cursor 常離開 bar 範圍）
  on(
    document,
    'mousedown',
    (e) => {
      if (e.button !== 0) return; // 只攔左鍵 — 右鍵選單 / 中鍵不該被鎖定邏輯吞掉
      const bar = e.target.closest?.('[data-testid*="draggable-bar-"][data-testid$="-container"]');
      if (!bar) {
        dragStart = null;
        return;
      }
      const id = extractIssueIdFromBar(bar);
      if (!id) return;
      const key = idToKey.get(id),
        cached = dataCache.get(key);
      dragStart = {
        x: e.clientX,
        y: e.clientY,
        id,
        key,
        rect: bar.getBoundingClientRect(),
        startDate: cached?.startDate,
        dueDate: cached?.dueDate,
      };
      // 鎖住 wd overlay：這段期間 cursor 可能滑出 bar（resize / 整段拖），都要保留 overlay
      wdDragLocked = true;
      startWdLoop(bar);
    },
    true,
  );
  // 防 mouseup 落在視窗外造成 wdDragLocked 永遠卡 true（之後 hover 全失效）
  // window.blur / pagehide 都重置；正常拖拉內 mouseup 也會清乾淨
  on(window, 'blur', () => {
    if (wdDragLocked) {
      wdDragLocked = false;
      stopWdLoop();
    }
  });

  on(
    document,
    'mouseup',
    (e) => {
      const wasDragging = wdDragLocked;
      wdDragLocked = false;
      // 拖完若 cursor 已不在原 bar 上 → 收 overlay；還在的話留著等下次 mouseout
      if (wasDragging && wdActiveBar) {
        const onBar = e.target?.closest?.('[data-testid*="draggable-bar-"][data-testid$="-container"]') === wdActiveBar;
        if (!onBar) stopWdLoop();
      }
      if (!dragStart) return;
      const moved = Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y);
      const { key } = dragStart;
      dragStart = null;
      if (moved < 4 || !key) return;
      // 拖過 → 失效該 issue 的 dataCache，等下次 scan 重抓拿到新日期
      dataCache.delete(key);
      detailCache.delete(key);
      if (DEBUG) console.log('[jpt] invalidated cache after drag:', key);
      // 給 Jira 一點時間把 PUT request 送出去 + 回來
      setTimeout(() => scheduleScan(), 1500);
    },
    true,
  );

  on(
    document,
    'mouseout',
    (e) => {
      const bar = e.target.closest?.('[data-testid*="draggable-bar-"][data-testid$="-container"]');
      if (!bar) return;
      // 拖拉中不收 working-day overlay（cursor 常滑出 bar；mouseup 才決定收/留）
      // 滑出 bar（且沒進到我們自己的 hover tooltip）→ 停 working-day overlay
      if (!wdDragLocked && (!e.relatedTarget || !bar.contains(e.relatedTarget))) stopWdLoop();
      // 從 bar 滑進 tooltip 時不收：tooltip 自己 enter handler 會接手
      if (hoverTipEl && e.relatedTarget && hoverTipEl.contains(e.relatedTarget)) return;
      hideHoverTip();
    },
    true,
  );

  let domObserver = null,
    observedRoot = null;
  // 對「新加入」的 list-item 立即從 cache 套色（不等 300ms scheduleScan debounce）。
  // 捲動時 Jira virtualizer 不停加/刪 list-item，新進場的 bar 若等 debounce 才上色，
  // 中間會短暫露出 Jira 預設樣式 → A 類閃爍主因之一。
  // Jira virtualizer 對 list-item（左欄）跟 bar（右欄 chart-item）的 DOM 進出
  // 不一定同 batch — Epic 預設色比較顯眼，bar 進場若沒立刻套色就會閃實心。
  // 兩條路徑都攔：list-item 進場 → 從 list-item 解 id/key；bar 進場 → 經 idToKey 反查。
  const applyCachedColorToAddedItems = (mutations) => {
    if (!isActive()) return;
    if (!mutations) return; // startActive 首次手動呼叫沒帶參數 → 走全頁 scan 即可
    // 新版每個 issue 是同一張 table 裡的 <tr>，MutationObserver 觀察整個
    // document.body，用「屬於同一張 timeline table」限定，避免誤吃頁面上
    // 其他不相關的 <tr>（例如彈出視窗裡剛好也有表格）。
    const table = getTimelineTable();
    if (!table) return;
    const isOurRow = (n) => n.tagName === 'TR' && n.closest('table') === table;
    const addedItems = new Set();
    const addedBars = new Set();
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (isOurRow(node)) addedItems.add(node);
        node.querySelectorAll?.('tr').forEach((n) => {
          if (isOurRow(n)) addedItems.add(n);
        });
        if (node.matches?.(SEL_BAR_CONTAINER)) addedBars.add(node);
        node.querySelectorAll?.(SEL_BAR_CONTAINER).forEach((b) => addedBars.add(b));
      }
    }
    for (const item of addedItems) {
      const id = extractIssueId(item);
      const key = extractIssueKey(item);
      if (id && key && typeCache.has(key)) applyColor(id, key);
    }
    for (const bar of addedBars) {
      const id = extractIssueIdFromBar(bar);
      if (!id) continue;
      const key = idToKey.get(id); // 之前 scan 過就有；首次見的 issue 等 fetch 完才上色
      if (key && typeCache.has(key)) applyColor(id, key);
    }
  };
  // drawHolidayStrips 內含 getBoundingClientRect（強制 reflow），不能每個 mutation
  // batch 都直接跑 — 捲動/拖曳期間 Jira virtualizer 高頻觸發，會變效能熱點
  let stripTimer = null;
  const scheduleDrawHolidayStrips = () => {
    if (!isActive()) return;
    if (stripTimer) return;
    stripTimer = setTimeout(() => {
      stripTimer = null;
      drawHolidayStrips();
    }, 200);
  };
  const onMutation = (mutations) => {
    if (
      mutations?.length &&
      mutations.every((m) => m.target.closest?.('.jpt-calendar-layer,#jpt-wd-overlay,#jpt-toolbar'))
    )
      return;
    applyCachedColorToAddedItems(mutations);
    scheduleScan();
    scheduleDrawHolidayStrips();
  };
  const startActive = () => {
    if (active || disposed || !profile || document.visibilityState === 'hidden') return;
    active = true;
    generation++;
    requests = new AbortController();
    document.body?.classList.add('jpt-active');
    applyThemeClass();
    applyCssVars();
    onMutation();
    domObserver = new MutationObserver(onMutation);
    observedRoot = getTimelineTable()?.parentElement || document.body;
    domObserver.observe(observedRoot, { childList: true, subtree: true, characterData: true });
  };
  const stopActive = ({ keepAppearance = false } = {}) => {
    active = false;
    generation++;
    requests.abort();
    document.body?.classList.remove('jpt-active', 'jpt-ms-lock-edges', 'jpt-pt-native', 'jpt-ms-native');
    if (!keepAppearance) document.body?.classList.remove('jpt-hide-current-month', 'jpt-hide-issue-key');
    domObserver?.disconnect();
    domObserver = null;
    observedRoot = null;
    clearTimeout(scanTimer);
    scanTimer = null;
    clearTimeout(scanRetryTimer);
    scanRetryTimer = null;
    clearTimeout(stripTimer);
    stripTimer = null;
    clearTimeout(lazyFetchTimer);
    lazyFetchTimer = null;
    clearTimeout(hoverTipHideTimer);
    cancelAnimationFrame(tipScrollRaf);
    tipScrollRaf = 0;
    document.querySelectorAll(ALL_CLASSES.map((c) => '.' + c).join(',')).forEach((el) => {
      el.classList.remove(...ALL_CLASSES);
      el.style.removeProperty('--jpt-target-end-ratio');
    });
    document.querySelectorAll('.' + PROGRESS_CLASS).forEach((el) => el.remove());
    document
      .querySelectorAll('.' + CURRENT_PERIOD_HIDE_CLASS)
      .forEach((el) => el.classList.remove(CURRENT_PERIOD_HIDE_CLASS));
    hoverTipEl?.remove();
    hoverTipEl = null;
    hoverTipBar = null;
    stopWdLoop();
    wdOverlayEl?.remove();
    wdOverlayEl = null;
    clearHolidayStrips();
    typeCache.clear();
    dataCache.clear();
    detailCache.clear();
    pending.clear();
    idToKey.clear();
    dragStart = null;
    wdDragLocked = false;
    document.documentElement.style.removeProperty('--jpt-pt-color');
    document.documentElement.style.removeProperty('--jpt-ms-color');
  };
  const updateActivation = () => {
    if (settings.enabled && profile && isTimelinePage()) startActive();
    else stopActive();
  };

  // ─── Light / Dark 主題偵測 ─────────────────────────
  // Jira 把使用者選的主題寫到 <html data-color-mode="light|dark|auto">
  // （Atlassian Design System 機制，see developer.atlassian.com/.../design-tokens-and-theming/）
  // 我們把結果 mirror 到 body.jpt-theme-light / .jpt-theme-dark，讓 CSS override 用
  // 大多數 surface 已經改用 --ds-* tokens 自動切，這個 class 主要給半透明強調色 override 用
  const applyThemeClass = () => {
    const mode = document.documentElement.getAttribute('data-color-mode') || 'auto';
    const resolved =
      mode === 'auto' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : mode;
    // Theme classes only matter where the extension draws; other Jira pages stay untouched.
    const timeline = isTimelinePage();
    document.body.classList.toggle('jpt-theme-light', timeline && resolved === 'light');
    document.body.classList.toggle('jpt-theme-dark', timeline && resolved !== 'light');
  };

  let routeTimer = null,
    purgeTimer = null,
    themeObserver = null,
    unsubscribe = null;
  const dispose = () => {
    if (disposed) return;
    stopActive();
    disposed = true;
    activationEpoch++;
    session.clear();
    lifetime.abort();
    clearInterval(routeTimer);
    clearInterval(purgeTimer);
    clearTimeout(reloadTimer);
    themeObserver?.disconnect();
    unsubscribe?.();
    try {
      chrome.runtime.onMessage.removeListener(onMessage);
    } catch {}
  };
  const onMessage = (message, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === 'jpt:context') {
      // The popup combines the project defaults with the preferences it just saved itself, so it never
      // shows a page that has not finished applying a change.
      reply({
        projectId: status.projectId,
        source: status.source || null,
        sourceLabel: status.sourceLabel || '',
        sourceUpdatedAt: status.sourceUpdatedAt || '',
        years: status.years || [],
        profileSettings: status.source === 'property' ? session.effective({ preferences: {} }).profile?.settings || null : null,
      });
      return;
    }
    if (message.type === 'jpt:status') {
      if (message.recheck) {
        void loadSettings().then(() => reply({ ...status }));
        return true;
      }
      reply({ ...status });
      return;
    }
    if (message.type === 'jpt:refresh') {
      stopActive();
      session.clear();
      reply({ ok: true });
      requestSettingsReload();
      return;
    }
  };
  const init = async () => {
    chrome.runtime.onMessage.addListener(onMessage);
    applyThemeClass();
    themeObserver = new MutationObserver(applyThemeClass);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-color-mode'] });
    on(window.matchMedia('(prefers-color-scheme: dark)'), 'change', applyThemeClass);
    on(window, 'resize', () => scheduleDrawHolidayStrips());
    unsubscribe = JptClient.subscribe(async () => {
      const read = ++settingsReadVersion,
        epoch = activationEpoch;
      try {
        const raw = await JptClient.getContext({ origin: location.origin, projectId: status.projectId });
        if (disposed || read !== settingsReadVersion || epoch !== activationEpoch) return;
        // 專案屬性的設定仍然有效，只重新套用個人偏好
        const context = session.effective(raw);
        const signature = JSON.stringify({ profile: context.profile, settings: context.settings });
        if (signature === inputSignature) return;
        const previous = inputSignature ? JSON.parse(inputSignature) : null;
        const displayKeys = new Set([
          'ptColor',
          'msColor',
          'ptColorEnabled',
          'msColorEnabled',
          'msDiamond',
          'hideCurrentMonth',
          'hideIssueKey',
          'showWeekends',
          'showHolidays',
        ]);
        const displayOnly =
          previous &&
          Object.keys(context.settings).every(
            (key) => context.settings[key] === previous.settings[key] || displayKeys.has(key),
          );
        // Display-only preferences neither invalidate issue data nor remove active CSS classes.
        if (
          isActive() &&
          context.settings.enabled !== false &&
          displayOnly &&
          JSON.stringify(context.profile) === JSON.stringify(previous.profile) &&
          JSON.stringify(JptRules.requiredFields(profile, context.settings).sort()) ===
            JSON.stringify(JptRules.requiredFields(profile, settings).sort())
        ) {
          settings = { ...settings, ...context.settings };
          inputSignature = signature;
          applyCssVars();
          onMutation();
        } else requestSettingsReload();
      } catch {
        requestSettingsReload();
      }
    });
    on(window, 'pagehide', (event) => {
      if (event.persisted) {
        activationEpoch++;
        session.clear();
        stopActive();
      } else dispose();
    });
    on(window, 'pageshow', (event) => {
      if (event.persisted) requestSettingsReload();
    });
    on(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        clearTimeout(reloadTimer);
        reloadTimer = null;
        activationEpoch++;
        session.clear();
        stopActive({ keepAppearance: settings.enabled && isTimelinePage() });
      } else requestSettingsReload();
    });
    let lastUrl = location.href;
    const scopeKey = () =>
      location.origin + location.pathname + '|' + JptTimeline.getProjectKey(location) + '|' + isTimelinePage();
    let lastScope = scopeKey();
    routeTimer = setInterval(() => {
      try {
        if (!chrome.runtime?.id) {
          dispose();
          return;
        }
      } catch {
        dispose();
        return;
      }
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        applyThemeClass();
        const nextScope = scopeKey();
        if (nextScope === lastScope) {
          onMutation();
        } else {
          lastScope = nextScope;
          activationEpoch++;
          session.clear();
          stopActive();
          requestSettingsReload();
        }
      } else if (isActive() && observedRoot !== (getTimelineTable()?.parentElement || document.body)) {
        domObserver?.disconnect();
        observedRoot = getTimelineTable()?.parentElement || document.body;
        domObserver?.observe(observedRoot, { childList: true, subtree: true, characterData: true });
        onMutation();
      } else if (isActive() && getTimelineTable() && !document.body.classList.contains('jpt-active'))
        updateActivation();
    }, 750);
    purgeTimer = setInterval(() => {
      typeCache.purge();
      dataCache.purge();
      detailCache.purge();
      if (hoverTipBar && !detailCache.has(idToKey.get(extractIssueIdFromBar(hoverTipBar)))) hideHoverTip();
    }, 30000);
    await loadSettings();
  };

  void init().catch(() => dispose());
})();
