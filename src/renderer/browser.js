'use strict';

/* ─── Constants ────────────────────────────────────────────────────────────── */
const SLEEP_TIMEOUT_MS   = 5 * 60 * 1000; // 5 minutes
const GOOGLE_SEARCH      = 'https://www.google.com/search?q=';
const DEFAULT_HOME       = 'helix://newtab';

/* ─── State ────────────────────────────────────────────────────────────────── */
let tabs        = [];       // { id, url, title, favicon, active, sleeping, webview, tabEl, wakeUrl }
let activeTabId = null;
let downloadItems = [];
let bookmarks   = JSON.parse(localStorage.getItem('helix-bookmarks') || '[]');
let history     = JSON.parse(localStorage.getItem('helix-history')   || '[]');
let settings    = JSON.parse(localStorage.getItem('helix-settings')  || JSON.stringify({
  theme: 'dark',
  sleepTimeout: 5,
  showBookmarksBar: false,
}));

let tabIdCounter = 0;

/* ─── DOM refs ─────────────────────────────────────────────────────────────── */
const $ = (sel) => document.querySelector(sel);
const tabsContainer   = $('#tabs-container');
const browserContent  = $('#browser-content');
const addressBar      = $('#address-bar');
const btnBack         = $('#btn-back');
const btnForward      = $('#btn-forward');
const btnReload       = $('#btn-reload');
const btnHome         = $('#btn-home');
const btnNewTab       = $('#btn-new-tab');
const btnBookmark     = $('#btn-bookmark');
const btnDownloads    = $('#btn-downloads');
const btnSettings     = $('#btn-settings');
const newTabPage      = $('#new-tab-page');
const ntpSearch       = $('#ntp-search');
const ntpSearchForm   = $('#ntp-search-form');
const bookmarksBar    = $('#bookmarks-bar');
const bookmarksList   = $('#bookmarks-list');
const downloadPanel   = $('#downloads-panel');
const downloadsList   = $('#downloads-list');
const updateBanner    = $('#update-banner');
const updateMessage   = $('#update-message');
const memoryBadge     = $('#memory-badge');
const secureIcon      = $('#secure-icon');
const loadingSpinner  = $('#loading-spinner');
const contextMenu     = $('#context-menu');

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Tab Management                                                               */
/* ═══════════════════════════════════════════════════════════════════════════ */

function createTab(url = DEFAULT_HOME, activate = true) {
  const id = ++tabIdCounter;
  const isNewTab = url === DEFAULT_HOME;

  // ── DOM: tab element
  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.dataset.tabId = id;
  tabEl.innerHTML = `
    <div class="tab-favicon">🌐</div>
    <span class="tab-title">New Tab</span>
    <button class="tab-close" title="Close tab">✕</button>
  `;
  tabsContainer.appendChild(tabEl);

  // ── DOM: webview
  let webview = null;
  if (!isNewTab) {
    webview = document.createElement('webview');
    webview.setAttribute('src', url);
    webview.setAttribute('allowpopups', '');
    webview.setAttribute('webpreferences', 'contextIsolation=false');
    webview.dataset.tabId = id;
    browserContent.appendChild(webview);
    attachWebviewEvents(webview, id);
  }

  const tab = { id, url, title: 'New Tab', favicon: null, sleeping: false, webview, tabEl, wakeUrl: url, sleepTimer: null };
  tabs.push(tab);

  // ── Tab click → activate
  tabEl.addEventListener('click', (e) => {
    if (!e.target.classList.contains('tab-close')) activateTab(id);
  });

  // ── Close button
  tabEl.querySelector('.tab-close').addEventListener('click', (e) => {
    e.stopPropagation();
    closeTab(id);
  });

  if (activate) activateTab(id);
  return id;
}

