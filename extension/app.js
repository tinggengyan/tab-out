/* ================================================================
   Tab Out — Dashboard App (Pure Extension Edition)

   This file is the brain of the dashboard. Now that the dashboard
   IS the extension page (not inside an iframe), it can call
   chrome.tabs and chrome.storage directly — no postMessage bridge needed.

   What this file does:
   1. Reads open browser tabs directly via chrome.tabs.query()
   2. Groups tabs by domain with a landing pages category
   3. Renders domain cards, banners, and stats
   4. Handles all user actions (close tabs, save for later, focus tab)
   5. Stores "Saved for Later" tabs in chrome.storage.local (no server)
   ================================================================ */

'use strict';

const {
  escapeHtml, groupTabsBySite, isRealTabUrl, faviconUrl, duplicateTabIds, createUndoController,
  createCollectedStore, migrateLegacy, collectableTabs, restoreTargets, buildExport, parseImport,
  createRefreshScheduler, searchAll, highlight, flattenBookmarks, dayBucket,
} = TabOutLib;

// Every close goes through this controller so it can be undone for 30 seconds.
const undoController = createUndoController({ tabsApi: chrome.tabs, windowsApi: chrome.windows });


/* ----------------------------------------------------------------
   CHROME TABS — Direct API Access

   Since this page IS the extension's new tab page, it has full
   access to chrome.tabs and chrome.storage. No middleman needed.
   ---------------------------------------------------------------- */

// All open tabs — populated by fetchOpenTabs()
let openTabs = [];

/**
 * fetchOpenTabs()
 *
 * Reads all currently open browser tabs directly from Chrome.
 * Sets the extensionId flag so we can identify Tab Out's own pages.
 */
async function fetchOpenTabs() {
  try {
    const extensionId = chrome.runtime.id;
    // The new URL for this page is now index.html (not newtab.html)
    const newtabUrl = `chrome-extension://${extensionId}/index.html`;

    const tabs = await chrome.tabs.query({});
    openTabs = tabs.map(t => ({
      id:       t.id,
      // A tab reopened a moment ago may not have committed its URL yet
      url:      t.url || t.pendingUrl,
      title:    t.title,
      windowId: t.windowId,
      index:    t.index,
      active:   t.active,
      pinned:   t.pinned,
      // Flag Tab Out's own pages so we can detect duplicate new tabs
      isTabOut: t.url === newtabUrl || t.url === 'chrome://newtab/',
    }));
  } catch {
    // chrome.tabs API unavailable (shouldn't happen in an extension page)
    openTabs = [];
  }
}

/**
 * focusTab(url)
 *
 * Switches Chrome to the tab with the given URL (exact match first,
 * then hostname fallback). Also brings the window to the front.
 */
async function focusTab(url) {
  if (!url) return;
  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();

  // Try exact URL match first
  let matches = allTabs.filter(t => t.url === url);

  // Fall back to hostname match
  if (matches.length === 0) {
    try {
      const targetHost = new URL(url).hostname;
      matches = allTabs.filter(t => {
        try { return new URL(t.url).hostname === targetHost; }
        catch { return false; }
      });
    } catch {}
  }

  if (matches.length === 0) return;

  // Prefer a match in a different window so it actually switches windows
  const match = matches.find(t => t.windowId !== currentWindow.id) || matches[0];
  await chrome.tabs.update(match.id, { active: true });
  await chrome.windows.update(match.windowId, { focused: true });
}

/**
 * closeTabOutDupes()
 *
 * Closes all duplicate Tab Out new-tab pages except the current one.
 */
async function closeTabOutDupes() {
  const extensionId = chrome.runtime.id;
  const newtabUrl = `chrome-extension://${extensionId}/index.html`;

  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();
  const tabOutTabs = allTabs.filter(t =>
    t.url === newtabUrl || t.url === 'chrome://newtab/'
  );

  if (tabOutTabs.length <= 1) return;

  // Keep the active Tab Out tab in the CURRENT window — that's the one the
  // user is looking at right now. Falls back to any active one, then the first.
  const keep =
    tabOutTabs.find(t => t.active && t.windowId === currentWindow.id) ||
    tabOutTabs.find(t => t.active) ||
    tabOutTabs[0];
  const toClose = tabOutTabs.filter(t => t.id !== keep.id).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}


/* ----------------------------------------------------------------
   SAVED FOR LATER — chrome.storage.local

   Replaces the old server-side SQLite + REST API with Chrome's
   built-in key-value storage. Data persists across browser sessions
   and doesn't require a running server.

   Data shape stored under the "deferred" key:
   [
     {
       id: "1712345678901",          // timestamp-based unique ID
       url: "https://example.com",
       title: "Example Page",
       savedAt: "2026-04-04T10:00:00.000Z",  // ISO date string
       completed: false,             // true = checked off (archived)
       dismissed: false              // true = dismissed without reading
     },
     ...
   ]
   ---------------------------------------------------------------- */

/**
 * saveTabForLater(tab)
 *
 * Saves a single tab to the "Saved for Later" list in chrome.storage.local.
 * @param {{ url: string, title: string }} tab
 */
async function saveTabForLater(tab) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const item = {
    id:        Date.now().toString(),
    url:       tab.url,
    title:     tab.title,
    savedAt:   new Date().toISOString(),
    completed: false,
    dismissed: false,
  };
  deferred.push(item);
  await chrome.storage.local.set({ deferred });
  return item;
}

/**
 * removeSavedTab(id) — deletes a saved item outright (used when undoing
 * "save for later", so the page is back open and not also in the list).
 */
async function removeSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  await chrome.storage.local.set({ deferred: deferred.filter(item => item.id !== id) });
}

/**
 * getSavedTabs()
 *
 * Returns all saved tabs from chrome.storage.local.
 * Filters out dismissed items (those are gone for good).
 * Splits into active (not completed) and archived (completed).
 */
async function getSavedTabs() {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const visible = deferred.filter(t => !t.dismissed);
  return {
    active:   visible.filter(t => !t.completed),
    archived: visible.filter(t => t.completed),
  };
}

/**
 * checkOffSavedTab(id)
 *
 * Marks a saved tab as completed (checked off). It moves to the archive.
 */
async function checkOffSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.completed = true;
    tab.completedAt = new Date().toISOString();
    await chrome.storage.local.set({ deferred });
  }
}

/**
 * dismissSavedTab(id)
 *
 * Marks a saved tab as dismissed (removed from all lists).
 */
async function dismissSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.dismissed = true;
    await chrome.storage.local.set({ deferred });
  }
}


/* ----------------------------------------------------------------
   UI HELPERS
   ---------------------------------------------------------------- */

/**
 * playCloseSound()
 *
 * Plays a clean "swoosh" sound when tabs are closed.
 * Built entirely with the Web Audio API — no sound files needed.
 * A filtered noise sweep that descends in pitch, like air moving.
 */
function playCloseSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;

    // Swoosh: shaped white noise through a sweeping bandpass filter
    const duration = 0.25;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Generate noise with a natural envelope (quick attack, smooth decay)
    for (let i = 0; i < data.length; i++) {
      const pos = i / data.length;
      // Envelope: ramps up fast in first 10%, then fades out smoothly
      const env = pos < 0.1 ? pos / 0.1 : Math.pow(1 - (pos - 0.1) / 0.9, 1.5);
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Bandpass filter sweeps from high to low — creates the "swoosh" character
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2.0;
    filter.frequency.setValueAtTime(4000, t);
    filter.frequency.exponentialRampToValueAtTime(400, t + duration);

    // Volume
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(t);

    setTimeout(() => ctx.close(), 500);
  } catch {
    // Audio not supported — fail silently
  }
}

/**
 * shootConfetti(x, y)
 *
 * Shoots a burst of colorful confetti particles from the given screen
 * coordinates (typically the center of a card being closed).
 * Pure CSS + JS, no libraries.
 */
function shootConfetti(x, y) {
  const colors = [
    '#c8713a', // amber
    '#e8a070', // amber light
    '#5a7a62', // sage
    '#8aaa92', // sage light
    '#5a6b7a', // slate
    '#8a9baa', // slate light
    '#d4b896', // warm paper
    '#b35a5a', // rose
  ];

  const particleCount = 17;

  for (let i = 0; i < particleCount; i++) {
    const el = document.createElement('div');

    const isCircle = Math.random() > 0.5;
    const size = 5 + Math.random() * 6; // 5–11px
    const color = colors[Math.floor(Math.random() * colors.length)];

    el.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: ${isCircle ? '50%' : '2px'};
      pointer-events: none;
      z-index: 9999;
      transform: translate(-50%, -50%);
      opacity: 1;
    `;
    document.body.appendChild(el);

    // Physics: random angle and speed for the outward burst
    const angle   = Math.random() * Math.PI * 2;
    const speed   = 60 + Math.random() * 120;
    const vx      = Math.cos(angle) * speed;
    const vy      = Math.sin(angle) * speed - 80; // bias upward
    const gravity = 200;

    const startTime = performance.now();
    const duration  = 700 + Math.random() * 200; // 700–900ms

    function frame(now) {
      const elapsed  = (now - startTime) / 1000;
      const progress = elapsed / (duration / 1000);

      if (progress >= 1) { el.remove(); return; }

      const px = vx * elapsed;
      const py = vy * elapsed + 0.5 * gravity * elapsed * elapsed;
      const opacity = progress < 0.5 ? 1 : 1 - (progress - 0.5) * 2;
      const rotate  = elapsed * 200 * (isCircle ? 0 : 1);

      el.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px)) rotate(${rotate}deg)`;
      el.style.opacity = opacity;

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }
}

/**
 * animateCardOut(card)
 *
 * Smoothly removes a mission card: fade + scale down, then confetti.
 * After the animation, checks if the grid is now empty.
 */
function animateCardOut(card) {
  if (!card) return;

  const rect = card.getBoundingClientRect();
  shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);

  card.classList.add('closing');
  setTimeout(() => {
    card.remove();
    checkAndShowEmptyState();
  }, 300);
}

