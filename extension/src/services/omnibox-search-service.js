(function initOmniboxSearch(globalScope) {
  'use strict';
  const core = typeof require === 'function' ? {
    ...require('./search-service.js'), ...require('./unified-search-service.js'), ...require('./platform-search-service.js'),
  } : globalScope.TabOutCore;
  const escape = value => String(value || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  function installOmniboxSearch(chromeApi, options) {
    let generation = 0;
    let selected = new Map();
    const zh = chromeApi.i18n?.getUILanguage().startsWith('zh');
    const copy = zh
      ? { switch:'切换', search:'搜索', query:'请输入搜索词', window:'窗口', empty:'搜索已打开标签，或输入平台名称和搜索词', failed:'搜索失败，请在 Tab Out 中重试' }
      : { switch:'Switch', search:'Search', query:'Enter search words', window:'Window', empty:'Search open tabs, or enter a platform and query', failed:'Search failed. Retry in Tab Out' };
    chromeApi.omnibox.setDefaultSuggestion?.({description:escape(copy.empty)});
    chromeApi.omnibox.onInputChanged.addListener(async (text, suggest) => {
      const ticket = ++generation;
      selected = new Map();
      try {
        const [platforms,tabs,advanced] = await Promise.all([options.platforms.list(),chromeApi.tabs.query({}),options.advancedItems()]);
        if (ticket !== generation) return;
        const command = core.parsePlatformQuery(text, platforms);
        let records;
        if (command.kind === 'platform') {
          records = [{type:'platform',title:command.platform.name,url:command.url,query:command.query,platform:command.platform}];
        } else {
          const platformItems = core.findSearchPlatforms(text,platforms).map(platform => ({type:'platform',title:platform.name,platform,query:''}));
          const matches = core.createSearchIndex([...core.openTabSearchItems(tabs),...advanced]).search(text,{limit:5});
          records = [...matches,...platformItems].slice(0,5);
        }
        const suggestions = records.map((record,index) => {
          const token = `tabout-action:${ticket}:${index}`;
          selected.set(token,record);
          const action = record.type === 'open' ? `${copy.switch} · ${copy.window} ${record.windowId} · ${record.duplicateCount}×`
            : record.type === 'platform' ? (record.url ? copy.search : copy.query) : copy.search;
          return {content:token,description:`<match>${escape(record.title)}</match> <dim>${escape(action)} — ${escape(record.url || record.platform?.domain || '')}</dim>`};
        });
        chromeApi.omnibox.setDefaultSuggestion?.({description:escape(command.kind === 'platform' ? `${command.platform.name} · ${command.query ? copy.search : copy.query}` : copy.empty)});
        suggest(suggestions);
      } catch {
        if (ticket !== generation) return;
        chromeApi.omnibox.setDefaultSuggestion?.({description:escape(copy.failed)});
        suggest([]);
      }
    });
    chromeApi.omnibox.onInputEntered.addListener(async text => {
      const record = selected.get(text);
      ++generation;
      selected = new Map();
      try {
        if (record) {
          if (record.type === 'platform' && !record.url) await options.openDashboard(`${record.platform.name} `);
          else await core.activateSearchResult(record,chromeApi);
          return;
        }
        if (text.startsWith('tabout-action:')) { await options.openDashboard('', 'search.stale'); return; }
        const command = core.parsePlatformQuery(text,await options.platforms.list());
        if (command.kind === 'platform' && command.url) await core.activateSearchResult({type:'platform',url:command.url},chromeApi);
        else await options.openDashboard(text);
      } catch (error) {
        await options.openDashboard('',error.message === 'search.stale' ? 'search.stale' : 'search.failed');
      }
    });
    chromeApi.omnibox.onInputCancelled.addListener(() => { ++generation; selected = new Map(); });
  }
  const api = {installOmniboxSearch};
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {},api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