function activateTab(id) {
  // Deactivate old
  if (activeTabId) {
    const old = getTab(activeTabId);
    if (old) {
      old.tabEl.classList.remove('active');
      if (old.webview) old.webview.classList.remove('active');
    }
  }

  const tab = getTab(id);
  if (!tab) return;

  activeTabId = id;
  tab.tabEl.classList.add('active');

  const isNewTab = tab.url === DEFAULT_HOME || !tab.webview;

  if (isNewTab) {
    // Show the new-tab page, hide webviews
    hideAllWebviews();
    newTabPage.classList.remove('hidden');
  } else {
    newTabPage.classList.add('hidden');
    hideAllWebviews();
    if (tab.sleeping) {
      wakeTab(tab);
    } else if (tab.webview) {
      tab.webview.classList.add('active');
    }
  }

  // Update toolbar
  updateAddressBar(tab.url === DEFAULT_HOME ? '' : tab.url);
  updateNavButtons();
  updateBookmarkIcon();
  restartSleepTimers(id);
}

function hideAllWebviews() {
  document.querySelectorAll('webview').forEach(wv => wv.classList.remove('active'));
}

function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;

  const tab = tabs[idx];
  clearTimeout(tab.sleepTimer);

  // Remove DOM
  tab.tabEl.remove();
  if (tab.webview) tab.webview.remove();
  tabs.splice(idx, 1);

  if (tabs.length === 0) {
    // Open a fresh new tab
    createTab(DEFAULT_HOME);
    return;
  }

  if (activeTabId === id) {
    const nextTab = tabs[Math.min(idx, tabs.length - 1)];
    activateTab(nextTab.id);
  }
}

function getTab(id) { return tabs.find(t => t.id === id); }

/* ═══════════════════════════════════════════════════════════════════════════ */
/* WebView Events                                                               */
/* ═══════════════════════════════════════════════════════════════════════════ */

function attachWebviewEvents(webview, tabId) {
  webview.addEventListener('did-start-loading', () => {
    const tab = getTab(tabId);
    if (!tab) return;
    setTabLoading(tab, true);
    if (tabId === activeTabId) loadingSpinner.classList.remove('hidden');
  });

  webview.addEventListener('did-stop-loading', () => {
    const tab = getTab(tabId);
    if (!tab) return;
    setTabLoading(tab, false);
    if (tabId === activeTabId) {
      loadingSpinner.classList.add('hidden');
      updateNavButtons();
    }
  });

  webview.addEventListener('did-navigate', (e) => {
    const tab = getTab(tabId);
    if (!tab) return;
    tab.url = e.url;
    tab.wakeUrl = e.url;
    if (tabId === activeTabId) {
      updateAddressBar(e.url);
      updateNavButtons();
      updateSecureIcon(e.url);
    }
    addToHistory(e.url, tab.title);
    resetSleepTimer(tabId);
  });

  webview.addEventListener('did-navigate-in-page', (e) => {
    const tab = getTab(tabId);
    if (!tab) return;
    tab.url = e.url;
    if (tabId === activeTabId) updateAddressBar(e.url);
    resetSleepTimer(tabId);
  });

  webview.addEventListener('page-title-updated', (e) => {
    const tab = getTab(tabId);
    if (!tab) return;
    tab.title = e.title;
    tab.tabEl.querySelector('.tab-title').textContent = e.title;
    if (tabId === activeTabId) document.title = e.title + ' — Helix';
  });

  webview.addEventListener('page-favicon-updated', (e) => {
    if (!e.favicons.length) return;
    const tab = getTab(tabId);
    if (!tab) return;
    tab.favicon = e.favicons[0];
    const faviconEl = tab.tabEl.querySelector('.tab-favicon');
    faviconEl.innerHTML = `<img src="${e.favicons[0]}" width="14" height="14" style="border-radius:2px;" onerror="this.parentElement.textContent='🌐'">`;
  });

  webview.addEventListener('new-window', (e) => {
    // Open in a new tab rather than a new window
    createTab(e.url);
  });
}