/**
 * showToast(message)
 *
 * Brief pop-up notification at the bottom of the screen.
 */
let toastTimer = null;
function showToast(message, { undo = false } = {}) {
  const toast  = document.getElementById('toast');
  const action = document.getElementById('toastAction');
  document.getElementById('toastText').textContent = message;
  action.textContent   = t('btn.undo');
  action.style.display = undo ? '' : 'none';
  toast.classList.toggle('has-action', undo);
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), undo ? 30000 : 2500);
}

function hideToast() {
  clearTimeout(toastTimer);
  document.getElementById('toast').classList.remove('visible');
}

/**
 * checkAndShowEmptyState()
 *
 * Shows a cheerful "Inbox zero" message when all domain cards are gone.
 */
function checkAndShowEmptyState() {
  const missionsEl = document.getElementById('openTabsMissions');
  if (!missionsEl) return;

  const remaining = missionsEl.querySelectorAll('.mission-card:not(.closing)').length;
  if (remaining > 0) return;

  missionsEl.innerHTML = `
    <div class="missions-empty-state">
      <div class="empty-checkmark">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      </div>
      <div class="empty-title">${t('empty.inboxZero')}</div>
      <div class="empty-subtitle">${t('empty.youAreFree')}</div>
    </div>
  `;

  const countEl = document.getElementById('openTabsSectionCount');
  if (countEl) countEl.textContent = t('empty.zeroDomains');
}

/**
 * timeAgo(dateStr)
 *
 * Converts an ISO date string into a human-friendly relative time.
 * "2026-04-04T10:00:00Z" → "2 hrs ago" or "yesterday"
 */
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const then = new Date(dateStr);
  const now  = new Date();
  const diffMins  = Math.floor((now - then) / 60000);
  const diffHours = Math.floor((now - then) / 3600000);
  const diffDays  = Math.floor((now - then) / 86400000);

  if (diffMins < 1)   return t('time.justNow');
  if (diffMins < 60)  return t('time.minAgo', { n: diffMins });
  if (diffHours < 24) return t(diffHours !== 1 ? 'time.hrsAgo' : 'time.hrAgo', { n: diffHours });
  if (diffDays === 1) return t('time.yesterday');
  return t('time.daysAgo', { n: diffDays });
}

/**
 * getGreeting() — "Good morning / afternoon / evening"
 */
function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return t('greeting.morning');
  if (hour < 17) return t('greeting.afternoon');
  return t('greeting.evening');
}

/**
 * getDateDisplay() — "Friday, April 4, 2026"
 */
function getDateDisplay() {
  const locale = _currentLocale === 'zh-CN' ? 'zh-CN' : 'en-US';
  return new Date().toLocaleDateString(locale, {
    weekday: 'long',
    year:    'numeric',
    month:   'long',
    day:     'numeric',
  });
}


/* ----------------------------------------------------------------
   DOMAIN & TITLE CLEANUP HELPERS
   ---------------------------------------------------------------- */

// Map of known hostnames → friendly display names.
const FRIENDLY_DOMAINS = {
  'github.com':           'GitHub',
  'www.github.com':       'GitHub',
  'gist.github.com':      'GitHub Gist',
  'youtube.com':          'YouTube',
  'www.youtube.com':      'YouTube',
  'music.youtube.com':    'YouTube Music',
  'x.com':                'X',
  'www.x.com':            'X',
  'twitter.com':          'X',
  'www.twitter.com':      'X',
  'reddit.com':           'Reddit',
  'www.reddit.com':       'Reddit',
  'old.reddit.com':       'Reddit',
  'substack.com':         'Substack',
  'www.substack.com':     'Substack',
  'medium.com':           'Medium',
  'www.medium.com':       'Medium',
  'linkedin.com':         'LinkedIn',
  'www.linkedin.com':     'LinkedIn',
  'stackoverflow.com':    'Stack Overflow',
  'www.stackoverflow.com':'Stack Overflow',
  'news.ycombinator.com': 'Hacker News',
  'google.com':           'Google',
  'www.google.com':       'Google',
  'mail.google.com':      'Gmail',
  'docs.google.com':      'Google Docs',
  'drive.google.com':     'Google Drive',
  'calendar.google.com':  'Google Calendar',
  'meet.google.com':      'Google Meet',
  'gemini.google.com':    'Gemini',
  'chatgpt.com':          'ChatGPT',
  'www.chatgpt.com':      'ChatGPT',
  'chat.openai.com':      'ChatGPT',
  'claude.ai':            'Claude',
  'www.claude.ai':        'Claude',
  'code.claude.com':      'Claude Code',
  'notion.so':            'Notion',
  'www.notion.so':        'Notion',
  'figma.com':            'Figma',
  'www.figma.com':        'Figma',
  'slack.com':            'Slack',
  'app.slack.com':        'Slack',
  'discord.com':          'Discord',
  'www.discord.com':      'Discord',
  'wikipedia.org':        'Wikipedia',
  'en.wikipedia.org':     'Wikipedia',
  'amazon.com':           'Amazon',
  'www.amazon.com':       'Amazon',
  'netflix.com':          'Netflix',
  'www.netflix.com':      'Netflix',
  'spotify.com':          'Spotify',
  'open.spotify.com':     'Spotify',
  'vercel.com':           'Vercel',
  'www.vercel.com':       'Vercel',
  'npmjs.com':            'npm',
  'www.npmjs.com':        'npm',
  'developer.mozilla.org':'MDN',
  'arxiv.org':            'arXiv',
  'www.arxiv.org':        'arXiv',
  'huggingface.co':       'Hugging Face',
  'www.huggingface.co':   'Hugging Face',
  'producthunt.com':      'Product Hunt',
  'www.producthunt.com':  'Product Hunt',
  'xiaohongshu.com':      'RedNote',
  'www.xiaohongshu.com':  'RedNote',
  'local-files':          'Local Files',
};

function friendlyDomain(hostname) {
  if (!hostname) return '';
  if (FRIENDLY_DOMAINS[hostname]) return FRIENDLY_DOMAINS[hostname];

  if (hostname.endsWith('.substack.com') && hostname !== 'substack.com') {
    return t('title.substack', { name: capitalize(hostname.replace('.substack.com', '')) });
  }
  if (hostname.endsWith('.github.io')) {
    return t('title.githubPages', { name: capitalize(hostname.replace('.github.io', '')) });
  }

  let clean = hostname
    .replace(/^www\./, '')
    .replace(/\.(com|org|net|io|co|ai|dev|app|so|me|xyz|info|us|uk|co\.uk|co\.jp)$/, '');

  return clean.split('.').map(part => capitalize(part)).join(' ');
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function stripTitleNoise(title) {
  if (!title) return '';
  // Strip leading notification count: "(2) Title"
  title = title.replace(/^\(\d+\+?\)\s*/, '');
  // Strip inline counts like "Inbox (16,359)"
  title = title.replace(/\s*\([\d,]+\+?\)\s*/g, ' ');
  // Strip email addresses (privacy + cleaner display)
  title = title.replace(/\s*[\-\u2010-\u2015]\s*[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  title = title.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  // Clean X/Twitter format
  title = title.replace(/\s+on X:\s*/, ': ');
  title = title.replace(/\s*\/\s*X\s*$/, '');
  return title.trim();
}

function cleanTitle(title, hostname) {
  if (!title || !hostname) return title || '';

  const friendly = friendlyDomain(hostname);
  const domain   = hostname.replace(/^www\./, '');
  const seps     = [' - ', ' | ', ' — ', ' · ', ' – '];

  for (const sep of seps) {
    const idx = title.lastIndexOf(sep);
    if (idx === -1) continue;
    const suffix     = title.slice(idx + sep.length).trim();
    const suffixLow  = suffix.toLowerCase();
    if (
      suffixLow === domain.toLowerCase() ||
      suffixLow === friendly.toLowerCase() ||
      suffixLow === domain.replace(/\.\w+$/, '').toLowerCase() ||
      domain.toLowerCase().includes(suffixLow) ||
      friendly.toLowerCase().includes(suffixLow)
    ) {
      const cleaned = title.slice(0, idx).trim();
      if (cleaned.length >= 5) return cleaned;
    }
  }
  return title;
}

function smartTitle(title, url) {
  if (!url) return title || '';
  let pathname = '', hostname = '';
  try { const u = new URL(url); pathname = u.pathname; hostname = u.hostname; }
  catch { return title || ''; }

  const titleIsUrl = !title || title === url || title.startsWith(hostname) || title.startsWith('http');

  if ((hostname === 'x.com' || hostname === 'twitter.com' || hostname === 'www.x.com') && pathname.includes('/status/')) {
    const username = pathname.split('/')[1];
    if (username) return titleIsUrl ? t('title.postBy', { user: username }) : title;
  }

  if (hostname === 'github.com' || hostname === 'www.github.com') {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const [owner, repo, ...rest] = parts;
      if (rest[0] === 'issues' && rest[1]) return t('title.issue', { repo: `${owner}/${repo}`, n: rest[1] });
      if (rest[0] === 'pull'   && rest[1]) return t('title.pr', { repo: `${owner}/${repo}`, n: rest[1] });
      if (rest[0] === 'blob' || rest[0] === 'tree') return `${owner}/${repo} — ${rest.slice(2).join('/')}`;
      if (titleIsUrl) return `${owner}/${repo}`;
    }
  }

  if ((hostname === 'www.youtube.com' || hostname === 'youtube.com') && pathname === '/watch') {
    if (titleIsUrl) return t('title.youtubeVideo');
  }

  if ((hostname === 'www.reddit.com' || hostname === 'reddit.com' || hostname === 'old.reddit.com') && pathname.includes('/comments/')) {
    const parts  = pathname.split('/').filter(Boolean);
    const subIdx = parts.indexOf('r');
    if (subIdx !== -1 && parts[subIdx + 1]) {
      if (titleIsUrl) return t('title.redditPost', { sub: parts[subIdx + 1] });
    }
  }

  return title || url;
}


/* ----------------------------------------------------------------
   SVG ICON STRINGS
   ---------------------------------------------------------------- */
const ICONS = {
  tabs:    `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8.25V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V8.25m-18 0V6a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 6v2.25m-18 0h18" /></svg>`,
  close:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>`,
  archive: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg>`,
  stash:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0-3-3m3 3 3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg>`,
  focus:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" /></svg>`,
};


/* ----------------------------------------------------------------
   IN-MEMORY STORE FOR OPEN-TAB GROUPS
   ---------------------------------------------------------------- */
let domainGroups = [];


/* ----------------------------------------------------------------
   HELPER: filter out browser-internal pages
   ---------------------------------------------------------------- */

/**
 * getRealTabs()
 *
 * Returns tabs that are real web pages — no chrome://, extension
 * pages, about:blank, etc.
 */
function getRealTabs() {
  return openTabs.filter(t => isRealTabUrl(t.url));
}

/**
 * checkTabOutDupes()
 *
 * Counts how many Tab Out pages are open. If more than 1,
 * shows a banner offering to close the extras.
 */
function checkTabOutDupes() {
  const tabOutTabs = openTabs.filter(tab => tab.isTabOut);
  const banner  = document.getElementById('tabOutDupeBanner');
  const textEl  = document.getElementById('tabOutDupeText');
  if (!banner) return;

  if (tabOutTabs.length > 1) {
    if (textEl) textEl.innerHTML = t('banner.dupeText', { n: tabOutTabs.length });
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}


/* ----------------------------------------------------------------
   PAGE CHIP — one tab row inside a domain card
   Title and URL are escaped; the favicon comes from Chrome's local
   _favicon endpoint so no request leaves the browser.
   ---------------------------------------------------------------- */

function renderPageChip(tab, label, count) {
  const dupeTag   = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
  const chipClass = count > 1 ? ' chip-has-dupes' : '';
  const safeUrl   = escapeHtml(tab.url || '');
  const safeLabel = escapeHtml(label);
  const icon      = tab.url ? escapeHtml(faviconUrl(tab.url, chrome.runtime.id)) : '';
  return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" title="${safeLabel}" tabindex="0">
      ${icon ? `<img class="chip-favicon" src="${icon}" alt="">` : ''}
      <span class="chip-text">${safeLabel}</span>${dupeTag}
      <div class="chip-actions">
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeLabel}" title="${t('btn.saveForLater')}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="${t('btn.closeThisTab')}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
}


/* ----------------------------------------------------------------
   OVERFLOW CHIPS ("+N more" expand button in domain cards)
   ---------------------------------------------------------------- */

function buildOverflowChips(hiddenTabs, urlCounts = {}) {
  const hiddenChips = hiddenTabs.map(tab => {
    const label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), '');
    return renderPageChip(tab, label, urlCounts[tab.url] || 1);
  }).join('');

  return `
    <div class="page-chips-overflow" style="display:none">${hiddenChips}</div>
    <div class="page-chip page-chip-overflow clickable" data-action="expand-chips">
      <span class="chip-text">${t('overflow.more', { n: hiddenTabs.length })}</span>
    </div>`;
}


