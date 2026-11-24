/**
 * background.js — Service Worker for the Badge, Tab Out Home and Search
 *
 * Chrome's "always-on" background script for Tab Out.
 * It keeps the toolbar badge up to date, reuses the Tab Out page across windows,
 * and answers the search shortcut.
 *
 * Since we no longer have a server, we query chrome.tabs directly.
 * The badge counts real web tabs (skipping chrome:// and extension pages).
 *
 * Color coding gives a quick at-a-glance health signal:
 *   Green  (#3d7a4a) → 1–10 tabs  (focused, manageable)
 *   Amber  (#b8892e) → 11–20 tabs (getting busy)
 *   Red    (#b35a5a) → 21+ tabs   (time to cull!)
 */

// ─── Badge updater ────────────────────────────────────────────────────────────

/**
 * updateBadge()
 *
 * Counts open real-web tabs and updates the extension's toolbar badge.
 * "Real" tabs = not chrome://, not extension pages, not about:blank.
 */
async function updateBadge() {
  try {
    const tabs = await chrome.tabs.query({});

    // Only count actual web pages — skip browser internals and extension pages
    const count = tabs.filter(t => {
      const url = t.url || '';
      return (
        !url.startsWith('chrome://') &&
        !url.startsWith('chrome-extension://') &&
        !url.startsWith('about:') &&
        !url.startsWith('edge://') &&
        !url.startsWith('brave://')
      );
    }).length;

    // Don't show "0" — an empty badge is cleaner
    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });

    if (count === 0) return;

    // Pick badge color based on workload level
    let color;
    if (count <= 10) {
      color = '#3d7a4a'; // Green — you're in control
    } else if (count <= 20) {
      color = '#b8892e'; // Amber — things are piling up
    } else {
      color = '#b35a5a'; // Red — time to focus and close some tabs
    }

    await chrome.action.setBadgeBackgroundColor({ color });

  } catch {
    // If something goes wrong, clear the badge rather than show stale data
    chrome.action.setBadgeText({ text: '' });
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────

// Update badge when the extension is first installed
chrome.runtime.onInstalled.addListener(() => {
  updateBadge();
});

// Update badge when Chrome starts up
chrome.runtime.onStartup.addListener(() => {
  updateBadge();
});

// Update badge whenever a tab is opened
chrome.tabs.onCreated.addListener(() => {
  updateBadge();
});

// Update badge whenever a tab is closed
chrome.tabs.onRemoved.addListener(() => {
  updateBadge();
});

// Update badge when a tab's URL changes (e.g. navigating to/from chrome://)
chrome.tabs.onUpdated.addListener(() => {
  updateBadge();
});

// ─── Tab Out home ───────────────────────────────────────────────────────────

const homePage = chrome.runtime.getURL('index.html');
const newTabPage = 'chrome://newtab/';
const homeTabIds = new Map();
let homeOperations = Promise.resolve();

function queueHomeOperation(operation) {
  // A burst of new tabs and the search command can arrive at the same time.
  homeOperations = homeOperations.then(operation).catch(err => {
    console.warn('[tab-out] Could not switch to Tab Out:', err);
  });
  return homeOperations;
}

function isHomePage(url) {
  return url?.split(/[?#]/, 1)[0] === homePage;
}

async function findHomeTabs(incognito) {
  const [tabs, contexts] = await Promise.all([
    chrome.tabs.query({}),
    chrome.runtime.getContexts?.({ contextTypes: ['TAB'], frameIds: [0], incognito }),
  ]);
  // Chrome reports the New Tab override as chrome://newtab/ in the Tabs API.
  // Confirm it hosts our extension page when extension contexts are available.
  const overrideIds = new Set(contexts?.filter(context => isHomePage(context.documentUrl)).map(context => context.tabId));
  const rememberedId = homeTabIds.get(incognito);
  return tabs.filter(tab => {
    const url = tab.pendingUrl || tab.url;
    return tab.incognito === incognito &&
      (isHomePage(url) ||
        (url === newTabPage && (!contexts || tab.id === rememberedId || overrideIds.has(tab.id))));
  });
}

async function focusHome(tab) {
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

async function reuseHome(source) {
  const homes = await findHomeTabs(source.incognito);
  const opened = homes.find(tab => tab.id === source.id);
  if (!opened) return;

  const existing = homes.filter(tab => tab.id !== source.id);
  const keep = homes.find(tab => tab.id === homeTabIds.get(source.incognito)) ||
    existing.find(tab => tab.pinned) || existing.find(tab => tab.status === 'complete') ||
    existing[0] || opened;
  homeTabIds.set(source.incognito, keep.id);
  const extras = homes.filter(tab => tab.id !== keep.id);
  if (extras.length === 0) return;

  if (extras.some(tab => tab.active)) {
    await focusHome(keep);
  }
  // Do this in sequence so closing several copies in a window always leaves
  // its last tab in place.
  for (const tab of extras) {
    const selected = await chrome.tabs.get(keep.id);
    const selectedUrl = selected.pendingUrl || selected.url;
    if (selectedUrl !== newTabPage && !isHomePage(selectedUrl)) return;

    const inWindow = await chrome.tabs.query({ windowId: tab.windowId });
    const current = inWindow.find(item => item.id === tab.id);
    const url = current?.pendingUrl || current?.url;
    // A user can commit a web address while the new tab is still loading.
    if (url !== newTabPage && !isHomePage(url)) continue;
    if (inWindow.length === 1) {
      // Closing its last tab would close the entire browser window.
      await chrome.tabs.update(tab.id, { url: 'about:blank' });
    } else {
      await chrome.tabs.remove(tab.id);
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === 'tab-out-home-ready' && sender.frameId === 0 &&
      sender.tab && isHomePage(sender.url)) {
    queueHomeOperation(() => reuseHome(sender.tab));
  }
});

// ─── Search shortcut ────────────────────────────────────────────────────────

function openSearchFromShortcut(tab) {
  return queueHomeOperation(async () => {
    const url = `${homePage}?search`;
    const incognito = tab?.incognito ?? false;
    const homes = await findHomeTabs(incognito);
    const home = homes.find(item => item.id === homeTabIds.get(incognito)) ||
      homes.find(item => item.id === tab?.id) || homes[0];
    if (home) {
      // Navigation gives the page keyboard focus even from the native New Tab.
      homeTabIds.set(incognito, home.id);
      await chrome.tabs.update(home.id, { url, active: true });
      await chrome.windows.update(home.windowId, { focused: true });
    } else if (tab?.url === newTabPage) {
      await chrome.tabs.update(tab.id, { url });
    } else {
      await chrome.tabs.create(tab ? { url, index: tab.index + 1, windowId: tab.windowId } : { url });
    }
  });
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'open-search') openSearchFromShortcut(tab);
});

// ─── Initial run ─────────────────────────────────────────────────────────────

// Run once immediately when the service worker first loads
updateBadge();
