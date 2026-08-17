import { renderJsonTree, copyToClipboard, applySearch } from './json-tree.js';
import { diffValues, renderDiffTree } from './diff.js';

const state = {
  sessionId: null,
  logs: [], // chronological, oldest first — as received from the server
  consoleLogs: [], // chronological, oldest first — console.log/warn/error/etc. calls
  primaryView: 'network', // 'network' | 'logs'
  sidebarMode: 'all', // 'all' | 'endpoints'
  search: '',
  expandedGroups: new Set(),
  selected: null, // { kind: 'request', id } | { kind: 'compare', groupKey, baseId, compareId, mode }
  logsSearch: '',
  selectedLogId: null,
};

const el = {
  sessionBadge: document.getElementById('session-badge'),
  connStatus: document.getElementById('conn-status'),
  connStatusLabel: document.getElementById('conn-status-label'),
  clearBtn: document.getElementById('clear-btn'),
  searchInput: document.getElementById('search-input'),
  requestList: document.getElementById('request-list'),
  endpointList: document.getElementById('endpoint-list'),
  detailPanel: document.getElementById('detail-panel'),
  emptyState: document.getElementById('empty-state'),
  toast: document.getElementById('toast'),
  sidebarTabs: document.querySelectorAll('.sidebar-tabs .tab'),
  primaryNav: document.getElementById('primary-nav'),
  viewNetwork: document.getElementById('view-network'),
  viewLogs: document.getElementById('view-logs'),
  logsSearchInput: document.getElementById('logs-search-input'),
  logsList: document.getElementById('logs-list'),
  logsDetailPanel: document.getElementById('logs-detail-panel'),
  logsEmptyState: document.getElementById('logs-empty-state'),
};

// ---------------------------------------------------------------- helpers

function methodClass(method) {
  const m = (method || 'GET').toUpperCase();
  return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(m) ? `method-${m}` : 'method-OTHER';
}

function statusInfo(log) {
  if (log.error || !log.status) return { cls: 'status-error', label: log.error ? 'ERR' : String(log.status || 0) };
  const s = log.status;
  if (s >= 200 && s < 300) return { cls: 'status-2xx', label: String(s) };
  if (s >= 300 && s < 400) return { cls: 'status-3xx', label: String(s) };
  if (s >= 400 && s < 500) return { cls: 'status-4xx', label: String(s) };
  if (s >= 500) return { cls: 'status-5xx', label: String(s) };
  return { cls: 'status-pending', label: String(s) };
}

function formatTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function groupKeyOf(log) {
  return `${(log.method || 'GET').toUpperCase()} ${log.url || ''}`;
}

/**
 * Long API URLs (API gateway hosts, versioned paths, etc.) are unreadable
 * once truncated by width in a narrow sidebar row — the host and version
 * prefix survive, the part that actually identifies the endpoint doesn't.
 * Show just the last `segmentCount` path segments instead; the full URL is
 * still available via the row's title tooltip and the detail panel.
 */
function shortenUrl(rawUrl, segmentCount = 2) {
  if (!rawUrl) return '';
  let pathname;
  try {
    pathname = new URL(rawUrl).pathname;
  } catch (e) {
    pathname = rawUrl.split('?')[0];
  }
  const parts = pathname.split('/').filter(Boolean);
  if (!parts.length) return rawUrl;
  return parts.slice(-segmentCount).join('/');
}

function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.add('visible');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.toast.classList.remove('visible'), 1400);
}

function matchesSearch(log) {
  if (!state.search) return true;
  return (log.url || '').toLowerCase().includes(state.search.toLowerCase());
}

// ------------------------------------------------------------------ token

/**
 * The session token arrives in the URL fragment, which browsers never send
 * to a server — so it stays out of access logs and Referer headers. It's
 * stashed in memory and stripped from the address bar so it isn't left
 * sitting in history or shared by copying the URL after load.
 */
