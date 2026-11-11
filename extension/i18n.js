/* ================================================================
   Tab Out — Internationalization (i18n)

   Simple locale system: auto-detects browser language, provides
   a t(key, params) function for all user-facing strings.
   Supports English (default) and Simplified Chinese.
   ================================================================ */

'use strict';

const I18N_LOCALES = {
  en: {
    // Greetings
    'greeting.morning':       'Good morning',
    'greeting.afternoon':     'Good afternoon',
    'greeting.evening':       'Good evening',

    // Time ago
    'time.justNow':           'just now',
    'time.minAgo':            '{n} min ago',
    'time.hrAgo':             '{n} hr ago',
    'time.hrsAgo':            '{n} hrs ago',
    'time.yesterday':         'yesterday',
    'time.daysAgo':           '{n} days ago',

    // Section headers
    'section.rightNow':       'Right now',
    'section.openTabs':       'Open tabs',
    'section.savedForLater':  'Saved for later',

    // Labels & badges
    'label.homepages':        'Homepages',
    'label.tabOpen':          '{n} tab open',
    'label.tabsOpen':         '{n} tabs open',
    'label.duplicate':        '{n} duplicate',
    'label.duplicates':       '{n} duplicates',
    'label.domain':           '{n} site',
    'label.domains':          '{n} sites',
    'label.item':             '{n} item',
    'label.items':            '{n} items',
    'label.openTabs':         'Open tabs',

    // Buttons
    'btn.closeAll':           'Close all {n} tab',
    'btn.closeAllPlural':     'Close all {n} tabs',
    'btn.closeDupe':          'Close {n} duplicate',
    'btn.closeDupePlural':    'Close {n} duplicates',
    'btn.closeExtras':        'Close extras',
    'btn.saveForLater':       'Save for later',
    'btn.closeThisTab':       'Close this tab',
    'btn.dismiss':            'Dismiss',
    'btn.archive':            'Archive',

    // Empty states
    'empty.inboxZero':        'Inbox zero, but for tabs.',
    'empty.youAreFree':       "You're free.",
    'empty.nothingSaved':     'Nothing saved. Living in the moment.',
    'empty.noResults':        'No results',
    'empty.zeroDomains':      '0 domains',

    // Toast messages
    'toast.closedExtras':     'Closed extra Tab Out tabs',
    'toast.tabClosed':        'Tab closed',
    'toast.savedForLater':    'Saved for later',
    'toast.failedToSave':     'Failed to save tab',
    'toast.closedFrom':       'Closed {n} tab from {label}',
    'toast.closedFromPlural': 'Closed {n} tabs from {label}',
    'toast.closedDupes':      'Closed duplicates, kept one copy each',
    'toast.allClosed':        'All tabs closed. Fresh start.',

    // Dupe banner
    'banner.dupeText':        'You have <strong>{n}</strong> Tab Out tabs open. Keep just this one?',

    // Overflow
    'overflow.more':          '+{n} more',

    // Search
    'search.archivePlaceholder': 'Search archived tabs...',

    // Smart titles
    'title.postBy':           'Post by @{user}',
    'title.issue':            '{repo} Issue #{n}',
    'title.pr':               '{repo} PR #{n}',
    'title.youtubeVideo':     'YouTube Video',
    'title.redditPost':       'r/{sub} post',
    'title.substack':         "{name}'s Substack",
    'title.githubPages':      '{name} (GitHub Pages)',

    // Shortcuts
    'shortcuts.add':          'Add shortcut',
    'shortcuts.edit':         'Edit',
    'shortcuts.delete':       'Delete',
    'shortcuts.name':         'Name',
    'shortcuts.url':          'URL',
    'shortcuts.save':         'Save',
    'shortcuts.cancel':       'Cancel',
    'shortcuts.export':       'Export to tab-out.config',
    'shortcuts.import':       'Import from tab-out.config',
    'toast.exported':         'Exported — saved to Downloads/tab-out.config',
    'toast.imported':         'Imported {n} item',
    'toast.importedPlural':   'Imported {n} items',
    'toast.importFailed':     'Import failed: invalid file',
    'confirm.import':         'Replace current shortcuts and saved tabs with imported data? Stashed groups are added, not replaced.',

    // Tab Groups (OneTab)
    'collected.title':        'Stashed',
    'tabGroups.collectAll':   'Stash all',
    'tabGroups.restoreAll':   'Restore all',
    'tabGroups.delete':       'Delete',
    'tabGroups.tabCount':     '{n} tabs',
    'tabGroups.empty':        'No saved groups.',
    'toast.collected':        'Stashed {n} tabs',
    'toast.restored':         'Restored {n} tabs',
    'toast.groupDeleted':     'Group deleted',
    'btn.undo':               'Undo',
    'toast.restorePartial':   'Restored {n} tabs; {failed} could not be opened and stay stashed',
    'toast.undonePartial':    'Reopened {n} tabs; {failed} could not be opened',
    'toast.openFailed':       'This page could not be opened',
    'btn.closeAllShort':      'Close {n}',
    'btn.closeEverything':    'Close all',
    'btn.collect':            'Stash',
    'btn.dedupShort':         'Dedupe {n}',
    'label.tab':              '{n} tab',
    'label.tabs':             '{n} tabs',
    'btn.dedupAll':           'Close {n} duplicates',
    'toast.undone':           'Reopened {n} tabs',
    'toast.undoExpired':      'Nothing to undo',
    'confirm.closeAll':       'Close all {n} tabs in every window? You can undo for 30 seconds.',

    // Search
    'search.trigger':         'Search',
    'search.placeholder':     'Search open tabs, saved for later and stash',
    'search.placeholderAll':  'Search tabs, saved for later, stash, bookmarks and history',
    'search.hint':            'Type a word from a page title or web address.',
    'search.group.tabs':      'Open tabs',
    'search.group.saved':     'Saved for later',
    'search.group.stash':     'Stashed',
    'search.group.bookmarks': 'Bookmarks',
    'search.group.history':   'History',
    'search.more':            '{n} more',
    'search.thisWindow':      'This window',
    'search.otherWindow':     'Other window',
    'search.inRecord':        'In “{name}”',
    'search.today':           'Today {time}',
    'search.yesterday':       'Yesterday {time}',
    'search.actSwitch':       'Switch to tab',
    'search.actOpen':         'Open',
    'search.actShow':         'Show in stash',
    'search.grantTitle':      'Also search bookmarks and history',
    'search.grantText':       'Chrome asks you once. Tab Out reads them on this device and never uploads them.',
    'search.grantBtn':        'Turn on',
    'search.grantFailed':     'Chrome did not open the permission prompt ({reason}). If Tab Out was just updated, reload it in chrome://extensions and try again.',
    'search.none':            'Nothing found for “{q}”',
    'search.noneHint':        'Searched {scope}. Try a shorter word or a site name.',
    'search.scopeBase':       'open tabs, saved for later and stash',
    'search.scopeAll':        'open tabs, saved for later, stash, bookmarks and history',
    'search.scopeLabel':      'Searching {scope}',
    'search.keySelect':       'select',
    'search.keyOpen':         'open',
    'search.keyClose':        'close',
  },

  'zh-CN': {
    // Greetings
    'greeting.morning':       '早上好',
    'greeting.afternoon':     '下午好',
    'greeting.evening':       '晚上好',

    // Time ago
    'time.justNow':           '刚刚',
    'time.minAgo':            '{n} 分钟前',
    'time.hrAgo':             '{n} 小时前',
    'time.hrsAgo':            '{n} 小时前',
    'time.yesterday':         '昨天',
    'time.daysAgo':           '{n} 天前',

    // Section headers
    'section.rightNow':       '当前',
    'section.openTabs':       '打开的标签页',
    'section.savedForLater':  '稍后查看',

    // Labels & badges
    'label.homepages':        '首页',
    'label.tabOpen':          '{n} 个标签页',
    'label.tabsOpen':         '{n} 个标签页',
    'label.duplicate':        '{n} 个重复',
    'label.duplicates':       '{n} 个重复',
    'label.domain':           '{n} 个站点',
    'label.domains':          '{n} 个站点',
    'label.item':             '{n} 项',
    'label.items':            '{n} 项',
    'label.openTabs':         '打开的标签页',

    // Buttons
    'btn.closeAll':           '关闭全部 {n} 个',
    'btn.closeAllPlural':     '关闭全部 {n} 个',
    'btn.closeDupe':          '关闭 {n} 个重复',
    'btn.closeDupePlural':    '关闭 {n} 个重复',
    'btn.closeExtras':        '关闭多余标签页',
    'btn.saveForLater':       '稍后查看',
    'btn.closeThisTab':       '关闭此标签页',
    'btn.dismiss':            '移除',
    'btn.archive':            '归档',

    // Empty states
    'empty.inboxZero':        '标签页清零，清爽如新。',
    'empty.youAreFree':       '自由了。',
    'empty.nothingSaved':     '暂无保存，活在当下。',
    'empty.noResults':        '无结果',
    'empty.zeroDomains':      '0 个域名',

    // Toast messages
    'toast.closedExtras':     '已关闭多余的 Tab Out 标签页',
    'toast.tabClosed':        '标签页已关闭',
    'toast.savedForLater':    '已保存至稍后查看',
    'toast.failedToSave':     '保存失败',
    'toast.closedFrom':       '已关闭 {label} 的 {n} 个标签页',
    'toast.closedFromPlural': '已关闭 {label} 的 {n} 个标签页',
    'toast.closedDupes':      '已关闭重复标签页，各保留一个',
    'toast.allClosed':        '全部标签页已关闭，焕然一新。',

    // Dupe banner
    'banner.dupeText':        '你打开了 <strong>{n}</strong> 个 Tab Out 标签页，只保留这一个？',

    // Overflow
    'overflow.more':          '还有 {n} 个',

    // Search
    'search.archivePlaceholder': '搜索已归档标签页…',

    // Smart titles
    'title.postBy':           '@{user} 的帖子',
    'title.issue':            '{repo} Issue #{n}',
    'title.pr':               '{repo} PR #{n}',
    'title.youtubeVideo':     'YouTube 视频',
    'title.redditPost':       'r/{sub} 帖子',
    'title.substack':         '{name} 的 Substack',
    'title.githubPages':      '{name} (GitHub Pages)',

    // Shortcuts
    'shortcuts.add':          '添加快捷方式',
    'shortcuts.edit':         '编辑',
    'shortcuts.delete':       '删除',
    'shortcuts.name':         '名称',
    'shortcuts.url':          '链接',
    'shortcuts.save':         '保存',
    'shortcuts.cancel':       '取消',
    'shortcuts.export':       '导出到 tab-out.config',
    'shortcuts.import':       '从 tab-out.config 导入',
    'toast.exported':         '已导出到 Downloads/tab-out.config',
    'toast.imported':         '已导入 {n} 项',
    'toast.importedPlural':   '已导入 {n} 项',
    'toast.importFailed':     '导入失败：文件无效',
    'confirm.import':         '是否用导入的数据替换当前书签与稍后查看？收纳记录会追加，不会被替换。',

    // Tab Groups (OneTab)
    'collected.title':        '已收纳',
    'tabGroups.collectAll':   '全部收纳',
    'tabGroups.restoreAll':   '全部恢复',
    'tabGroups.delete':       '删除',
    'tabGroups.tabCount':     '{n} 个标签页',
    'tabGroups.empty':        '暂无收纳。',
    'toast.collected':        '已收纳 {n} 个标签页',
    'toast.restored':         '已恢复 {n} 个标签页',
    'toast.groupDeleted':     '已删除标签页组',
    'btn.undo':               '撤销',
    'toast.restorePartial':   '已恢复 {n} 个标签页；{failed} 个无法打开，仍保留在收纳中',
    'toast.undonePartial':    '已重新打开 {n} 个标签页；{failed} 个无法打开',
    'toast.openFailed':       '这个页面无法打开',
    'btn.closeAllShort':      '关闭 {n}',
    'btn.closeEverything':    '关闭全部',
    'btn.collect':            '收纳',
    'btn.dedupShort':         '去重 {n}',
    'label.tab':              '{n} 个标签页',
    'label.tabs':             '{n} 个标签页',
    'btn.dedupAll':           '关闭 {n} 个重复',
    'toast.undone':           '已重新打开 {n} 个标签页',
    'toast.undoExpired':      '没有可撤销的操作',
    'confirm.closeAll':       '关闭所有窗口中的全部 {n} 个标签页？30 秒内可以撤销。',

    // 搜索
    'search.trigger':         '搜索',
    'search.placeholder':     '搜索打开的标签页、稍后查看和收纳',
    'search.placeholderAll':  '搜索标签页、稍后查看、收纳、书签和历史记录',
    'search.hint':            '输入标题或网址里的词。',
    'search.group.tabs':      '打开的标签页',
    'search.group.saved':     '稍后查看',
    'search.group.stash':     '已收纳',
    'search.group.bookmarks': '书签',
    'search.group.history':   '历史记录',
    'search.more':            '还有 {n} 条',
    'search.thisWindow':      '本窗口',
    'search.otherWindow':     '其他窗口',
    'search.inRecord':        '在“{name}”里',
    'search.today':           '今天 {time}',
    'search.yesterday':       '昨天 {time}',
    'search.actSwitch':       '切换过去',
    'search.actOpen':         '打开',
    'search.actShow':         '在右栏展开',
    'search.grantTitle':      '也搜索书签和历史记录',
    'search.grantText':       '需要在 Chrome 里授权一次。Tab Out 只在本机读取，不会上传。',
    'search.grantBtn':        '开启',
    'search.grantFailed':     'Chrome 没有打开授权窗口（{reason}）。如果刚更新过 Tab Out，请在 chrome://extensions 重新加载它，再点开启。',
    'search.none':            '没有找到“{q}”',
    'search.noneHint':        '已搜索：{scope}。可以换个短一点的词，或者搜网站名。',
    'search.scopeBase':       '打开的标签页、稍后查看、已收纳',
    'search.scopeAll':        '打开的标签页、稍后查看、已收纳、书签、历史记录',
    'search.scopeLabel':      '范围：{scope}',
    'search.keySelect':       '选择',
    'search.keyOpen':         '打开',
    'search.keyClose':        '关闭',
  },
};

