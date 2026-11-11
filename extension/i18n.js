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
    'label.domain':           '{n} domain',
    'label.domains':          '{n} domains',
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
    'confirm.import':         'Replace current shortcuts and saved tabs with imported data?',

    // Tab Groups (OneTab)
    'collected.title':        'Stashed',
    'tabGroups.collectAll':   'Collect all',
    'tabGroups.restoreAll':   'Restore all',
    'tabGroups.delete':       'Delete',
    'tabGroups.tabCount':     '{n} tabs',
    'tabGroups.empty':        'No saved groups.',
    'toast.collected':        'Collected {n} tabs',
    'toast.restored':         'Restored {n} tabs',
    'toast.groupDeleted':     'Group deleted',
    'btn.undo':               'Undo',
    'btn.dedupAll':           'Close {n} duplicates',
    'toast.undone':           'Reopened {n} tabs',
    'toast.undoExpired':      'Nothing to undo',
    'confirm.closeAll':       'Close all {n} tabs in every window? You can undo for 30 seconds.',
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
    'label.domain':           '{n} 个域名',
    'label.domains':          '{n} 个域名',
    'label.item':             '{n} 项',
    'label.items':            '{n} 项',
    'label.openTabs':         '打开的标签页',

    // Buttons
    'btn.closeAll':           '关闭全部 {n} 个标签页',
    'btn.closeAllPlural':     '关闭全部 {n} 个标签页',
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
    'confirm.import':         '是否用导入的数据替换当前书签与保存项？',

    // Tab Groups (OneTab)
    'collected.title':        '已收纳',
    'tabGroups.collectAll':   '一键收纳',
    'tabGroups.restoreAll':   '全部恢复',
    'tabGroups.delete':       '删除',
    'tabGroups.tabCount':     '{n} 个标签页',
    'tabGroups.empty':        '暂无收纳。',
    'toast.collected':        '已收纳 {n} 个标签页',
    'toast.restored':         '已恢复 {n} 个标签页',
    'toast.groupDeleted':     '已删除标签页组',
    'btn.undo':               '撤销',
    'btn.dedupAll':           '关闭 {n} 个重复',
    'toast.undone':           '已重新打开 {n} 个标签页',
    'toast.undoExpired':      '没有可撤销的操作',
    'confirm.closeAll':       '关闭所有窗口中的全部 {n} 个标签页？30 秒内可以撤销。',
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