const sessionToken = (function readToken() {
  const fromHash = new URLSearchParams(location.hash.replace(/^#/, '')).get('token');
  if (fromHash) {
    history.replaceState(null, '', location.pathname + location.search);
    return fromHash;
  }
  return null;
})();

function showTokenError() {
  el.connStatus.classList.remove('connected');
  el.connStatus.classList.add('disconnected');
  el.connStatusLabel.textContent = 'unauthorized — reopen the URL from your terminal';
}

// -------------------------------------------------------------- websocket

function connectWS() {
  if (!sessionToken) {
    showTokenError();
    return;
  }

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(
    `${proto}//${location.host}/ws/dashboard?token=${encodeURIComponent(sessionToken)}`
  );

  ws.onopen = () => {
    el.connStatus.classList.add('connected');
    el.connStatus.classList.remove('disconnected');
    el.connStatusLabel.textContent = 'connected';
  };

  ws.onclose = () => {
    el.connStatus.classList.remove('connected');
    el.connStatus.classList.add('disconnected');
    el.connStatusLabel.textContent = 'reconnecting…';
    setTimeout(connectWS, 1500);
  };

  ws.onerror = () => {
    // onclose follows
  };

  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (e) {
      return;
    }
    if (msg.type === 'init') {
      state.sessionId = msg.payload.sessionId;
      state.logs = msg.payload.logs || [];
      state.consoleLogs = msg.payload.consoleLogs || [];
      el.sessionBadge.textContent = `session ${state.sessionId}`;
      renderSidebar();
      renderDetail();
      renderLogsList();
      renderLogsDetail();
    } else if (msg.type === 'log') {
      state.logs.push(msg.payload);
      renderSidebar();
    } else if (msg.type === 'console') {
      state.consoleLogs.push(msg.payload);
      renderLogsList();
    } else if (msg.type === 'clear') {
      state.logs = [];
      state.consoleLogs = [];
      state.selected = null;
      state.selectedLogId = null;
      renderSidebar();
      renderDetail();
      renderLogsList();
      renderLogsDetail();
    }
  };

  window.__synccalmSocket = ws;
}

// -------------------------------------------------------------- sidebar

function renderSidebar() {
  if (state.sidebarMode === 'all') {
    el.requestList.style.display = '';
    el.endpointList.style.display = 'none';
    renderRequestList();
  } else {
    el.requestList.style.display = 'none';
    el.endpointList.style.display = '';
    renderEndpointList();
  }
}

function renderRequestList() {
  el.requestList.innerHTML = '';
  const items = state.logs.filter(matchesSearch).slice().reverse(); // newest first

  if (!items.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:16px;color:var(--text-faint);font-size:12px;';
    empty.textContent = state.logs.length ? 'No requests match your filter.' : 'No requests captured yet.';
    el.requestList.appendChild(empty);
    return;
  }

  items.forEach((log) => {
    el.requestList.appendChild(buildRequestRow(log));
  });
}

function buildRequestRow(log) {
  const row = document.createElement('div');
  row.className = 'request-item';
  if (state.selected && state.selected.kind === 'request' && state.selected.id === log.id) {
    row.classList.add('selected');
  }

  const method = document.createElement('span');
  method.className = `method-badge ${methodClass(log.method)}`;
  method.textContent = log.method || 'GET';
  row.appendChild(method);

  const main = document.createElement('div');
  main.className = 'request-item-main';

  const url = document.createElement('div');
  url.className = 'request-url mono';
  url.textContent = shortenUrl(log.url);
  url.title = log.url || '';
  main.appendChild(url);

  const meta = document.createElement('div');
  meta.className = 'request-meta';

  const { cls, label } = statusInfo(log);
  const statusPill = document.createElement('span');
  statusPill.className = `status-pill ${cls}`;
  statusPill.textContent = label;
  meta.appendChild(statusPill);

  const time = document.createElement('span');
  time.textContent = formatTime(log.startTime || log.receivedAt);
  meta.appendChild(time);

  if (typeof log.duration === 'number') {
    const dur = document.createElement('span');
    dur.textContent = `${log.duration}ms`;
    meta.appendChild(dur);
  }

  main.appendChild(meta);
  row.appendChild(main);

  row.addEventListener('click', () => {
    state.selected = { kind: 'request', id: log.id };
    renderSidebar();
    renderDetail();
  });

  return row;
}

function renderEndpointList() {
  el.endpointList.innerHTML = '';

  const groups = new Map();
  state.logs.filter(matchesSearch).forEach((log) => {
    const key = groupKeyOf(log);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(log);
  });

  // sort groups by their most recent hit, newest first
  const sortedKeys = Array.from(groups.keys()).sort((ka, kb) => {
    const la = groups.get(ka)[groups.get(ka).length - 1];
    const lb = groups.get(kb)[groups.get(kb).length - 1];
    return (lb.startTime || lb.receivedAt) - (la.startTime || la.receivedAt);
  });

  if (!sortedKeys.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:16px;color:var(--text-faint);font-size:12px;';
    empty.textContent = 'No requests captured yet.';
    el.endpointList.appendChild(empty);
    return;
  }

  sortedKeys.forEach((key) => {
    const versions = groups.get(key); // chronological, oldest first (v1..vN)
    el.endpointList.appendChild(buildEndpointGroup(key, versions));
  });
}

function buildEndpointGroup(key, versions) {
  const wrap = document.createElement('div');
  wrap.className = 'endpoint-group';

  const latest = versions[versions.length - 1];
  const expanded = state.expandedGroups.has(key);

  const header = document.createElement('div');
  header.className = 'endpoint-group-header';

  const method = document.createElement('span');
  method.className = `method-badge ${methodClass(latest.method)}`;
  method.textContent = latest.method || 'GET';
  header.appendChild(method);

  const urlEl = document.createElement('div');
  urlEl.className = 'endpoint-group-url mono';
  urlEl.textContent = shortenUrl(latest.url);
  urlEl.title = latest.url || '';
  header.appendChild(urlEl);

  const count = document.createElement('span');
  count.className = 'endpoint-group-count';
  count.textContent = versions.length > 1 ? `${versions.length} versions` : '1 call';
  header.appendChild(count);

  const toggle = document.createElement('span');
  toggle.className = 'tree-toggle';
  toggle.textContent = expanded ? '▾' : '▸';
  header.appendChild(toggle);

  header.addEventListener('click', () => {
    if (expanded) state.expandedGroups.delete(key);
    else state.expandedGroups.add(key);
    renderSidebar();
  });

  wrap.appendChild(header);

  if (expanded) {
    const list = document.createElement('div');
    list.className = 'endpoint-versions';

    versions
      .slice()
      .reverse() // newest first
      .forEach((log, idx) => {
        const versionIndex = versions.length - idx; // v-label by chronological order
        const row = buildRequestRow(log);
        const badge = document.createElement('span');
        badge.className = 'version-badge';
        badge.textContent = `v${versionIndex}`;
        row.insertBefore(badge, row.firstChild);
        list.appendChild(row);
      });

    if (versions.length > 1) {
      const compareBtn = document.createElement('button');
      compareBtn.className = 'btn btn-ghost';
      compareBtn.style.margin = '6px 10px 10px';
      compareBtn.textContent = '⇄ Compare versions';
      compareBtn.addEventListener('click', () => {
        const sorted = versions.slice().sort((a, b) => (a.startTime || a.receivedAt) - (b.startTime || b.receivedAt));
        const compare = sorted[sorted.length - 1];
        const base = sorted[sorted.length - 2];
        state.selected = { kind: 'compare', groupKey: key, baseId: base.id, compareId: compare.id, mode: 'inline' };
        renderDetail();
      });
      list.appendChild(compareBtn);
    }

    wrap.appendChild(list);
  }

  return wrap;
}

// --------------------------------------------------------------- detail

function renderDetail() {
  el.detailPanel.innerHTML = '';

  if (!state.selected) {
    el.detailPanel.appendChild(el.emptyState);
    return;
  }

  if (state.selected.kind === 'request') {
    const log = state.logs.find((l) => l.id === state.selected.id);
    if (!log) {
      state.selected = null;
      renderDetail();
      return;
    }
    el.detailPanel.appendChild(buildRequestDetail(log));
    return;
  }

  if (state.selected.kind === 'compare') {
    el.detailPanel.appendChild(buildCompareDetail(state.selected));
  }
}

function buildHeadersTable(headers) {
  const table = document.createElement('table');
  table.className = 'headers-table';
  const entries = Object.entries(headers || {});
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'mono';
    empty.style.color = 'var(--text-faint)';
    empty.textContent = '(none)';
    return empty;
  }
  entries.forEach(([k, v]) => {
    const tr = document.createElement('tr');
    const tdK = document.createElement('td');
    tdK.textContent = k;
    const tdV = document.createElement('td');
    tdV.textContent = v;
    tr.appendChild(tdK);
    tr.appendChild(tdV);
    table.appendChild(tr);
  });
  return table;
}