// Detect locale from multiple sources (any zh-* variant maps to zh-CN)
function _detectLocale() {
  // 1. Chrome extension API (most reliable in extension context)
  try {
    const chromeLang = chrome.i18n.getUILanguage().toLowerCase();
    if (chromeLang.startsWith('zh')) return 'zh-CN';
  } catch { /* not in extension context */ }

  // 2. navigator.languages — full preference list (includes OS language)
  const langs = navigator.languages || [];
  for (const lang of langs) {
    if (lang.toLowerCase().startsWith('zh')) return 'zh-CN';
  }

  // 3. navigator.language — single primary language
  const primary = (navigator.language || '').toLowerCase();
  if (primary.startsWith('zh')) return 'zh-CN';

  return 'en';
}
const _currentLocale = _detectLocale();

/**
 * t(key, params)
 *
 * Look up a localized string by key. Supports {placeholder} interpolation.
 *   t('toast.closedFrom', { n: 3, label: 'GitHub' })
 *   → "Closed 3 tabs from GitHub"  (en)
 *   → "已关闭 GitHub 的 3 个标签页"  (zh-CN)
 */
function t(key, params) {
  const str = (I18N_LOCALES[_currentLocale] && I18N_LOCALES[_currentLocale][key])
           || I18N_LOCALES.en[key]
           || key;
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (_, k) => params[k] !== undefined ? params[k] : `{${k}}`);
}

/**
 * tPlural(singularKey, pluralKey, n, params)
 *
 * Convenience for English singular/plural. Chinese doesn't need this
 * (same form for both), but it keeps the caller simple.
 */
function tPlural(singularKey, pluralKey, n, extraParams) {
  const key = (_currentLocale === 'en' && n === 1) ? singularKey : pluralKey;
  return t(key, { n, ...extraParams });
}