/* ----------------------------------------------------------------
   DOMAIN CARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderDomainCard(group, groupIndex)
 *
 * Builds the HTML for one domain group card.
 * group = { domain: string, tabs: [{ url, title, id, windowId, active }] }
 */
function renderDomainCard(group) {
  const tabs      = group.tabs || [];
  const tabCount  = tabs.length;
  const isLanding = group.domain === '__landing-pages__';
  const stableId  = 'domain-' + group.domain.replace(/[^a-z0-9]/g, '-');
  const siteName  = escapeHtml(isLanding ? t('label.homepages') : (group.label || friendlyDomain(group.domain)));

  // Count duplicates (exact URL match)
  const urlCounts = {};
  for (const tab of tabs) urlCounts[tab.url] = (urlCounts[tab.url] || 0) + 1;
  // Extra copies that "close duplicates" would actually close (pinned copies stay)
  const totalExtras = duplicateTabIds(tabs).length;
  const hasDupes    = totalExtras > 0;

  // Just the number next to the site name; the full wording is the tooltip.
  const tabCountLabel = escapeHtml(tPlural('label.tabOpen', 'label.tabsOpen', tabCount));
  const tabBadge = `<span class="open-tabs-badge" title="${tabCountLabel}" aria-label="${tabCountLabel}">${ICONS.tabs}${tabCount}</span>`;

  const dupeBadge = hasDupes
    ? `<span class="open-tabs-badge dupe-count-badge">${tPlural('label.duplicate', 'label.duplicates', totalExtras)}</span>`
    : '';

  // Deduplicate for display: show each URL once, with (Nx) badge if duped
  const seen = new Set();
  const uniqueTabs = [];
  for (const tab of tabs) {
    if (!seen.has(tab.url)) { seen.add(tab.url); uniqueTabs.push(tab); }
  }

  const visibleTabs = uniqueTabs.slice(0, 8);
  const extraCount  = uniqueTabs.length - visibleTabs.length;

  const pageChips = visibleTabs.map(tab => {
    let label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), group.domain);
    // For localhost tabs, prepend port number so you can tell projects apart
    try {
      const parsed = new URL(tab.url);
      if (parsed.hostname === 'localhost' && parsed.port) label = `${parsed.port} ${label}`;
    } catch {}
    return renderPageChip(tab, label, urlCounts[tab.url]);
  }).join('') + (extraCount > 0 ? buildOverflowChips(uniqueTabs.slice(8), urlCounts) : '');

  // One row of buttons. When the card is too narrow, fitCardActions()
  // switches to the short labels; the full text stays in title/aria-label.
  let actionsHtml = cardActionButton({
    action: 'close-domain-tabs', domainId: stableId, className: 'close-tabs', icon: ICONS.close,
    full: tPlural('btn.closeAll', 'btn.closeAllPlural', tabCount), short: t('btn.closeAllShort', { n: tabCount }),
  }) + cardActionButton({
    action: 'collect-domain-tabs', domainId: stableId, className: 'collect', icon: ICONS.stash,
    full: t('btn.collect'), short: t('btn.collect'),
  });

  if (hasDupes) {
    actionsHtml += cardActionButton({
      action: 'dedup-keep-one', domainId: stableId, className: 'dedup-btn', icon: '',
      full: tPlural('btn.closeDupe', 'btn.closeDupePlural', totalExtras), short: t('btn.dedupShort', { n: totalExtras }),
    });
  }

  return `
    <div class="mission-card domain-card ${hasDupes ? 'has-amber-bar' : 'has-neutral-bar'}" data-domain-id="${stableId}">
      <div class="status-bar"></div>
      <div class="mission-content">
        <div class="mission-top">
          <span class="mission-name" title="${siteName}">${siteName}</span>
          ${tabBadge}
          ${dupeBadge}
        </div>
        <div class="mission-pages">${pageChips}</div>
        <div class="actions">${actionsHtml}</div>
      </div>
    </div>`;
}

function cardActionButton({ action, domainId, className, icon, full, short }) {
  const label = escapeHtml(full);
  return `<button class="action-btn ${className}" data-action="${action}" data-domain-id="${domainId}" title="${label}" aria-label="${label}">${icon}<span class="label-full">${label}</span><span class="label-short">${escapeHtml(short)}</span></button>`;
}

// Use short button labels on every card as soon as any card's full labels
// would not fit on one row, so all cards read the same way.
function fitCardActions() {
  const rows = [...document.querySelectorAll('#openTabsMissions .actions')];
  rows.forEach(row => row.classList.remove('compact'));
  const overflowing = rows.some(row => row.scrollWidth > row.clientWidth + 1);
  rows.forEach(row => row.classList.toggle('compact', overflowing));
}


/* ----------------------------------------------------------------
   SAVED FOR LATER — Render Checklist Column
   ---------------------------------------------------------------- */

/**
 * renderDeferredColumn()
 *
 * Reads saved tabs from chrome.storage.local and renders the right-side
 * "Saved for Later" checklist column. Shows active items as a checklist
 * and completed items in a collapsible archive.
 */
async function renderDeferredColumnInner() {
  const column         = document.getElementById('deferredColumn');
  const list           = document.getElementById('deferredList');
  const empty          = document.getElementById('deferredEmpty');
  const countEl        = document.getElementById('deferredCount');
  const archiveEl      = document.getElementById('deferredArchive');
  const archiveCountEl = document.getElementById('archiveCount');
  const archiveList    = document.getElementById('archiveList');

  if (!column) return;

  try {
    const { active, archived } = await getSavedTabs();

    // Hide the entire column if there's nothing to show
    if (active.length === 0 && archived.length === 0) {
      column.style.display = 'none';
      return;
    }

    column.style.display = 'block';

    // Render active checklist items
    if (active.length > 0) {
      countEl.textContent = tPlural('label.item', 'label.items', active.length);
      list.innerHTML = active.map(item => renderDeferredItem(item)).join('');
      list.style.display = 'block';
      empty.style.display = 'none';
    } else {
      list.style.display = 'none';
      countEl.textContent = '';
      empty.style.display = 'block';
    }

    // Render archive section
    if (archived.length > 0) {
      archiveCountEl.textContent = `(${archived.length})`;
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      archiveEl.style.display = 'block';
    } else {
      archiveEl.style.display = 'none';
    }

  } catch (err) {
    console.warn('[tab-out] Could not load saved tabs:', err);
    column.style.display = 'none';
  }
}

async function renderDeferredColumn() {
  await renderDeferredColumnInner();
  updateSideColumn();
}

/**
 * renderDeferredItem(item)
 *
 * Builds HTML for one active checklist item: checkbox, title link,
 * domain, time ago, dismiss button.
 */
