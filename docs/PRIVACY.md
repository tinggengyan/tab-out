# Tab Out Privacy Policy

Last updated: 2026-11-02

Tab Out reads open browser tabs only to display, organize, save, search, close, and restore them at the user's request. Tab titles, URLs, workspaces, snapshots, rules, and saved items remain in browser-local storage by default.

Browsing Memory is off initially. Enabling it requests optional access to ordinary HTTP/HTTPS pages and records loaded reading text, title, address and capture/visit timestamps in local IndexedDB. This can include signed-in and internal websites that the user and browser permit the extension to access. Form inputs, editable drafts and hidden reading regions are excluded by the extractor, but extraction is not a guarantee of complete or sensitive-content-free text. The feature does not collect passwords, browser cookies or session credentials. Importing existing browser history separately requests the optional history permission and imports metadata; it cannot reconstruct old page bodies.

Users may configure an OpenAI-compatible model endpoint, model name and optional API key. A connection test sends a generic test prompt. An explicit AI search sends the query for search-term expansion. If the user explicitly allows candidate content for that search, bounded candidate titles, addresses and excerpts can be sent to the configured endpoint for ranking; summarizing selected results sends bounded source excerpts. These may include private or internal content. The selected service's own data policies apply. Recording alone never calls a model, and Tab Out does not use a built-in third-party AI proxy. Model credentials remain in trusted extension-local settings, are not returned to page scripts and are excluded from both memory exports and ordinary backups; they are not protected by an operating-system credential vault.

The current memory budget is 5,000 records and 32 MiB, with a default 90-day retention and a 30,000-character per-page text limit. Older records may be removed to meet the budget. Pause stops future recording; exclusions prevent future capture for the specified host and subdomains but do not delete existing records. Clear memory pauses recording and removes stored memory; individual deletion blocks re-capture from that same still-open document. Visiting the page again can create a new record. While history permission is granted, observed browser-history deletion also removes matching memory records; the feature also provides its own explicit deletion controls.

Browsing Memory has a separate JSON export/import that can contain private text. The ordinary configuration backup does not include this IndexedDB archive. Export is a user-requested download, not an automatic external backup. Uninstalling the extension can remove both local memory and other extension data.

Tab Out does not sell personal data, display advertising, inject affiliate links, or send browsing content to an analytics service. The extension contains no remote executable code. A pasted signed entitlement is verified locally. When a customer enters a payment-provider license key, only that key and a random device identifier are sent to Tab Out's license endpoint, which validates it with Lemon Squeezy and returns a signed entitlement. No URL, title, search term, workspace, or snapshot is included. Opening a checkout page is an explicit user action and is governed by the checkout provider's privacy policy.

Users can export their portable data backup at any time and can delete individual records, empty the trash, clear extension storage, or uninstall the extension. Uninstalling may cause Chrome to remove local extension data, so users should export a backup first.

Optional encrypted sync is not included in this release. If it is introduced, it will be opt-in and this policy will be updated before launch.

Support contact: configure the public support email before store submission.
