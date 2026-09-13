'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  aliasesFromText,
  targetHostFromTemplate,
  createPlatformSettingsController,
  validationErrorField,
  handleDialogKeydown,
} = require('../../extension/src/ui/search-platform-settings.js');
const { validateSearchPlatforms } = require('../../extension/src/services/platform-search-service.js');

test('aliasesFromText accepts comma and line separated aliases and removes blanks', () => {
  assert.deepEqual(aliasesFromText(' yq, yuque\n语雀 ， docs '), ['yq', 'yuque', '语雀', 'docs']);
});

test('targetHostFromTemplate reports the actual HTTPS destination', () => {
  assert.equal(targetHostFromTemplate('https://search.example.com/find?q={Query}'), 'search.example.com');
  assert.equal(targetHostFromTemplate('not a url'), '');
});

test('saving a form delegates validation and persistence to the repository', async () => {
  const saved = [];
  const repository = {
    async list() { return [{ id: 'one', name: 'Existing', aliases: [], domain: 'existing.test', searchUrlTemplate: 'https://existing.test/?q={Query}' }]; },
    async save(platforms) { saved.push(platforms); return platforms; },
  };
  const controller = createPlatformSettingsController(repository, { randomUUID: () => 'new-id' });

  await controller.load();
  await controller.saveForm({ name: 'Yuque', aliases: 'yq, yuque', domain: 'yuque.com', searchUrlTemplate: 'https://www.yuque.com/search?q={Query}' });

  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0][1], {
    id: 'new-id', name: 'Yuque', aliases: ['yq', 'yuque'], domain: 'yuque.com',
    searchUrlTemplate: 'https://www.yuque.com/search?q={Query}',
  });
});

test('adding rereads storage and preserves platforms created after the modal loaded', async () => {
  let current = [];
  const repository = {
    async list() { return structuredClone(current); },
    async save(platforms) { current = structuredClone(platforms); return structuredClone(platforms); },
  };
  const controller = createPlatformSettingsController(repository, { randomUUID: () => 'mine' });
  await controller.load();
  current.push({ id: 'other', name: 'Other', aliases: [], domain: 'other.test', searchUrlTemplate: 'https://other.test/?q={Query}' });

  await controller.saveForm({ name: 'Mine', aliases: '', domain: 'mine.test', searchUrlTemplate: 'https://mine.test/?q={Query}' });

  assert.deepEqual(current.map(item => item.id), ['other', 'mine']);
});

test('saving uses repository compare-and-save to reject a race after the reread', async () => {
  let current = [];
  const repository = {
    async list() { return structuredClone(current); },
    async save(platforms, expected) {
      current = [{ id: 'racer', name: 'Racer', aliases: [], domain: 'racer.test', searchUrlTemplate: 'https://racer.test/?q={Query}' }];
      if (JSON.stringify(current) !== JSON.stringify(expected)) throw new Error('searchPlatformsV1: stale configuration');
      current = structuredClone(platforms);
      return current;
    },
  };
  const controller = createPlatformSettingsController(repository, { randomUUID: () => 'mine' });
  await controller.load();

  await assert.rejects(() => controller.saveForm({ name: 'Mine', aliases: '', domain: 'mine.test', searchUrlTemplate: 'https://mine.test/?q={Query}' }), /stale/i);
  assert.deepEqual(current.map(item => item.id), ['racer']);
});

test('editing refuses to recreate a record changed after the modal loaded', async () => {
  const original = { id: 'one', name: 'Original', aliases: [], domain: 'one.test', searchUrlTemplate: 'https://one.test/?q={Query}' };
  let current = [structuredClone(original)];
  const repository = {
    async list() { return structuredClone(current); },
    async save(platforms) { current = structuredClone(platforms); return structuredClone(platforms); },
  };
  const controller = createPlatformSettingsController(repository);
  await controller.load();
  current[0].name = 'Changed elsewhere';

  await assert.rejects(() => controller.saveForm({ ...original, name: 'My edit' }, 'one'), /stale/i);
  assert.equal(current[0].name, 'Changed elsewhere');
});

test('deleting refuses when the target changed after the modal loaded', async () => {
  const original = { id: 'one', name: 'Original', aliases: [], domain: 'one.test', searchUrlTemplate: 'https://one.test/?q={Query}' };
  let current = [structuredClone(original)];
  const repository = {
    async list() { return structuredClone(current); },
    async save(platforms) { current = structuredClone(platforms); return structuredClone(platforms); },
  };
  const controller = createPlatformSettingsController(repository);
  await controller.load();
  current[0].domain = 'changed.test';

  await assert.rejects(() => controller.delete('one'), /stale/i);
  assert.equal(current.length, 1);
});

test('testing a form opens only a valid explicit platform query and never saves', async () => {
  let saveCount = 0;
  const opened = [];
  const repository = { async list() { return []; }, async save() { saveCount += 1; } };
  const parse = (text, platforms) => ({ kind: 'platform', platform: platforms[0], query: 'hello', url: `https://target.test/?q=${encodeURIComponent(text.split(' ').slice(1).join(' '))}` });
  const controller = createPlatformSettingsController(repository, {
    randomUUID: () => 'test-id', validateSearchPlatforms, parsePlatformQuery: parse, openUrl: url => opened.push(url),
  });

  await controller.load();
  await controller.testForm({ name: 'Test', aliases: 't', domain: 'display.test', searchUrlTemplate: 'https://target.test/?q={Query}' }, 'hello world');

  assert.deepEqual(opened, ['https://target.test/?q=hello%20world']);
  assert.equal(saveCount, 0);
});