/**
 * A small "search within this JSON tree" control: text input, match count,
 * and prev/next navigation. Matches are highlighted in place (via
 * json-tree.js's applySearch) and their collapsed ancestors auto-expand
 * so every hit stays visible.
 *
 * Built once per detail panel (it lives in the tabs row, not per-tab), and
 * retargeted at whichever tree is currently visible via `setTarget()` —
 * see buildRequestDetail's selectTab().
 */
function buildBodySearchBar() {
  const wrap = document.createElement('div');
  wrap.className = 'body-search';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Search body…';

  const count = document.createElement('span');
  count.className = 'body-search-count';

  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.title = 'Previous match';
  prevBtn.textContent = '↑';

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.title = 'Next match';
  nextBtn.textContent = '↓';

  wrap.appendChild(input);
  wrap.appendChild(count);
  wrap.appendChild(prevBtn);
  wrap.appendChild(nextBtn);

  let treeEl = null;
  let matches = [];
  let current = -1;

  function goTo(index) {
    if (!matches.length) return;
    if (matches[current]) matches[current].classList.remove('current-match');
    current = ((index % matches.length) + matches.length) % matches.length;
    const mark = matches[current];
    mark.classList.add('current-match');
    mark.scrollIntoView({ block: 'center' });
    count.textContent = `${current + 1}/${matches.length}`;
  }

  function runSearch() {
    if (!treeEl) return;
    const query = input.value.trim();
    applySearch(treeEl, query);
    matches = Array.from(treeEl.querySelectorAll('mark.json-match'));
    current = -1;
    if (!query) count.textContent = '';
    else if (!matches.length) count.textContent = '0/0';
    else goTo(0);
  }

  input.addEventListener('input', runSearch);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    goTo(current + (e.shiftKey ? -1 : 1));
  });
  prevBtn.addEventListener('click', () => goTo(current - 1));
  nextBtn.addEventListener('click', () => goTo(current + 1));

  return {
    el: wrap,
    setTarget(newTreeEl) {
      treeEl = newTreeEl;
      input.value = '';
      count.textContent = '';
      matches = [];
      current = -1;
    },
  };
}