function renderDeferredItem(item) {
  let domain = '';
  try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
  const icon = escapeHtml(faviconUrl(item.url || '', chrome.runtime.id));
  const ago = timeAgo(item.savedAt);
  const id = escapeHtml(item.id);

  return `
    <div class="deferred-item" data-deferred-id="${id}">
      <input type="checkbox" class="deferred-checkbox" data-action="check-deferred" data-deferred-id="${id}">
      <div class="deferred-info">
        <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener" class="deferred-title" title="${escapeHtml(item.title || '')}">
          <img src="${icon}" alt="" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px" class="deferred-favicon">${escapeHtml(item.title || item.url)}
        </a>
        <div class="deferred-meta">
          <span>${escapeHtml(domain)}</span>
          <span>${ago}</span>
        </div>
      </div>
      <button class="deferred-dismiss" data-action="dismiss-deferred" data-deferred-id="${id}" title="${t('btn.dismiss')}">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
    </div>`;
}

/**
 * renderArchiveItem(item)
 *
 * Builds HTML for one completed/archived item (simpler: just title + date).
 */
function renderArchiveItem(item) {
  const ago = item.completedAt ? timeAgo(item.completedAt) : timeAgo(item.savedAt);
  return `
    <div class="archive-item">
      <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener" class="archive-item-title" title="${escapeHtml(item.title || '')}">
        ${escapeHtml(item.title || item.url)}
      </a>
      <span class="archive-item-date">${ago}</span>
    </div>`;
}


/* ----------------------------------------------------------------
   MAIN DASHBOARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderStaticDashboard()
 *
 * The main render function:
 * 1. Paints greeting + date
 * 2. Fetches open tabs via chrome.tabs.query()
 * 3. Groups tabs by domain (with landing pages pulled out to their own group)
 * 4. Renders domain cards
 * 5. Updates footer stats
 * 6. Renders the "Saved for Later" checklist
 */
async function renderStaticDashboard() {
  // --- Set document language ---
  const htmlRoot = document.getElementById('htmlRoot');
  if (htmlRoot) htmlRoot.lang = _currentLocale === 'zh-CN' ? 'zh-CN' : 'en';

  // --- Localize static HTML elements ---
  const deferredTitle = document.getElementById('deferredTitle');
  if (deferredTitle) deferredTitle.textContent = t('section.savedForLater');
  const deferredEmptyText = document.getElementById('deferredEmptyText');
  if (deferredEmptyText) deferredEmptyText.textContent = t('empty.nothingSaved');
  const archiveLabel = document.getElementById('archiveLabel');
  if (archiveLabel) archiveLabel.textContent = t('btn.archive');
  const archiveSearch = document.getElementById('archiveSearch');
  if (archiveSearch) archiveSearch.placeholder = t('search.archivePlaceholder');
  const closeExtrasBtn = document.getElementById('closeExtrasBtn');
  if (closeExtrasBtn) closeExtrasBtn.textContent = t('btn.closeExtras');
  localizeSearch();

  await renderOpenTabs();

  // --- Render "Saved for Later" column ---
  await renderDeferredColumn();

  // Hide broken favicons (inline onerror blocked by extension CSP)
  document.querySelectorAll('.deferred-favicon').forEach(img => {
    img.addEventListener('error', () => { img.style.display = 'none'; }, { once: true });
  });

  // --- Render Tab Groups (OneTab) ---
  await renderTabGroups();
}

/**
 * renderOpenTabs()
 *
 * Re-reads every open tab and redraws the site cards and the header.
 * Also runs on its own whenever tabs change in any window, so it keeps
 * expanded "+N more" rows open and the keyboard focus on the same page.
 */
async function renderOpenTabs() {
  const missions = document.getElementById('openTabsMissions');
  const expanded = new Set([...missions.querySelectorAll('.page-chips-overflow')]
    .filter(overflow => overflow.style.display === 'contents')
    .map(overflow => overflow.closest('.mission-card')?.dataset.domainId));
  const focusedUrl = document.activeElement?.closest?.('#openTabsMissions .page-chip')?.dataset.tabUrl;

  // --- Fetch tabs ---
  await fetchOpenTabs();
  const realTabs = getRealTabs();

  // --- Group tabs by site (homepages first; overrides come from config.js) ---
  domainGroups = groupTabsBySite(realTabs, {
    landingPatterns: typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined' ? LOCAL_LANDING_PAGE_PATTERNS : [],
    customGroups:    typeof LOCAL_CUSTOM_GROUPS !== 'undefined' ? LOCAL_CUSTOM_GROUPS : [],
  });

  // --- Render domain cards ---
  const openTabsSection      = document.getElementById('openTabsSection');
  const openTabsMissionsEl   = document.getElementById('openTabsMissions');
  const openTabsSectionCount = document.getElementById('openTabsSectionCount');
  const openTabsSectionTitle = document.getElementById('openTabsSectionTitle');

  if (domainGroups.length > 0 && openTabsSection) {
    if (openTabsSectionTitle) openTabsSectionTitle.textContent = t('section.openTabs');
    const extraCopies = duplicateTabIds(realTabs).length;
    const summary = `${tPlural('label.tab', 'label.tabs', realTabs.length)} · ${tPlural('label.domain', 'label.domains', domainGroups.length)}`;
    openTabsSectionCount.innerHTML = `<span class="section-summary">${escapeHtml(summary)}</span>`
      + (extraCopies > 0 ? `<button class="action-btn dedup-btn" data-action="dedup-all">${escapeHtml(t('btn.dedupAll', { n: extraCopies }))}</button>` : '')
      + `<button class="action-btn collect" data-action="collect-all-tabs">${ICONS.stash}${escapeHtml(t('tabGroups.collectAll'))}</button>`
      + `<button class="action-btn close-tabs" data-action="close-all-open-tabs">${ICONS.close}${escapeHtml(t('btn.closeEverything'))}</button>`;
    openTabsMissionsEl.innerHTML = domainGroups.map(g => renderDomainCard(g)).join('');
    openTabsSection.style.display = 'block';
    fitCardActions();
  } else if (openTabsSection && !missions.querySelector('.missions-empty-state')) {
    // Keep "inbox zero" on screen once the last card has been closed.
    openTabsSection.style.display = 'none';
  }

  missions.querySelectorAll('.mission-card').forEach(card => {
    if (!expanded.has(card.dataset.domainId)) return;
    const overflow = card.querySelector('.page-chips-overflow');
    if (!overflow) return;
    overflow.style.display = 'contents';
    card.querySelector('[data-action="expand-chips"]')?.remove();
  });
  if (focusedUrl) missions.querySelector(`.page-chip[data-tab-url="${CSS.escape(focusedUrl)}"]`)?.focus();

  // Hide broken favicons (inline onerror blocked by extension CSP)
  missions.querySelectorAll('.chip-favicon').forEach(img => {
    img.addEventListener('error', () => { img.style.display = 'none'; }, { once: true });
  });

  // --- Check for duplicate Tab Out tabs ---
  checkTabOutDupes();
}

async function renderDashboard() {
  await renderStaticDashboard();
}

// The right column (stash + save-for-later) disappears when both are empty.
function updateSideColumn() {
  const side = document.getElementById('sideColumn');
  if (!side) return;
  const visible = ['tabGroupsColumn', 'deferredColumn']
    .some(id => document.getElementById(id)?.style.display === 'block');
  side.hidden = !visible;
}


/* ----------------------------------------------------------------
   CLOSE HELPERS — shared by the handlers below
   ---------------------------------------------------------------- */

function siteLabel(group) {
  return group.domain === '__landing-pages__' ? t('label.homepages') : (group.label || friendlyDomain(group.domain));
}

function findDomainGroup(domainId) {
  return domainGroups.find(g => 'domain-' + g.domain.replace(/[^a-z0-9]/g, '-') === domainId);
}

function animateChipOut(chip, { confetti = false } = {}) {
  if (!chip) return;
  if (confetti) {
    const rect = chip.getBoundingClientRect();
    shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }
  chip.classList.add('closing');
  chip.style.transition = 'opacity 0.2s, transform 0.2s';
  chip.style.opacity    = '0';
  chip.style.transform  = 'scale(0.8)';
  setTimeout(() => {
    chip.remove();
    document.querySelectorAll('.mission-card').forEach(c => {
      if (c.querySelectorAll('.page-chip[data-action="focus-tab"]').length === 0) animateCardOut(c);
    });
  }, 200);
}

// After a whole site was closed or stashed: animate its card away, unless a
// pinned tab stayed open — then re-render so the card shows what is left.
async function afterSiteClosed(card, group, result) {
  await fetchOpenTabs();
  if (result.closed > 0) playCloseSound();
  if (result.skippedPinned > 0) { await renderDashboard(); return; }
  if (card) animateCardOut(card);
  const idx = domainGroups.indexOf(group);
  if (idx !== -1) domainGroups.splice(idx, 1);
}

async function closeAndRerender(tabs, meta, message) {
  const result = await undoController.close(tabs, meta);
  if (result.closed === 0) return;
  playCloseSound();
  await renderDashboard();
  showToast(message, { undo: true });
}

// "Close all" asks once ever; after that, undo is the safety net.
async function confirmCloseAllOnce(count) {
  const { closeAllConfirmedV1 } = await chrome.storage.local.get('closeAllConfirmedV1');
  if (closeAllConfirmedV1) return true;
  if (!confirm(t('confirm.closeAll', { n: count }))) return false;
  await chrome.storage.local.set({ closeAllConfirmedV1: true });
  return true;
}


/* ----------------------------------------------------------------
   EVENT HANDLERS — using event delegation

   One listener on document handles ALL button clicks.
   Think of it as one security guard watching the whole building
   instead of one per door.
   ---------------------------------------------------------------- */

// Closing and stashing run one at a time: a double click must not close
// (or record an undo for) the same tabs twice.
const EXCLUSIVE_ACTIONS = new Set([
  'close-single-tab', 'defer-single-tab', 'collect-domain-tabs', 'close-domain-tabs',
  'dedup-keep-one', 'dedup-all', 'close-all-open-tabs', 'collect-all-tabs', 'undo-last',
]);
let actionInProgress = false;
async function exclusive(action, run) {
  if (!EXCLUSIVE_ACTIONS.has(action)) return run();
  if (actionInProgress) return;
  actionInProgress = true;
  try { await run(); } finally { actionInProgress = false; }
}