function setTabLoading(tab, loading) {
  const spinner = tab.tabEl.querySelector('.tab-loading');
  if (loading) {
    if (!spinner) {
      const el = document.createElement('div');
      el.className = 'tab-loading';
      tab.tabEl.querySelector('.tab-favicon').replaceWith(el);
    }
  } else {
    if (spinner) {
      const fav = document.createElement('div');
      fav.className = 'tab-favicon';
      fav.innerHTML = tab.favicon
        ? `<img src="${tab.favicon}" width="14" height="14" style="border-radius:2px;" onerror="this.parentElement.textContent='🌐'">`
        : '🌐';
      spinner.replaceWith(fav);
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Tab Sleep / Wake                                                             */
/* ═══════════════════════════════════════════════════════════════════════════ */

function resetSleepTimer(tabId) {
  const tab = getTab(tabId);
  if (!tab) return;
  clearTimeout(tab.sleepTimer);
  if (tabId === activeTabId) return; // don't sleep the active tab
  const ms = (settings.sleepTimeout || 5) * 60 * 1000;
  tab.sleepTimer = setTimeout(() => sleepTab(tab), ms);
}

function restartSleepTimers(activeId) {
  tabs.forEach(t => {
    clearTimeout(t.sleepTimer);
    if (t.id !== activeId && !t.sleeping && t.webview) {
      const ms = (settings.sleepTimeout || 5) * 60 * 1000;
      t.sleepTimer = setTimeout(() => sleepTab(t), ms);
    }
  });
}

function sleepTab(tab) {
  if (tab.sleeping || !tab.webview || tab.id === activeTabId) return;
  tab.wakeUrl = tab.url;
  tab.webview.setAttribute('src', 'about:blank');
  tab.sleeping = true;
  tab.tabEl.classList.add('sleeping');
  updateSleepStats();
}

function wakeTab(tab) {
  if (!tab.sleeping) return;
  tab.sleeping = false;
  tab.tabEl.classList.remove('sleeping');
  if (tab.webview) {
    tab.webview.setAttribute('src', tab.wakeUrl);
    tab.webview.classList.add('active');
  }
  updateSleepStats();
}

function updateSleepStats() {
  const sleeping = tabs.filter(t => t.sleeping).length;
  $('#stat-tabs').textContent = sleeping ? `${sleeping} sleeping tab${sleeping > 1 ? 's' : ''}` : 'All tabs active';
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Navigation                                                                   */
/* ═══════════════════════════════════════════════════════════════════════════ */

function navigate(rawInput) {
  const url = resolveUrl(rawInput.trim());
  const tab = getTab(activeTabId);
  if (!tab) return;

  if (url === DEFAULT_HOME) {
    if (tab.webview) {
      tab.webview.classList.remove('active');
    }
    tab.url = DEFAULT_HOME;
    showNewTabPage();
    return;
  }

  if (!tab.webview) {
    // This tab was a new-tab page; create a webview for it
    const webview = document.createElement('webview');
    webview.setAttribute('src', url);
    webview.setAttribute('allowpopups', '');
    webview.setAttribute('webpreferences', 'contextIsolation=false');
    webview.dataset.tabId = tab.id;
    webview.classList.add('active');
    browserContent.appendChild(webview);
    tab.webview = webview;
    attachWebviewEvents(webview, tab.id);
  } else {
    tab.webview.setAttribute('src', url);
    tab.webview.classList.add('active');
  }

  tab.url = url;
  newTabPage.classList.add('hidden');
}

function resolveUrl(input) {
  if (!input) return DEFAULT_HOME;
  if (input.startsWith('helix://')) return DEFAULT_HOME;
  if (/^https?:\/\//i.test(input)) return input;
  // looks like a domain
  if (/^([a-z0-9-]+\.)+[a-z]{2,}(\/.*)?$/i.test(input)) return 'https://' + input;
  // fallback → Google search
  return GOOGLE_SEARCH + encodeURIComponent(input);
}

function updateAddressBar(url) {
  addressBar.value = url === DEFAULT_HOME ? '' : url;
  updateSecureIcon(url);
}

function updateSecureIcon(url) {
  if (!url || url === DEFAULT_HOME) { secureIcon.classList.add('hidden'); return; }
  secureIcon.classList.remove('hidden');
  if (url.startsWith('https://')) {
    secureIcon.classList.remove('insecure');
    secureIcon.title = 'Secure connection';
  } else {
    secureIcon.classList.add('insecure');
    secureIcon.title = 'Not secure';
  }
}

function updateNavButtons() {
  const tab = getTab(activeTabId);
  if (!tab || !tab.webview) {
    btnBack.disabled    = true;
    btnForward.disabled = true;
    return;
  }
  try {
    btnBack.disabled    = !tab.webview.canGoBack();
    btnForward.disabled = !tab.webview.canGoForward();
  } catch (_) {
    btnBack.disabled    = true;
    btnForward.disabled = true;
  }
}

function showNewTabPage() {
  newTabPage.classList.remove('hidden');
  hideAllWebviews();
  updateAddressBar('');
  updateNavButtons();
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Bookmarks                                                                    */
/* ═══════════════════════════════════════════════════════════════════════════ */

function addBookmark(url, title) {
  if (bookmarks.find(b => b.url === url)) return;
  bookmarks.push({ url, title: title || url });
  saveBookmarks();
  renderBookmarks();
  if (settings.showBookmarksBar) bookmarksBar.classList.remove('hidden');
}

function removeBookmark(url) {
  bookmarks = bookmarks.filter(b => b.url !== url);
  saveBookmarks();
  renderBookmarks();
}

function saveBookmarks() {
  localStorage.setItem('helix-bookmarks', JSON.stringify(bookmarks));
}

function renderBookmarks() {
  bookmarksList.innerHTML = '';
  bookmarks.forEach(b => {
    const el = document.createElement('div');
    el.className = 'bookmark-item';
    el.title = b.url;
    el.textContent = b.title.length > 20 ? b.title.slice(0, 18) + '…' : b.title;
    el.addEventListener('click', () => navigate(b.url));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (confirm(`Remove bookmark: ${b.title}?`)) removeBookmark(b.url);
    });
    bookmarksList.appendChild(el);
  });
}

function updateBookmarkIcon() {
  const tab = getTab(activeTabId);
  if (!tab) return;
  const isBookmarked = bookmarks.some(b => b.url === tab.url);
  btnBookmark.style.color = isBookmarked ? 'var(--accent)' : '';
  btnBookmark.title = isBookmarked ? 'Remove bookmark' : 'Bookmark this page';
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* History                                                                      */
/* ═══════════════════════════════════════════════════════════════════════════ */

function addToHistory(url, title) {
  if (!url || url === DEFAULT_HOME) return;
  history.unshift({ url, title: title || url, ts: Date.now() });
  if (history.length > 500) history = history.slice(0, 500);
  localStorage.setItem('helix-history', JSON.stringify(history));
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* RAM / Memory Display                                                         */
/* ═══════════════════════════════════════════════════════════════════════════ */

async function updateMemoryBadge() {
  try {
    const mem = await window.browserAPI.getMemoryUsage();
    const mb  = (mem.rss / 1048576).toFixed(0);
    memoryBadge.textContent = mb + ' MB';
    memoryBadge.classList.remove('hidden');
    // Update NTP stat too
    $('#stat-ram').textContent = `RAM: ${mb} MB`;
  } catch (_) {}
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Auto-Updater                                                                 */
/* ═══════════════════════════════════════════════════════════════════════════ */

window.browserAPI.onUpdaterStatus((data) => {
  switch (data.status) {
    case 'available':
      updateMessage.textContent = `🔄 Update to v${data.payload} available, downloading…`;
      updateBanner.classList.remove('hidden');
      break;
    case 'progress': {
      const pct = Math.round(data.payload);
      updateMessage.textContent = `⬇️ Downloading update… ${pct}%`;
      updateBanner.classList.remove('hidden');
      break;
    }
    case 'downloaded':
      updateMessage.textContent = '✅ Update ready to install!';
      updateBanner.classList.remove('hidden');
      break;
    case 'error':
      console.warn('Updater error:', data.payload);
      break;
  }
});

$('#btn-install-update').addEventListener('click', () => {
  window.browserAPI.installUpdate();
});
$('#btn-dismiss-update').addEventListener('click', () => {
  updateBanner.classList.add('hidden');
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Settings                                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

function openSettingsTab() {
  // Check if settings tab already open
  const existing = tabs.find(t => t.url === 'helix://settings');
  if (existing) { activateTab(existing.id); return; }

  const id = createTab(DEFAULT_HOME, false);
  const tab = getTab(id);
  tab.url = 'helix://settings';
  tab.title = 'Settings';
  tab.tabEl.querySelector('.tab-title').textContent = '⚙️ Settings';

  activateTab(id);
  newTabPage.classList.add('hidden');

  // Load the settings iframe into browser content area
  let settingsFrame = document.getElementById('settings-frame');
  if (!settingsFrame) {
    settingsFrame = document.createElement('iframe');
    settingsFrame.id = 'settings-frame';
    settingsFrame.src = 'settings.html';
    settingsFrame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:none;display:none;background:var(--bg-base)';
    browserContent.appendChild(settingsFrame);
  }

  hideAllWebviews();
  settingsFrame.style.display = 'block';

  // When switching away, hide settings frame
  const origActivate = activateTab;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Context Menu                                                                 */
/* ═══════════════════════════════════════════════════════════════════════════ */

document.addEventListener('contextmenu', (e) => {
  // Only show on the toolbar / tab area (not inside webview — the webview has its own)
  if (e.target.closest('#browser-content')) return;
  e.preventDefault();

  contextMenu.style.left = Math.min(e.clientX, window.innerWidth  - 170) + 'px';
  contextMenu.style.top  = Math.min(e.clientY, window.innerHeight - 160) + 'px';
  contextMenu.classList.remove('hidden');
});

document.addEventListener('click', () => contextMenu.classList.add('hidden'));

contextMenu.querySelectorAll('.ctx-item').forEach(item => {
  item.addEventListener('click', () => {
    const tab = getTab(activeTabId);
    switch (item.dataset.action) {
      case 'back':       tab?.webview?.goBack(); break;
      case 'forward':    tab?.webview?.goForward(); break;
      case 'reload':     tab?.webview?.reload(); break;
      case 'bookmark':   handleBookmarkToggle(); break;
      case 'copy-url':   navigator.clipboard.writeText(tab?.url || ''); break;
      case 'view-source': createTab('view-source:' + tab?.url); break;
    }
    contextMenu.classList.add('hidden');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Keyboard Shortcuts                                                           */
/* ═══════════════════════════════════════════════════════════════════════════ */

window.browserAPI.onShortcut((shortcut) => {
  const tab = getTab(activeTabId);
  switch (shortcut) {
    case 'shortcut-new-tab':    createTab(); break;
    case 'shortcut-close-tab':  if (activeTabId) closeTab(activeTabId); break;
    case 'shortcut-reload':     tab?.webview?.reload(); break;
    case 'shortcut-hard-reload': tab?.webview?.reloadIgnoringCache(); break;
    case 'shortcut-back':       tab?.webview?.goBack(); break;
    case 'shortcut-forward':    tab?.webview?.goForward(); break;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'l') { e.preventDefault(); addressBar.select(); }
  if (e.ctrlKey && e.key === 'd') { e.preventDefault(); handleBookmarkToggle(); }
  if (e.key === 'F5') { getTab(activeTabId)?.webview?.reload(); }
  if (e.key === 'Escape') { addressBar.blur(); contextMenu.classList.add('hidden'); }
  // Ctrl+1..9 → switch tabs
  if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
    const idx = parseInt(e.key) - 1;
    if (tabs[idx]) activateTab(tabs[idx].id);
  }
});

function handleBookmarkToggle() {
  const tab = getTab(activeTabId);
  if (!tab || !tab.url || tab.url === DEFAULT_HOME) return;
  const isBookmarked = bookmarks.some(b => b.url === tab.url);
  if (isBookmarked) {
    removeBookmark(tab.url);
  } else {
    addBookmark(tab.url, tab.title);
  }
  updateBookmarkIcon();
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Toolbar Button Wiring                                                        */
/* ═══════════════════════════════════════════════════════════════════════════ */

btnBack.addEventListener('click', ()    => getTab(activeTabId)?.webview?.goBack());
btnForward.addEventListener('click', () => getTab(activeTabId)?.webview?.goForward());
btnReload.addEventListener('click', ()  => {
  const tab = getTab(activeTabId);
  if (tab?.webview) tab.webview.reload();
});
btnHome.addEventListener('click', ()    => createTab(DEFAULT_HOME));
btnNewTab.addEventListener('click', ()  => createTab(DEFAULT_HOME));
btnBookmark.addEventListener('click',() => handleBookmarkToggle());
btnSettings.addEventListener('click',() => openSettingsTab());
btnDownloads.addEventListener('click', () => {
  downloadPanel.classList.toggle('hidden');
});
$('#downloads-close').addEventListener('click', () => downloadPanel.classList.add('hidden'));

// Window controls
$('#btn-minimize').addEventListener('click', () => window.browserAPI.minimize());
$('#btn-maximize').addEventListener('click', () => window.browserAPI.maximize());
$('#btn-close').addEventListener('click',    () => window.browserAPI.close());

/* ─── Address Bar ──────────────────────────────────────────────────────────── */
addressBar.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    navigate(addressBar.value);
    addressBar.blur();
  }
});
addressBar.addEventListener('focus', () => addressBar.select());

/* ─── NTP Search ───────────────────────────────────────────────────────────── */
ntpSearchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = ntpSearch.value.trim();
  if (q) navigate(q);
});

/* ─── NTP Shortcuts ─────────────────────────────────────────────────────────  */
document.querySelectorAll('.shortcut').forEach(el => {
  el.addEventListener('click', () => navigate(el.dataset.url));
});

/* ─── NTP Close App Button ──────────────────────────────────────────────────  */
$('#btn-ntp-close').addEventListener('click', () => window.browserAPI.close());

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Settings page communication (postMessage bridge)                             */
/* ═══════════════════════════════════════════════════════════════════════════ */

window.addEventListener('message', (e) => {
  if (e.data?.type === 'settings-update') {
    Object.assign(settings, e.data.settings);
    localStorage.setItem('helix-settings', JSON.stringify(settings));

    // Apply immediately
    document.documentElement.setAttribute('data-theme', settings.theme);
    if (settings.showBookmarksBar && bookmarks.length > 0) {
      bookmarksBar.classList.remove('hidden');
    } else {
      bookmarksBar.classList.add('hidden');
    }
  }
  if (e.data?.type === 'clear-history') {
    history = [];
    localStorage.setItem('helix-history', '[]');
  }
  if (e.data?.type === 'clear-cache') {
    const { session } = require('electron') // Note: won't work in renderer; handled via IPC
  }
  if (e.data?.type === 'check-update') {
    window.browserAPI.checkUpdate().then(res => {
      const frame = document.getElementById('settings-frame');
      frame?.contentWindow.postMessage({ type: 'update-result', res }, '*');
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Init                                                                         */
/* ═══════════════════════════════════════════════════════════════════════════ */

async function init() {
  // Version badge
  try {
    const version = await window.browserAPI.getVersion();
    $('#stat-version').textContent = 'v' + version;
  } catch (_) {}

  // Render bookmarks
  renderBookmarks();
  if (settings.showBookmarksBar && bookmarks.length > 0) {
    bookmarksBar.classList.remove('hidden');
  }

  // Apply theme
  document.documentElement.setAttribute('data-theme', settings.theme || 'dark');

  // Open initial new tab
  createTab(DEFAULT_HOME);

  // Memory monitor every 10 seconds
  updateMemoryBadge();
  setInterval(updateMemoryBadge, 10_000);

  // Update sleep stats periodically
  setInterval(updateSleepStats, 5_000);
}

init();