function buildRequestDetail(log) {
  const root = document.createElement('div');
  root.className = 'detail-root';

  const header = document.createElement('div');
  header.className = 'detail-header';

  const top = document.createElement('div');
  top.className = 'detail-header-top';
  const method = document.createElement('span');
  method.className = `method-badge ${methodClass(log.method)}`;
  method.textContent = log.method || 'GET';
  top.appendChild(method);
  const { cls, label } = statusInfo(log);
  const pill = document.createElement('span');
  pill.className = `status-pill ${cls}`;
  pill.textContent = label;
  top.appendChild(pill);
  header.appendChild(top);

  const url = document.createElement('div');
  url.className = 'detail-url';
  url.style.marginTop = '6px';
  url.textContent = log.url || '';
  header.appendChild(url);

  const sub = document.createElement('div');
  sub.className = 'detail-sub';
  sub.innerHTML = '';
  const time = document.createElement('span');
  time.textContent = `⏱ ${formatTime(log.startTime || log.receivedAt)}`;
  const dur = document.createElement('span');
  dur.textContent = `${typeof log.duration === 'number' ? log.duration : '—'} ms`;
  sub.appendChild(time);
  sub.appendChild(dur);
  header.appendChild(sub);

  root.appendChild(header);

  const tabs = document.createElement('div');
  tabs.className = 'detail-tabs';

  const tabsLeft = document.createElement('div');
  tabsLeft.className = 'detail-tabs-left';
  const tabRequest = document.createElement('button');
  tabRequest.textContent = 'Request';
  const tabResponse = document.createElement('button');
  tabResponse.textContent = 'Response';
  tabsLeft.appendChild(tabRequest);
  tabsLeft.appendChild(tabResponse);

  const tabsRight = document.createElement('div');
  tabsRight.className = 'detail-tabs-right';
  const searchBar = buildBodySearchBar();
  const copyBtn = document.createElement('button');
  copyBtn.className = 'btn btn-ghost btn-icon';
  copyBtn.title = 'Copy body';
  copyBtn.textContent = '⧉';
  tabsRight.appendChild(searchBar.el);
  tabsRight.appendChild(copyBtn);

  tabs.appendChild(tabsLeft);
  tabs.appendChild(tabsRight);
  root.appendChild(tabs);

  const body = document.createElement('div');
  body.className = 'detail-body';
  root.appendChild(body);

  function renderRequestTab() {
    body.innerHTML = '';
    const headersSection = document.createElement('div');
    headersSection.className = 'detail-section';
    const headersTitle = document.createElement('div');
    headersTitle.className = 'detail-section-title';
    headersTitle.textContent = 'Headers';
    headersSection.appendChild(headersTitle);
    headersSection.appendChild(buildHeadersTable(log.requestHeaders));
    body.appendChild(headersSection);

    const bodySection = document.createElement('div');
    bodySection.className = 'detail-section';
    const bodyTitle = document.createElement('div');
    bodyTitle.className = 'detail-section-title';
    bodyTitle.textContent = 'Body';
    bodySection.appendChild(bodyTitle);

    const treeEl = document.createElement('div');
    bodySection.appendChild(treeEl);
    renderJsonTree(treeEl, log.requestBody, { onCopy: () => showToast('Copied') });
    body.appendChild(bodySection);

    searchBar.setTarget(treeEl);
    copyBtn.onclick = () => {
      const text = typeof log.requestBody === 'string' ? log.requestBody : JSON.stringify(log.requestBody, null, 2);
      copyToClipboard(text).then(() => showToast('Request body copied'));
    };
  }

  function renderResponseTab() {
    body.innerHTML = '';

    const headersSection = document.createElement('div');
    headersSection.className = 'detail-section';
    const headersTitle = document.createElement('div');
    headersTitle.className = 'detail-section-title';
    headersTitle.textContent = 'Headers';
    headersSection.appendChild(headersTitle);
    headersSection.appendChild(buildHeadersTable(log.responseHeaders));
    body.appendChild(headersSection);

    const bodySection = document.createElement('div');
    bodySection.className = 'detail-section';
    const bodyTitle = document.createElement('div');
    bodyTitle.className = 'detail-section-title';
    bodyTitle.textContent = 'Body';
    bodySection.appendChild(bodyTitle);

    const treeEl = document.createElement('div');
    bodySection.appendChild(treeEl);
    renderJsonTree(treeEl, log.responseBody, { onCopy: () => showToast('Copied') });
    body.appendChild(bodySection);

    searchBar.setTarget(treeEl);
    copyBtn.onclick = () => {
      const text =
        typeof log.responseBody === 'string' ? log.responseBody : JSON.stringify(log.responseBody, null, 2);
      copyToClipboard(text).then(() => showToast('Response body copied'));
    };
  }

  function selectTab(which) {
    tabRequest.classList.toggle('active', which === 'request');
    tabResponse.classList.toggle('active', which === 'response');
    if (which === 'request') renderRequestTab();
    else renderResponseTab();
  }

  tabRequest.addEventListener('click', () => selectTab('request'));
  tabResponse.addEventListener('click', () => selectTab('response'));
  selectTab('response');

  return root;
}

