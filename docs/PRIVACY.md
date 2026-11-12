# Tab Out Privacy Policy

Last updated: 2026-11-12 (version 3.0.0)

Tab Out replaces Chrome's new tab page with a view of your open tabs grouped by site. It reads your open tabs (titles and addresses) only to show them, close them, stash them and reopen them when you ask.

**Search.** Searching looks through your open tabs, saved-for-later items and stashed groups on this device. If you click Turn on in the search panel, Chrome asks whether Tab Out may also read your bookmarks and browsing history; Tab Out then reads them on this device only while you search, never changes them, and never stores or sends them anywhere. Turn off, in the same panel, gives both permissions back to Chrome.

**What is stored, and where.** Saved-for-later items, stashed tab groups, and your shortcuts are kept in `chrome.storage.local` on this device. Nothing is synced or uploaded by Tab Out.

**Network.** The Tab Out page makes no network requests. Site icons come from Chrome's own local favicon cache (`_favicon`). Fonts ship inside the extension. There is no analytics, telemetry, advertising, account, licence check, or AI service.

**Permissions.** `tabs` (to list, focus, close and reopen tabs), `storage` (to keep your lists on this device), and `favicon` (to show site icons from Chrome's cache). Optional `history` and `bookmarks` are requested only when you turn on searching them, and are only read. There are no host permissions.

**Your control.** Export writes a `tab-out.config` file to your Downloads folder only when you click Export. You can delete any saved or stashed item from the page. Uninstalling the extension lets Chrome remove its local data, so export first if you want to keep it.

**Data left by older versions.** If you used Tab Out 2.x on this device, data it created (projects, snapshots, browsing memory) may still exist in this extension's local storage. Version 3 copies 2.x projects into stashed groups once and never sends any of this data anywhere. It does not read the rest.