document.addEventListener('click', (e) => {
  // Walk up the DOM to find the nearest element with data-action
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;
  const action = actionEl.dataset.action;
  return exclusive(action, () => handleAction(e, actionEl, action));
});

async function handleAction(e, actionEl, action) {

  // ---- Close duplicate Tab Out tabs ----
  if (action === 'close-tabout-dupes') {
    await closeTabOutDupes();
    playCloseSound();
    const banner = document.getElementById('tabOutDupeBanner');
    if (banner) {
      banner.style.transition = 'opacity 0.4s';
      banner.style.opacity = '0';
      setTimeout(() => { banner.style.display = 'none'; banner.style.opacity = '1'; }, 400);
    }
    showToast(t('toast.closedExtras'));
    return;
  }

  const card = actionEl.closest('.mission-card');

  // ---- Expand overflow chips ("+N more") ----
  if (action === 'expand-chips') {
    const overflowContainer = actionEl.parentElement.querySelector('.page-chips-overflow');
    if (overflowContainer) {
      overflowContainer.style.display = 'contents';
      actionEl.remove();
    }
    return;
  }

  // ---- Focus a specific tab ----
  if (action === 'focus-tab') {
    const tabUrl = actionEl.dataset.tabUrl;
    if (tabUrl) await focusTab(tabUrl);
    return;
  }

  // ---- Close a single page (every open copy of this URL) ----
  if (action === 'close-single-tab') {
    e.stopPropagation(); // don't trigger parent chip's focus-tab
    const tabUrl = actionEl.dataset.tabUrl;
    if (!tabUrl) return;

    const result = await undoController.close(getRealTabs().filter(tab => tab.url === tabUrl), { kind: 'single' });
    await fetchOpenTabs();
    if (result.closed === 0) return;

    playCloseSound();
    animateChipOut(actionEl.closest('.page-chip'), { confetti: true });
    showToast(t('toast.tabClosed'), { undo: true });
    return;
  }

  // ---- Save a single tab for later (then close it) ----
  if (action === 'defer-single-tab') {
    e.stopPropagation();
    const tabUrl   = actionEl.dataset.tabUrl;
    const tabTitle = actionEl.dataset.tabTitle || tabUrl;
    if (!tabUrl) return;

    let saved;
    try {
      saved = await saveTabForLater({ url: tabUrl, title: tabTitle });
    } catch (err) {
      console.error('[tab-out] Failed to save tab:', err);
      showToast(t('toast.failedToSave'));
      return;
    }

    const result = await undoController.close(getRealTabs().filter(tab => tab.url === tabUrl), { kind: 'defer', deferredId: saved.id });
    await fetchOpenTabs();
    await renderDeferredColumn();
    // Nothing closed (pinned or already gone): keep the row and the current toast.
    if (result.closed === 0) return;
    animateChipOut(actionEl.closest('.page-chip'));
    showToast(t('toast.savedForLater'), { undo: true });
    return;
  }

  // ---- Check off a saved tab (moves it to archive) ----
  if (action === 'check-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await checkOffSavedTab(id);

    // Animate: strikethrough first, then slide out
    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('checked');
      setTimeout(() => {
        item.classList.add('removing');
        setTimeout(() => {
          item.remove();
          renderDeferredColumn(); // refresh counts and archive
        }, 300);
      }, 800);
    }
    return;
  }

  // ---- Dismiss a saved tab (removes it entirely) ----
  if (action === 'dismiss-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await dismissSavedTab(id);

    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('removing');
      setTimeout(() => {
        item.remove();
        renderDeferredColumn();
      }, 300);
    }
    return;
  }

  // ---- Collect (OneTab) a domain group ----
  if (action === 'collect-domain-tabs') {
    const domainGroup = findDomainGroup(actionEl.dataset.domainId);
    if (!domainGroup) return;
    const done = await collectTabs(domainGroup.tabs, { name: siteLabel(domainGroup) });
    if (!done) return;

    await afterSiteClosed(card, domainGroup, done.result);
    if (done.result.closed > 0) showToast(t('toast.collected', { n: done.record.tabs.length }), { undo: true });
    await renderTabGroups();
    return;
  }

  // ---- Close all tabs in a domain group ----
  if (action === 'close-domain-tabs') {
    const group = findDomainGroup(actionEl.dataset.domainId);
    if (!group) return;

    const result = await undoController.close(group.tabs, { kind: 'domain' });
    await afterSiteClosed(card, group, result);
    if (result.closed === 0) return;
    showToast(tPlural('toast.closedFrom', 'toast.closedFromPlural', result.closed, { label: siteLabel(group) }), { undo: true });
    return;
  }

  // ---- Close duplicates in one site, keep one copy ----
  if (action === 'dedup-keep-one') {
    const group = findDomainGroup(actionEl.dataset.domainId);
    if (!group) return;
    const extra = new Set(duplicateTabIds(group.tabs));
    await closeAndRerender(group.tabs.filter(tab => extra.has(tab.id)), { kind: 'dedup' }, t('toast.closedDupes'));
    return;
  }

  // ---- Close duplicates across every site and window ----
  if (action === 'dedup-all') {
    const realTabs = getRealTabs();
    const extra = new Set(duplicateTabIds(realTabs));
    await closeAndRerender(realTabs.filter(tab => extra.has(tab.id)), { kind: 'dedup' }, t('toast.closedDupes'));
    return;
  }

  // ---- Close ALL open tabs (every window; Tab Out itself stays) ----
  if (action === 'close-all-open-tabs') {
    const realTabs = getRealTabs();
    if (!(await confirmCloseAllOnce(realTabs.length))) return;

    const result = await undoController.close(realTabs, { kind: 'all' });
    await fetchOpenTabs();
    if (result.closed === 0) return;
    playCloseSound();
    if (result.skippedPinned > 0) {
      await renderDashboard();
    } else {
      document.querySelectorAll('#openTabsMissions .mission-card').forEach(c => {
        shootConfetti(
          c.getBoundingClientRect().left + c.offsetWidth / 2,
          c.getBoundingClientRect().top  + c.offsetHeight / 2
        );
        animateCardOut(c);
      });
    }
    showToast(t('toast.allClosed'), { undo: true });
    return;
  }

  // ---- Undo the last close / stash / save-for-later ----
  if (action === 'undo-last') {
    const result = await undoController.undo();
    hideToast();
    if (!result) { showToast(t('toast.undoExpired')); return; }
    const { collectedId, deferredId } = result.meta;
    // Pages Chrome refused to reopen stay where they were saved.
    if (collectedId) await keepOnlyFailedInRecord(collectedId, result.failed);
    if (deferredId && result.failed.length === 0) await removeSavedTab(deferredId);
    await renderDashboard();
    showToast(result.failed.length
      ? t('toast.undonePartial', { n: result.restored, failed: result.failed.length })
      : t('toast.undone', { n: result.restored }));
    return;
  }
}

// ---- Archive toggle — expand/collapse the archive section ----
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('#archiveToggle');
  if (!toggle) return;

  toggle.classList.toggle('open');
  const body = document.getElementById('archiveBody');
  if (body) {
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  }
});

// ---- Archive search — filter archived items as user types ----
document.addEventListener('input', async (e) => {
  if (e.target.id !== 'archiveSearch') return;

  const q = e.target.value.trim().toLowerCase();
  const archiveList = document.getElementById('archiveList');
  if (!archiveList) return;

  try {
    const { archived } = await getSavedTabs();

    if (q.length < 2) {
      // Show all archived items
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      return;
    }

    // Filter by title or URL containing the query string
    const results = archived.filter(item =>
      (item.title || '').toLowerCase().includes(q) ||
      (item.url  || '').toLowerCase().includes(q)
    );

    archiveList.innerHTML = results.map(item => renderArchiveItem(item)).join('')
      || `<div style="font-size:12px;color:var(--muted);padding:8px 0">${t('empty.noResults')}</div>`;
  } catch (err) {
    console.warn('[tab-out] Archive search failed:', err);
  }
});


/* ----------------------------------------------------------------
   STASH ("已收纳") — save a group of pages and close them, restore later.
   Records live under collectedGroupsV3 (see lib/collected-store.js).
   Restoring a whole record reopens its pages and removes the record.
   ---------------------------------------------------------------- */

const collectedStore = createCollectedStore(chrome.storage.local);

// Saves the non-pinned tabs as one record, then closes them (undoable).
// A site stash is named after the site; "stash all" keeps just its date.
async function collectTabs(tabs, { name } = {}) {
  const targets = collectableTabs(tabs);
  if (targets.length === 0) return null;
  const record = await collectedStore.add({ name, tabs: targets.map(tab => ({ url: tab.url, title: tab.title })) });
  const result = await undoController.close(targets, { kind: 'collect', collectedId: record.id });
  return { record, result };
}

async function collectAllTabs() {
  const done = await collectTabs(getRealTabs());
  if (!done) return;

  await fetchOpenTabs();
  playCloseSound();
  if (done.result.skippedPinned > 0) {
    await renderDashboard();
  } else {
    document.querySelectorAll('#openTabsMissions .mission-card').forEach(c => {
      shootConfetti(
        c.getBoundingClientRect().left + c.offsetWidth / 2,
        c.getBoundingClientRect().top + c.offsetHeight / 2
      );
      animateCardOut(c);
    });
  }

  if (done.result.closed > 0) showToast(t('toast.collected', { n: done.record.tabs.length }), { undo: true });
  await renderTabGroups();
}

// After undoing a stash: drop the record, except pages that could not be reopened.
async function keepOnlyFailedInRecord(groupId, failedUrls) {
  const record = await collectedStore.get(groupId);
  if (record) await collectedStore.replaceTabs(groupId, record.tabs.filter(page => failedUrls.includes(page.url)));
  await renderTabGroups();
}

async function openUrlSet() {
  return new Set((await chrome.tabs.query({})).map(tab => tab.url));
}

