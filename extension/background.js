/**
 * background.js — Service Worker for Badge Updates and the Search Shortcut
 *
 * Chrome's "always-on" background script for Tab Out.
 * It keeps the toolbar badge showing the current open tab count, and answers
 * the search shortcut (see openSearchFromShortcut below).
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

// ─── Search shortcut ─────────────────────────────────────────────────────────

/**
 * openSearchFromShortcut(tab)
 *
 * On a fresh new tab the cursor sits in the address bar, so the page never hears
 * "/". The manifest command reaches us wherever the cursor is. A page loaded by
 * the extension gets the keyboard, so Tab Out is loaded with ?search: in place of
 * a tab that already shows Tab Out (a new tab, typically), otherwise next to the
 * current tab. index.html opens search and drops ?search from the address.
 */
async function openSearchFromShortcut(tab) {
  const page = chrome.runtime.getURL('index.html');
  const url = `${page}?search`;
  const address = tab?.url || '';
  try {
    if (tab && (address === 'chrome://newtab/' || address.startsWith(page))) {
      await chrome.tabs.update(tab.id, { url });
    } else {
      await chrome.tabs.create(tab ? { url, index: tab.index + 1, windowId: tab.windowId } : { url });
    }
  } catch (err) {
    console.warn('[tab-out] Search shortcut could not open Tab Out:', err);
  }
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'open-search') openSearchFromShortcut(tab);
});

// ─── Initial run ─────────────────────────────────────────────────────────────

// Run once immediately when the service worker first loads
updateBadge();