function buildCompareDetail(selection) {
  const versions = state.logs.filter((l) => groupKeyOf(l) === selection.groupKey).sort((a, b) => (a.startTime || a.receivedAt) - (b.startTime || b.receivedAt));

  const root = document.createElement('div');
  root.className = 'detail-root';

  const header = document.createElement('div');
  header.className = 'detail-header';
  const url = document.createElement('div');
  url.className = 'detail-url';
  url.textContent = selection.groupKey;
  header.appendChild(url);
  root.appendChild(header);

  const toolbar = document.createElement('div');
  toolbar.className = 'diff-toolbar';

  const baseSelect = document.createElement('select');
  const compareSelect = document.createElement('select');
  versions.forEach((v, idx) => {
    const label = `v${idx + 1} · ${formatTime(v.startTime || v.receivedAt)}`;
    const optA = document.createElement('option');
    optA.value = v.id;
    optA.textContent = label;
    if (v.id === selection.baseId) optA.selected = true;
    baseSelect.appendChild(optA);

    const optB = document.createElement('option');
    optB.value = v.id;
    optB.textContent = label;
    if (v.id === selection.compareId) optB.selected = true;
    compareSelect.appendChild(optB);
  });

  toolbar.appendChild(baseSelect);
  const arrow = document.createElement('span');
  arrow.className = 'arrow';
  arrow.textContent = '→';
  toolbar.appendChild(arrow);
  toolbar.appendChild(compareSelect);

  const toggleWrap = document.createElement('div');
  toggleWrap.className = 'diff-toggle';
  const inlineBtn = document.createElement('button');
  inlineBtn.textContent = 'Inline diff';
  const sideBtn = document.createElement('button');
  sideBtn.textContent = 'Side-by-side';
  toggleWrap.appendChild(inlineBtn);
  toggleWrap.appendChild(sideBtn);
  toolbar.appendChild(toggleWrap);

  root.appendChild(toolbar);

  const legend = document.createElement('div');
  legend.className = 'diff-legend';
  legend.innerHTML = `
    <span><span class="legend-swatch legend-added"></span>added</span>
    <span><span class="legend-swatch legend-removed"></span>removed</span>
    <span><span class="legend-swatch legend-changed"></span>changed</span>
  `;
  root.appendChild(legend);

  const body = document.createElement('div');
  body.className = 'detail-body';
  root.appendChild(body);

  function draw() {
    inlineBtn.classList.toggle('active', selection.mode === 'inline');
    sideBtn.classList.toggle('active', selection.mode === 'side');

    const base = versions.find((v) => v.id === selection.baseId) || versions[0];
    const compare = versions.find((v) => v.id === selection.compareId) || versions[versions.length - 1];
    const diffTree = diffValues(base ? base.responseBody : undefined, compare ? compare.responseBody : undefined);

    body.innerHTML = '';

    if (selection.mode === 'side') {
      const wrap = document.createElement('div');
      wrap.className = 'side-by-side';

      const left = document.createElement('div');
      const leftTitle = document.createElement('div');
      leftTitle.className = 'pane-title';
      leftTitle.textContent = `Base — ${baseSelect.selectedOptions[0]?.textContent || ''}`;
      left.appendChild(leftTitle);
      const leftTree = document.createElement('div');
      left.appendChild(leftTree);

      const right = document.createElement('div');
      const rightTitle = document.createElement('div');
      rightTitle.className = 'pane-title';
      rightTitle.textContent = `Compare — ${compareSelect.selectedOptions[0]?.textContent || ''}`;
      right.appendChild(rightTitle);
      const rightTree = document.createElement('div');
      right.appendChild(rightTree);

      wrap.appendChild(left);
      wrap.appendChild(right);
      body.appendChild(wrap);

      renderDiffTree(leftTree, diffTree, 'a', () => showToast('Copied'));
      renderDiffTree(rightTree, diffTree, 'b', () => showToast('Copied'));
    } else {
      const treeEl = document.createElement('div');
      body.appendChild(treeEl);
      renderDiffTree(treeEl, diffTree, undefined, () => showToast('Copied'));
    }
  }

  baseSelect.addEventListener('change', () => {
    selection.baseId = baseSelect.value;
    draw();
  });
  compareSelect.addEventListener('change', () => {
    selection.compareId = compareSelect.value;
    draw();
  });
  inlineBtn.addEventListener('click', () => {
    selection.mode = 'inline';
    draw();
  });
  sideBtn.addEventListener('click', () => {
    selection.mode = 'side';
    draw();
  });

  selection.mode = selection.mode || 'inline';
  draw();

  return root;
}