// Opens first, then removes only what opened (pages already open count as
// restored). A page Chrome refuses to open stays in the record.
async function restoreTabGroup(groupId) {
  const record = await collectedStore.get(groupId);
  if (!record) return;
  const failed = [];
  let opened = 0;
  for (const page of restoreTargets(record, await openUrlSet())) {
    try { await chrome.tabs.create({ url: page.url, active: false }); opened++; }
    catch { failed.push(page); }
  }
  await collectedStore.replaceTabs(groupId, failed);
  showToast(failed.length
    ? t('toast.restorePartial', { n: opened, failed: failed.length })
    : t('toast.restored', { n: opened }));
  await renderDashboard();
}

async function deleteTabGroup(groupId) {
  if (!(await collectedStore.remove(groupId))) return;
  showToast(t('toast.groupDeleted'));
  await renderTabGroups();
}

async function restoreSingleGroupTab(groupId, tabIdx) {
  const page = (await collectedStore.get(groupId))?.tabs[tabIdx];
  if (!page) return;
  if (!(await openUrlSet()).has(page.url)) {
    try { await chrome.tabs.create({ url: page.url, active: false }); }
    catch { showToast(t('toast.openFailed')); return; }
  }
  await collectedStore.takeTab(groupId, tabIdx);
  await renderDashboard();
}

async function renderTabGroupsInner() {
  const column   = document.getElementById('tabGroupsColumn');
  const listEl   = document.getElementById('tabGroupsList');
  const emptyEl  = document.getElementById('tabGroupsEmpty');
  const titleEl  = document.getElementById('tabGroupsTitle');
  const countEl  = document.getElementById('tabGroupsCount');
  const emptyTxt = document.getElementById('tabGroupsEmptyText');

  if (!column) return;

  if (titleEl)  titleEl.textContent  = t('collected.title');
  if (emptyTxt) emptyTxt.textContent = t('tabGroups.empty');

  const groups = await collectedStore.list();

  if (groups.length === 0) {
    column.style.display = 'none';
    return;
  }

  column.style.display = 'block';
  if (countEl) countEl.textContent = t('tabGroups.tabCount', { n: groups.reduce((s, g) => s + g.tabs.length, 0) });
  if (emptyEl) emptyEl.style.display = 'none';

  const locale = _currentLocale === 'zh-CN' ? 'zh-CN' : 'en-US';

  listEl.innerHTML = groups.map(group => {
    const groupId = escapeHtml(group.id);
    // A named record shows only the day so its row stays on one line;
    // an unnamed one is told apart by its time.
    const savedAt = new Date(group.savedAt);
    const day     = savedAt.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
    const dayTime = savedAt.toLocaleDateString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const heading = escapeHtml(group.name || dayTime);
    const meta = t('tabGroups.tabCount', { n: group.tabs.length }) + (group.name ? ` · ${escapeHtml(day)}` : '');
    const tabsHtml = group.tabs.map((tab, idx) => {
      const icon = escapeHtml(faviconUrl(tab.url, chrome.runtime.id));
      const safeTitle = escapeHtml(tab.title || tab.url || '');
      return `<div class="tab-group-tab" data-action="restore-group-tab" data-group-id="${groupId}" data-tab-idx="${idx}" title="${safeTitle}">
        <img class="tab-group-tab-favicon" src="${icon}" alt="">
        <span class="tab-group-tab-title">${safeTitle}</span>
        <button class="tab-group-tab-remove" data-action="remove-group-tab" data-group-id="${groupId}" data-tab-idx="${idx}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>`;
    }).join('');

    return `<div class="tab-group-card" data-group-id="${groupId}">
      <div class="tab-group-header" data-action="toggle-group" data-group-id="${groupId}">
        <svg class="tab-group-chevron" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
        <div class="tab-group-info">
          <div class="tab-group-date">${heading}</div>
          <div class="tab-group-count">${meta}</div>
        </div>
        <div class="tab-group-actions">
          <button class="tab-group-action restore" data-action="restore-group" data-group-id="${groupId}">${t('tabGroups.restoreAll')}</button>
          <button class="tab-group-action delete" data-action="delete-group" data-group-id="${groupId}">${t('tabGroups.delete')}</button>
        </div>
      </div>
      <div class="tab-group-tabs">${tabsHtml}</div>
    </div>`;
  }).join('');

  listEl.querySelectorAll('.tab-group-tab-favicon').forEach(img => {
    img.addEventListener('error', () => { img.style.display = 'none'; }, { once: true });
  });
}

async function renderTabGroups() {
  await renderTabGroupsInner();
  updateSideColumn();
}

// ---- Stash event handlers ----
document.addEventListener('click', async (e) => {
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;
  const action = actionEl.dataset.action;

  if (action === 'collect-all-tabs') {
    await exclusive(action, collectAllTabs);
    return;
  }

  if (action === 'toggle-group') {
    const card = document.querySelector(`.tab-group-card[data-group-id="${CSS.escape(actionEl.dataset.groupId)}"]`);
    if (card) card.classList.toggle('expanded');
    return;
  }

  if (action === 'restore-group') {
    e.stopPropagation();
    await restoreTabGroup(actionEl.dataset.groupId);
    return;
  }

  if (action === 'delete-group') {
    e.stopPropagation();
    await deleteTabGroup(actionEl.dataset.groupId);
    return;
  }

  if (action === 'restore-group-tab') {
    await restoreSingleGroupTab(actionEl.dataset.groupId, parseInt(actionEl.dataset.tabIdx, 10));
    return;
  }

  if (action === 'remove-group-tab') {
    e.stopPropagation();
    await collectedStore.takeTab(actionEl.dataset.groupId, parseInt(actionEl.dataset.tabIdx, 10));
    await renderTabGroups();
    return;
  }
});


/* ----------------------------------------------------------------
   SHORTCUTS SIDEBAR
   Custom bookmarks stored in chrome.storage.local under "shortcuts".
   Right-click context menu for edit/delete. Click "+" to add.
   ---------------------------------------------------------------- */

let _shortcuts = [];
let _ctxTargetId = null; // shortcut ID that the context menu is acting on

async function getShortcuts() {
  const { shortcuts = [] } = await chrome.storage.local.get('shortcuts');
  return shortcuts;
}

async function saveShortcuts(list) {
  await chrome.storage.local.set({ shortcuts: list });
  _shortcuts = list;
}