test('testing an invalid template reports validation and does not open a tab', async () => {
  const opened = [];
  const controller = createPlatformSettingsController({ async list() { return []; }, async save(value) { return value; } }, {
    randomUUID: () => 'test-id', validateSearchPlatforms, openUrl: url => opened.push(url),
  });
  await controller.load();

  await assert.rejects(() => controller.testForm({ name: 'Unsafe', aliases: '', domain: 'safe.test', searchUrlTemplate: 'https://user:pass@safe.test/?q={Query}' }, 'hello'), /searchUrlTemplate/);
  assert.deepEqual(opened, []);
});

test('testing uses the normalized URL template returned by validation', async () => {
  const opened = [];
  const controller = createPlatformSettingsController({ async list() { return []; }, async save(value) { return value; } }, {
    randomUUID: () => 'test-id', validateSearchPlatforms, openUrl: url => opened.push(url),
  });
  await controller.load();

  await controller.testForm({
    name: 'Search', aliases: '', domain: 'example.test',
    searchUrlTemplate: 'https://example.test/?q=｛Ｑｕｅｒｙ｝',
  }, '中文 & #');

  assert.deepEqual(opened, ['https://example.test/?q=%E4%B8%AD%E6%96%87%20%26%20%23']);
});

test('stale mutation refreshes the controller cache before rethrowing', async () => {
  const original = { id: 'one', name: 'Original', aliases: [], domain: 'one.test', searchUrlTemplate: 'https://one.test/?q={Query}' };
  const changed = { ...original, name: 'Changed elsewhere' };
  let reads = 0;
  const repository = {
    async list() { reads += 1; return reads === 1 ? [structuredClone(original)] : [structuredClone(changed)]; },
    async save() { throw new Error('searchPlatformsV1: stale configuration'); },
  };
  const controller = createPlatformSettingsController(repository);
  await controller.load();

  await assert.rejects(() => controller.saveForm({ name: 'Mine', aliases: '', domain: 'one.test', searchUrlTemplate: 'https://one.test/?q={Query}' }, 'one'), /stale/i);
  assert.equal(controller.list()[0].name, 'Changed elsewhere');
});

test('validationErrorField maps template errors to the rendered template field', () => {
  assert.equal(validationErrorField(new Error('platforms[0].searchUrlTemplate: must contain exactly one placeholder')), 'template');
  assert.equal(validationErrorField(new Error('platforms[0].aliases[1]: conflicts with Other')), 'aliases');
});

test('modal key handling stops Tab from reaching the legacy document trap', () => {
  const calls = [];
  const first = { offsetParent: {}, focus() { calls.push('first'); } };
  const last = { offsetParent: {}, focus() { calls.push('last'); } };
  const dialog = { querySelectorAll() { return [first, last]; } };
  const event = { key: 'Tab', shiftKey: false, preventDefault() { calls.push('prevent'); }, stopPropagation() { calls.push('stop'); } };

  handleDialogKeydown(event, dialog, last, () => calls.push('close'));

  assert.deepEqual(calls, ['stop', 'prevent', 'first']);
});

test('confirming import reruns preview against current data before one atomic save', async () => {
  const previews = [];
  const saves = [];
  const repository = {
    async list() { return []; },
    async previewImport(payload) {
      previews.push(payload);
      return { platforms: [{ id: `merged-${previews.length}` }], added: [], conflicts: [] };
    },
    async save(platforms) { saves.push(platforms); return platforms; },
  };
  const controller = createPlatformSettingsController(repository);
  const payload = { version: 1, platforms: [{ name: 'Imported' }] };

  await controller.previewImport(payload);
  await controller.confirmImport();

  assert.equal(previews.length, 2);
  assert.deepEqual(saves, [[{ id: 'merged-2' }]]);
});

test('canceling import clears pending data without writing', async () => {
  let saveCount = 0;
  const repository = {
    async list() { return []; },
    async previewImport() { return { platforms: [], added: [], conflicts: [] }; },
    async save() { saveCount += 1; },
  };
  const controller = createPlatformSettingsController(repository);

  await controller.previewImport({ version: 1, platforms: [] });
  controller.cancelImport();
  await assert.rejects(() => controller.confirmImport(), /No import is pending/);
  assert.equal(saveCount, 0);
});

test('changed import preview requires another confirmation and does not write', async () => {
  let previewCount = 0;
  let saveCount = 0;
  const repository = {
    async list() { return []; },
    async previewImport() {
      previewCount += 1;
      return { platforms: [], added: previewCount === 1 ? ['First'] : [], conflicts: previewCount === 1 ? [] : ['First'] };
    },
    async save() { saveCount += 1; },
  };
  const controller = createPlatformSettingsController(repository);
  const first = await controller.previewImport({ version: 1, platforms: [] });

  const refreshed = await controller.confirmImport(first);

  assert.equal(refreshed.needsReview, true);
  assert.equal(saveCount, 0);
});
