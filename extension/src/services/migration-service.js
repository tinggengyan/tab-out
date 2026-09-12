(function initMigrationService(globalScope) {
  'use strict';
  const schema = typeof require === 'function'
    ? require('../storage/schema.js')
    : globalScope.TabOutCore;

  async function runStorageMigration(storageArea, options = {}) {
    if (!storageArea?.get || !storageArea?.set) throw new TypeError('A storage area is required');
    const keys = ['storageMeta', 'deferred', 'shortcuts', 'tabGroups'];
    const current = await storageArea.get(keys);
    if (current.storageMeta?.schemaVersion >= schema.CURRENT_SCHEMA_VERSION) {
      return { migrated: false, version: current.storageMeta.schemaVersion };
    }

    const backup = {
      deferred: Array.isArray(current.deferred) ? current.deferred : [],
      shortcuts: Array.isArray(current.shortcuts) ? current.shortcuts : [],
      tabGroups: Array.isArray(current.tabGroups) ? current.tabGroups : [],
    };
    await storageArea.set({ migrationBackupV1: backup });
    const migrated = schema.migrateLegacyState(backup, { deviceId: options.deviceId || 'local' });
    await storageArea.set({
      storageMeta: {
        ...migrated.meta,
        installedAt: current.storageMeta?.installedAt || new Date().toISOString(),
        migratedAt: new Date().toISOString(),
      },
      deferred: migrated.deferred,
      shortcuts: migrated.shortcuts,
      sessionsV2: migrated.sessions,
    });
    return { migrated: true, version: schema.CURRENT_SCHEMA_VERSION };
  }
  const api = { runStorageMigration };
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