// ------------------------------------------------------------------ logs

function levelClass(level) {
  return `level-${(level || 'log').toLowerCase()}`;
}

function matchesLogsSearch(log) {
  if (!state.logsSearch) return true;
  return (log.message || '').toLowerCase().includes(state.logsSearch.toLowerCase());
}

function renderLogsList() {
  el.logsList.innerHTML = '';
  const items = state.consoleLogs.filter(matchesLogsSearch).slice().reverse(); // newest first

  if (!items.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:16px;color:var(--text-faint);font-size:12px;';
    empty.textContent = state.consoleLogs.length ? 'No logs match your filter.' : 'No logs captured yet.';
    el.logsList.appendChild(empty);
    return;
  }

  items.forEach((log) => {
    el.logsList.appendChild(buildLogRow(log));
  });
}

function buildLogRow(log) {
  const row = document.createElement('div');
  row.className = 'request-item';
  if (state.selectedLogId === log.id) row.classList.add('selected');

  const level = document.createElement('span');
  level.className = `level-badge ${levelClass(log.level)}`;
  level.textContent = log.level || 'log';
  row.appendChild(level);

  const main = document.createElement('div');
  main.className = 'request-item-main';

  const message = document.createElement('div');
  message.className = 'log-message mono';
  message.textContent = log.message || '';
  message.title = log.message || '';
  main.appendChild(message);

  const meta = document.createElement('div');
  meta.className = 'request-meta';
  const time = document.createElement('span');
  time.textContent = formatTime(log.timestamp || log.receivedAt);
  meta.appendChild(time);
  main.appendChild(meta);

  row.appendChild(main);

  row.addEventListener('click', () => {
    state.selectedLogId = log.id;
    renderLogsList();
    renderLogsDetail();
  });

  return row;
}