function renderShortcuts() {
  const listEl = document.getElementById('shortcutsList');
  if (!listEl) return;

  listEl.innerHTML = _shortcuts.map(sc => {
    let domain = '';
    try { domain = new URL(sc.url).hostname; } catch {}
    const letter = escapeHtml((sc.name || sc.url || '?').charAt(0));
    // Use Chrome's built-in favicon cache (works for intranet sites too)
    const chromeFavicon = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(sc.url)}&size=64`;
    return `<a class="shortcut-item" href="${escapeHtml(sc.url)}" data-shortcut-id="${escapeHtml(sc.id)}" title="${escapeHtml(sc.name || '')}">
      <div class="shortcut-favicon">
        <img src="${escapeHtml(chromeFavicon)}" data-letter="${letter}" alt="">
      </div>
      <span class="shortcut-name">${escapeHtml(sc.name || domain || sc.url)}</span>
    </a>`;
  }).join('');

  // Fallback to letter on error (CSP blocks inline onerror)
  listEl.querySelectorAll('.shortcut-favicon img').forEach(img => {
    img.addEventListener('error', function() {
      const span = document.createElement('span');
      span.className = 'shortcut-favicon-letter';
      span.textContent = this.dataset.letter || '?';
      this.parentElement.replaceChildren(span);
    }, { once: true });
  });
}

async function initShortcuts() {
  _shortcuts = await getShortcuts();
  renderShortcuts();

  // Localize static elements
  const addBtn = document.getElementById('shortcutAddBtn');
  if (addBtn) addBtn.title = t('shortcuts.add');
  const ctxEdit = document.getElementById('ctxEdit');
  if (ctxEdit) ctxEdit.textContent = t('shortcuts.edit');
  const ctxDelete = document.getElementById('ctxDelete');
  if (ctxDelete) ctxDelete.textContent = t('shortcuts.delete');
  const dialogNameLabel = document.getElementById('dialogNameLabel');
  if (dialogNameLabel) dialogNameLabel.textContent = t('shortcuts.name');
  const dialogUrlLabel = document.getElementById('dialogUrlLabel');
  if (dialogUrlLabel) dialogUrlLabel.textContent = t('shortcuts.url');
  const dialogCancel = document.getElementById('dialogCancel');
  if (dialogCancel) dialogCancel.textContent = t('shortcuts.cancel');
  const dialogSave = document.getElementById('dialogSave');
  if (dialogSave) dialogSave.textContent = t('shortcuts.save');
  const exportBtn = document.getElementById('shortcutExportBtn');
  if (exportBtn) exportBtn.title = t('shortcuts.export');
  const importBtn = document.getElementById('shortcutImportBtn');
  if (importBtn) importBtn.title = t('shortcuts.import');
}

/* ----------------------------------------------------------------
   EXPORT / IMPORT  —  back up shortcuts + deferred to ~/.tab-out.config
   Chrome's sandbox can't write to arbitrary paths, so export is a
   download (lands in ~/Downloads) and import reads via <input type=file>.
   ---------------------------------------------------------------- */

async function exportConfig() {
  const { shortcuts = [], deferred = [] } = await chrome.storage.local.get(['shortcuts', 'deferred']);
  const payload = buildExport({ shortcuts, deferred, collectedGroups: await collectedStore.list() });
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'tab-out.config';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(t('toast.exported'));
}

// Accepts this version's export, the original fork's file and the v2.3 backup.
// Shortcuts and saved-for-later are replaced; stash records are appended.
async function importConfig(file) {
  let parsed = null;
  try {
    parsed = parseImport(JSON.parse(await file.text()));
  } catch { /* invalid JSON */ }
  if (!parsed) {
    showToast(t('toast.importFailed'));
    return;
  }

  if (!confirm(t('confirm.import'))) return;

  const { shortcuts, deferred, collectedGroups } = parsed;
  const update = {};
  if (shortcuts) update.shortcuts = shortcuts;
  if (deferred)  update.deferred  = deferred;
  if (Object.keys(update).length) await chrome.storage.local.set(update);
  const addedGroups = collectedGroups ? await collectedStore.merge(collectedGroups) : 0;

  // Refresh UI surfaces
  if (shortcuts) {
    _shortcuts = shortcuts;
    renderShortcuts();
  }
  if (deferred)        await renderDeferredColumn();
  if (collectedGroups) await renderTabGroups();

  const n = (shortcuts?.length || 0) + (deferred?.length || 0) + addedGroups;
  showToast(tPlural('toast.imported', 'toast.importedPlural', n));
}

// ---- Dialog helpers ----
let _editingId = null; // null = adding new, string = editing existing

function openShortcutDialog(id) {
  _editingId = id || null;
  const overlay = document.getElementById('shortcutDialogOverlay');
  const nameInput = document.getElementById('dialogName');
  const urlInput = document.getElementById('dialogUrl');

  if (_editingId) {
    const sc = _shortcuts.find(s => s.id === _editingId);
    nameInput.value = sc ? sc.name : '';
    urlInput.value = sc ? sc.url : '';
  } else {
    nameInput.value = '';
    urlInput.value = '';
  }

  overlay.style.display = 'flex';
  nameInput.focus();
}

function closeShortcutDialog() {
  document.getElementById('shortcutDialogOverlay').style.display = 'none';
  _editingId = null;
}

async function saveShortcutFromDialog() {
  const name = document.getElementById('dialogName').value.trim();
  let url = document.getElementById('dialogUrl').value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  if (_editingId) {
    const sc = _shortcuts.find(s => s.id === _editingId);
    if (sc) { sc.name = name; sc.url = url; }
  } else {
    _shortcuts.push({ id: Date.now().toString(), name, url });
  }

  await saveShortcuts(_shortcuts);
  renderShortcuts();
  closeShortcutDialog();
}

// ---- Context menu ----
function showCtxMenu(x, y, shortcutId) {
  _ctxTargetId = shortcutId;
  const menu = document.getElementById('shortcutCtxMenu');
  menu.style.display = 'block';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  // Keep menu within viewport
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
  if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';
}

function hideCtxMenu() {
  document.getElementById('shortcutCtxMenu').style.display = 'none';
  _ctxTargetId = null;
}

// ---- Event listeners for shortcuts ----

// Right-click on shortcut item → context menu
document.addEventListener('contextmenu', (e) => {
  const item = e.target.closest('.shortcut-item');
  if (!item) { hideCtxMenu(); return; }
  e.preventDefault();
  showCtxMenu(e.clientX, e.clientY, item.dataset.shortcutId);
});

// Click anywhere → hide context menu
document.addEventListener('click', (e) => {
  const menu = document.getElementById('shortcutCtxMenu');
  if (menu.style.display === 'none') return;

  const ctxAction = e.target.closest('[data-ctx-action]');
  if (ctxAction) {
    const action = ctxAction.dataset.ctxAction;
    if (action === 'edit' && _ctxTargetId) {
      openShortcutDialog(_ctxTargetId);
    } else if (action === 'delete' && _ctxTargetId) {
      _shortcuts = _shortcuts.filter(s => s.id !== _ctxTargetId);
      saveShortcuts(_shortcuts);
      renderShortcuts();
    }
  }
  hideCtxMenu();
});

// Add button
document.getElementById('shortcutAddBtn')?.addEventListener('click', () => {
  openShortcutDialog(null);
});

// Export / import buttons
document.getElementById('shortcutExportBtn')?.addEventListener('click', exportConfig);
document.getElementById('shortcutImportBtn')?.addEventListener('click', () => {
  document.getElementById('shortcutImportFile')?.click();
});
document.getElementById('shortcutImportFile')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = ''; // reset so picking the same file twice still fires
  if (file) await importConfig(file);
});

// Dialog cancel
document.getElementById('dialogCancel')?.addEventListener('click', closeShortcutDialog);

// Dialog save
document.getElementById('dialogSave')?.addEventListener('click', saveShortcutFromDialog);

// Dialog overlay click → cancel
document.getElementById('shortcutDialogOverlay')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeShortcutDialog();
});

// Enter key in dialog → save
document.getElementById('dialogUrl')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveShortcutFromDialog();
});
document.getElementById('dialogName')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('dialogUrl').focus();
});

// Escape key → close dialog or context menu
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const overlay = document.getElementById('shortcutDialogOverlay');
    if (overlay.style.display !== 'none') { closeShortcutDialog(); return; }
    hideCtxMenu();
  }
});


// Enter on a focused tab row jumps to that tab, like a click.
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !e.target.matches?.('.page-chip[data-action="focus-tab"]')) return;
  e.target.click();
});

// Re-fit card buttons when the grid resizes or the bundled fonts finish loading.
if (typeof ResizeObserver !== 'undefined') {
  const missionsEl = document.getElementById('openTabsMissions');
  if (missionsEl) new ResizeObserver(() => fitCardActions()).observe(missionsEl);
}
document.fonts?.ready.then(() => fitCardActions());

// Follow tabs opened, retitled or closed in any window. Our own closes fire
// these events too, so wait until their animation has finished.
const liveRefresh = createRefreshScheduler({
  render:   renderOpenTabs,
  isHidden: () => document.hidden,
  isBusy:   () => actionInProgress || Boolean(document.querySelector('#openTabsMissions .closing')),
  onError:  err => console.warn('[tab-out] Live refresh failed:', err),
});
chrome.tabs.onCreated.addListener(liveRefresh.request);
chrome.tabs.onRemoved.addListener(liveRefresh.request);
chrome.tabs.onReplaced.addListener(liveRefresh.request);
chrome.tabs.onUpdated.addListener((_tabId, change) => {
  if ('url' in change || 'title' in change || 'pinned' in change) liveRefresh.request();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) liveRefresh.flush(); });


/* ----------------------------------------------------------------
   SEARCH — one overlay over open tabs, saved for later and the stash,
   plus bookmarks and history once the user turns them on (optional
   permissions, read only). Matching and grouping: lib/search.js.
   ---------------------------------------------------------------- */

const SEARCH_PERMISSIONS = { permissions: ['history', 'bookmarks'] };
const SEARCH_GROUP_LIMIT = 3;
// Recent visits searched locally on every keystroke; Chrome's own history
// search adds older pages for the current words.
const SEARCH_RECENT_HISTORY = 3000;

const search = {
  open: false,
  loaded: false,
  granted: false,
  sources: { tabs: [], saved: [], stash: [], bookmarks: null, history: null },
  recentHistory: [],
  currentWindowId: null,
  rows: [],              // what each rendered option stands for, by index
  selected: 0,
  expanded: new Set(),   // groups opened with "N more"
  sequence: 0,           // drops history answers that arrive after a newer keystroke
  returnFocus: null,
};

const searchEl = id => document.getElementById(id);
const searchLocale = () => (_currentLocale === 'zh-CN' ? 'zh-CN' : 'en-US');

function localizeSearch() {
  searchEl('searchTriggerLabel').textContent = t('search.trigger');
  searchEl('searchPanel').setAttribute('aria-label', t('search.trigger'));
  searchEl('searchGrantTitle').textContent = t('search.grantTitle');
  searchEl('searchGrantText').textContent = t('search.grantText');
  searchEl('searchGrantBtn').textContent = t('search.grantBtn');
}

async function loadGrantedSources() {
  const [tree, recent] = await Promise.all([
    chrome.bookmarks.getTree(),
    chrome.history.search({ text: '', startTime: 0, maxResults: SEARCH_RECENT_HISTORY }),
  ]);
  search.sources.bookmarks = flattenBookmarks(tree);
  search.recentHistory = recent;
  search.sources.history = recent;
}

async function loadSearchSources() {
  const [tabs, current, saved, stash, granted] = await Promise.all([
    chrome.tabs.query({}),
    chrome.windows.getCurrent(),
    getSavedTabs(),
    collectedStore.list(),
    chrome.permissions.contains(SEARCH_PERMISSIONS),
  ]);
  search.currentWindowId = current.id;
  search.sources.tabs = tabs
    .map(tab => ({ id: tab.id, windowId: tab.windowId, url: tab.url || tab.pendingUrl, title: tab.title }))
    .filter(tab => isRealTabUrl(tab.url));
  search.sources.saved = saved.active;
  search.sources.stash = stash;
  search.granted = granted;
  if (granted) {
    await loadGrantedSources();
  } else {
    search.sources.bookmarks = null;
    search.sources.history = null;
    search.recentHistory = [];
  }
  search.loaded = true;
}

function searchDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function searchDay(iso, withTime = false) {
  const options = withTime ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' } : { month: 'short', day: 'numeric' };
  return new Date(iso).toLocaleDateString(searchLocale(), options);
}

function visitLabel(ms) {
  if (!ms) return '';
  const when = new Date(ms);
  const time = when.toLocaleTimeString(searchLocale(), { hour: '2-digit', minute: '2-digit' });
  const bucket = dayBucket(ms);
  if (bucket === 'today') return t('search.today', { time });
  if (bucket === 'yesterday') return t('search.yesterday', { time });
  return when.toLocaleDateString(searchLocale(), { month: 'short', day: 'numeric' });
}

function searchMeta(meta, act) {
  return `<span class="search-meta">${escapeHtml(meta)}</span><span class="search-act"><kbd>↵</kbd>${escapeHtml(act)}</span>`;
}

function renderSearchItem(item, tokens) {
  if (item.kind === 'record') {
    return `<span class="search-record-icon">${ICONS.stash}</span>`
      + `<span class="search-title">${highlight(item.name, tokens)}</span>`
      + `<span class="search-domain">${escapeHtml(t('tabGroups.tabCount', { n: item.count }))}</span>`
      + searchMeta(searchDay(item.savedAt), t('search.actShow'));
  }
  const [meta, act] = {
    tab:       () => [t(item.windowId === search.currentWindowId ? 'search.thisWindow' : 'search.otherWindow'), t('search.actSwitch')],
    saved:     () => [timeAgo(item.savedAt), t('search.actOpen')],
    stashPage: () => [t('search.inRecord', { name: item.recordName || searchDay(item.savedAt, true) }), t('search.actOpen')],
    bookmark:  () => [item.path.join(' › '), t('search.actOpen')],
    history:   () => [visitLabel(item.lastVisitTime), t('search.actOpen')],
  }[item.kind]();
  return `<img class="search-favicon" src="${escapeHtml(faviconUrl(item.url, chrome.runtime.id))}" alt="">`
    + `<span class="search-title">${highlight(item.title || item.url, tokens)}</span>`
    + `<span class="search-domain">${escapeHtml(searchDomain(item.url))}</span>`
    + searchMeta(meta, act);
}

function searchOption(item, inner, className = 'search-row') {
  const index = search.rows.push(item) - 1;
  return `<div class="${className}" id="search-option-${index}" role="option" aria-selected="false" data-search-index="${index}" data-search-kind="${item.kind}">${inner}</div>`;
}

function renderSearchGroup(group, tokens) {
  const name = escapeHtml(t(`search.group.${group.key}`));
  const shown = search.expanded.has(group.key) ? group.items : group.items.slice(0, SEARCH_GROUP_LIMIT);
  const rest = group.items.length - shown.length;
  return `<div class="search-group" role="group" aria-label="${name}" data-search-group="${group.key}">`
    + `<div class="search-group-head" role="presentation"><span>${name}</span><span class="search-group-count">${group.items.length}</span></div>`
    + shown.map(item => searchOption(item, renderSearchItem(item, tokens))).join('')
    + (rest > 0 ? searchOption({ kind: 'more', group: group.key }, escapeHtml(t('search.more', { n: rest })), 'search-row search-more') : '')
    + '</div>';
}

function selectSearchRow(index) {
  const input = searchEl('searchInput');
  const previous = searchEl('searchResults').querySelector('.search-row.is-selected');
  previous?.classList.remove('is-selected');
  previous?.setAttribute('aria-selected', 'false');
  search.selected = Math.max(0, Math.min(index, search.rows.length - 1));
  const row = document.getElementById(`search-option-${search.selected}`);
  if (!row) { input.removeAttribute('aria-activedescendant'); return; }
  row.classList.add('is-selected');
  row.setAttribute('aria-selected', 'true');
  input.setAttribute('aria-activedescendant', row.id);
  row.scrollIntoView({ block: 'nearest' });
}

function renderSearch() {
  const input = searchEl('searchInput');
  const query = input.value.trim();
  const { tokens, groups } = searchAll({ query, ...search.sources });
  const scope = t(search.granted ? 'search.scopeAll' : 'search.scopeBase');
  input.placeholder = t(search.granted ? 'search.placeholderAll' : 'search.placeholder');

  searchEl('searchMessage').innerHTML = !tokens.length ? escapeHtml(t('search.hint'))
    : groups.length ? ''
    : `<div class="search-none"><b>${escapeHtml(t('search.none', { q: query }))}</b><span>${escapeHtml(t('search.noneHint', { scope }))}</span></div>`;

  search.rows = [];
  const results = searchEl('searchResults');
  results.innerHTML = groups.map(group => renderSearchGroup(group, tokens)).join('');
  results.querySelectorAll('.search-favicon').forEach(img => {
    img.addEventListener('error', () => { img.style.visibility = 'hidden'; }, { once: true });
  });
  input.setAttribute('aria-expanded', String(search.rows.length > 0));
  searchEl('searchGrant').hidden = !search.loaded || search.granted;
  searchEl('searchFoot').innerHTML = `<span><kbd>↑</kbd><kbd>↓</kbd> ${escapeHtml(t('search.keySelect'))}</span>`
    + `<span><kbd>↵</kbd> ${escapeHtml(t('search.keyOpen'))}</span>`
    + `<span><kbd>esc</kbd> ${escapeHtml(t('search.keyClose'))}</span>`
    + `<span class="search-scope">${escapeHtml(t('search.scopeLabel', { scope }))}</span>`;
  selectSearchRow(search.selected);
}

// Chrome's own history search finds older pages for the current words.
async function refreshSearchHistory() {
  const query = searchEl('searchInput').value.trim();
  const sequence = ++search.sequence;
  if (!search.granted || !query) return;
  try {
    const found = await chrome.history.search({ text: query, startTime: 0, maxResults: 200 });
    if (sequence !== search.sequence || !search.open) return;
    search.sources.history = [...search.recentHistory, ...found];
    renderSearch();
  } catch (err) {
    console.warn('[tab-out] History search failed:', err);
  }
}

async function openSearch() {
  if (search.open) { searchEl('searchInput').focus(); return; }
  search.open = true;
  search.loaded = false;
  search.returnFocus = document.activeElement;
  search.expanded.clear();
  search.selected = 0;
  const input = searchEl('searchInput');
  input.value = '';
  searchEl('searchOverlay').hidden = false;
  input.focus();
  renderSearch();
  try {
    await loadSearchSources();
  } catch (err) {
    console.warn('[tab-out] Search could not load its sources:', err);
  }
  if (!search.open) return;
  renderSearch();
  refreshSearchHistory();
}

function closeSearch() {
  if (!search.open) return;
  search.open = false;
  search.sequence++;
  searchEl('searchOverlay').hidden = true;
  searchEl('searchResults').innerHTML = '';
  search.rows = [];
  const back = search.returnFocus?.isConnected && search.returnFocus !== document.body ? search.returnFocus : null;
  search.returnFocus = null;
  back?.focus();
}

// The record may have changed since the overlay opened, so find the page by its address again.
async function openStashedPage(item) {
  const record = await collectedStore.get(item.recordId);
  const index = record ? record.tabs.findIndex(page => page.url === item.url) : -1;
  const open = (await chrome.tabs.query({})).find(tab => tab.url === item.url);
  if (open) {
    await chrome.tabs.update(open.id, { active: true });
    await chrome.windows.update(open.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: item.url, active: true });
  }
  if (index !== -1) await collectedStore.takeTab(item.recordId, index);
  await renderTabGroups();
}

function showStashRecord(recordId) {
  const card = document.querySelector(`.tab-group-card[data-group-id="${CSS.escape(recordId)}"]`);
  if (!card) return;
  card.classList.add('expanded', 'search-found');
  card.scrollIntoView({ block: 'center' });
  setTimeout(() => card.classList.remove('search-found'), 1600);
}

async function activateSearchRow(index) {
  const item = search.rows[index];
  if (!item) return;
  if (item.kind === 'more') {
    // The first newly shown result takes the place of "N more".
    search.expanded.add(item.group);
    renderSearch();
    selectSearchRow(index);
    return;
  }
  closeSearch();
  try {
    if (item.kind === 'tab') {
      await chrome.tabs.update(item.id, { active: true });
      await chrome.windows.update(item.windowId, { focused: true });
    } else if (item.kind === 'saved') {
      await chrome.tabs.create({ url: item.url, active: true });
    } else if (item.kind === 'stashPage') {
      await openStashedPage(item);
    } else if (item.kind === 'record') {
      showStashRecord(item.recordId);
    } else {
      // Bookmarks and history replace this new-tab page, like picking an address-bar suggestion.
      const current = await chrome.tabs.getCurrent();
      await chrome.tabs.update(current.id, { url: item.url });
    }
  } catch (err) {
    console.warn('[tab-out] Could not open search result:', err);
    showToast(t('toast.openFailed'));
  }
}

searchEl('searchTrigger').addEventListener('click', () => openSearch());

// "/" opens search unless the user is typing somewhere or a dialog is open.
document.addEventListener('keydown', e => {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || e.isComposing || search.open) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  if (document.getElementById('shortcutDialogOverlay').style.display !== 'none') return;
  e.preventDefault();
  openSearch();
});

searchEl('searchInput').addEventListener('input', () => {
  search.expanded.clear();
  search.selected = 0;
  renderSearch();
  refreshSearchHistory();
});

searchEl('searchInput').addEventListener('keydown', e => {
  // Enter also confirms a Chinese input method's candidate; leave that to the IME.
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    selectSearchRow(search.selected + (e.key === 'ArrowDown' ? 1 : -1));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    activateSearchRow(search.selected);
  }
});

searchEl('searchOverlay').addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeSearch();
  } else if (e.key === 'Tab') {
    // Keep the keyboard inside the dialog: the input and, when shown, the grant button.
    e.preventDefault();
    const stops = [searchEl('searchInput'), searchEl('searchGrantBtn')].filter(el => el.offsetParent !== null);
    const at = stops.indexOf(document.activeElement);
    stops[(at + (e.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus();
  }
});

searchEl('searchOverlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeSearch();
});

// Clicking a result must not take the focus away from the input.
searchEl('searchResults').addEventListener('mousedown', e => e.preventDefault());
searchEl('searchResults').addEventListener('mousemove', e => {
  const row = e.target.closest('[data-search-index]');
  if (row && Number(row.dataset.searchIndex) !== search.selected) selectSearchRow(Number(row.dataset.searchIndex));
});
searchEl('searchResults').addEventListener('click', e => {
  const row = e.target.closest('[data-search-index]');
  if (row) activateSearchRow(Number(row.dataset.searchIndex));
});

searchEl('searchGrantBtn').addEventListener('click', async () => {
  let granted = false;
  try {
    granted = await chrome.permissions.request(SEARCH_PERMISSIONS);
  } catch (err) {
    console.warn('[tab-out] Permission request failed:', err);
  }
  if (!search.open) return;
  if (granted) {
    try {
      await loadGrantedSources();
      search.granted = true;
    } catch (err) {
      console.warn('[tab-out] Bookmarks and history could not be read:', err);
    }
    renderSearch();
    refreshSearchHistory();
  }
  searchEl('searchInput').focus();
});


/* ----------------------------------------------------------------
   INITIALIZE
   ---------------------------------------------------------------- */
initShortcuts();
// Copy the owner's v2.3 projects into stash records once, then render.
migrateLegacy(chrome.storage.local)
  .catch(err => console.warn('[tab-out] Migration skipped:', err))
  .finally(() => renderDashboard());