function renderLogsDetail() {
  el.logsDetailPanel.innerHTML = '';

  const log = state.consoleLogs.find((l) => l.id === state.selectedLogId);
  if (!log) {
    el.logsDetailPanel.appendChild(el.logsEmptyState);
    return;
  }

  const root = document.createElement('div');
  root.className = 'detail-root';

  const header = document.createElement('div');
  header.className = 'detail-header';

  const top = document.createElement('div');
  top.className = 'detail-header-top';
  const level = document.createElement('span');
  level.className = `level-badge ${levelClass(log.level)}`;
  level.textContent = log.level || 'log';
  top.appendChild(level);
  header.appendChild(top);

  const messageRow = document.createElement('div');
  messageRow.className = 'log-message-row';
  messageRow.style.marginTop = '6px';

  const messageToggle = document.createElement('span');
  messageToggle.className = 'tree-toggle';
  messageToggle.textContent = '▸';
  messageRow.appendChild(messageToggle);

  const message = document.createElement('div');
  message.className = 'detail-url log-message-full collapsed';
  message.textContent = log.message || '';
  messageRow.appendChild(message);

  messageToggle.addEventListener('click', () => {
    const collapsed = message.classList.toggle('collapsed');
    messageToggle.textContent = collapsed ? '▸' : '▾';
  });

  header.appendChild(messageRow);

  const sub = document.createElement('div');
  sub.className = 'detail-sub';
  const time = document.createElement('span');
  time.textContent = `⏱ ${formatTime(log.timestamp || log.receivedAt)}`;
  sub.appendChild(time);
  header.appendChild(sub);

  root.appendChild(header);

  const body = document.createElement('div');
  body.className = 'detail-body';
  root.appendChild(body);

  const argsSection = document.createElement('div');
  argsSection.className = 'detail-section';
  const argsTitleRow = document.createElement('div');
  argsTitleRow.className = 'detail-section-title';
  const argsTitle = document.createElement('span');
  argsTitle.textContent = 'Arguments';
  argsTitleRow.appendChild(argsTitle);
  const copyBtn = document.createElement('button');
  copyBtn.className = 'btn btn-ghost btn-icon';
  copyBtn.title = 'Copy arguments';
  copyBtn.textContent = '⧉';
  copyBtn.addEventListener('click', () => {
    copyToClipboard(JSON.stringify(log.args, null, 2)).then(() => showToast('Copied'));
  });
  argsTitleRow.appendChild(copyBtn);
  argsSection.appendChild(argsTitleRow);

  const treeEl = document.createElement('div');
  argsSection.appendChild(treeEl);
  renderJsonTree(treeEl, log.args, { onCopy: () => showToast('Copied') });
  body.appendChild(argsSection);

  el.logsDetailPanel.appendChild(root);
}

// ---------------------------------------------------------------- events

el.sidebarTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    el.sidebarTabs.forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    state.sidebarMode = tab.dataset.mode;
    renderSidebar();
  });
});

el.searchInput.addEventListener('input', (e) => {
  state.search = e.target.value;
  renderSidebar();
});

el.clearBtn.addEventListener('click', () => {
  fetch('/api/clear', {
    method: 'POST',
    headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {},
  }).catch(() => {});
});

el.primaryNav.addEventListener('click', (e) => {
  const btn = e.target.closest('.primary-tab');
  if (!btn || btn.classList.contains('active')) return;
  const view = btn.dataset.view;

  el.primaryNav.querySelectorAll('.primary-tab').forEach((t) => t.classList.toggle('active', t === btn));
  el.viewNetwork.classList.toggle('view-hidden', view !== 'network');
  el.viewLogs.classList.toggle('view-hidden', view !== 'logs');

  state.primaryView = view;
});

el.logsSearchInput.addEventListener('input', (e) => {
  state.logsSearch = e.target.value;
  renderLogsList();
});

// ------------------------------------------------------------------ init

connectWS();
renderDetail();
