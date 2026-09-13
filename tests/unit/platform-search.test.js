'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  findSearchPlatforms,
  parsePlatformQuery,
  validateSearchPlatforms,
} = require('../../extension/src/services/platform-search-service.js');
const { createSearchPlatformRepository } = require('../../extension/src/storage/search-platform-repository.js');

const yuque = {
  id: 'yuque',
  name: '语雀',
  aliases: ['yuque', 'yq'],
  domain: 'yuque.com',
  searchUrlTemplate: 'https://example.com/search?q={Query}',
};

function memoryStorage(initial = {}) {
  let state = structuredClone(initial);
  let writes = 0;
  return {
    async get(key) { return { [key]: structuredClone(state[key]) }; },
    async set(update) { state = { ...state, ...structuredClone(update) }; writes += 1; },
    snapshot() { return structuredClone(state); },
    writes() { return writes; },
  };
}

test('platform aliases parse only at a whitespace command boundary and encode the query', () => {
  const platforms = validateSearchPlatforms([yuque]);
  assert.equal(parsePlatformQuery('yqdocs', platforms).kind, 'tabs');
  assert.deepEqual(parsePlatformQuery('  YQ  中文 & #  ', platforms), {
    kind: 'platform',
    platform: platforms[0],
    query: '中文 & #',
    url: 'https://example.com/search?q=%E4%B8%AD%E6%96%87%20%26%20%23',
  });
  assert.deepEqual(parsePlatformQuery('语雀', platforms), {
    kind: 'platform', platform: platforms[0], query: '', url: null,
  });
});

test('platform parsing uses NFKC matching and the longest complete prefix', () => {
  const platforms = validateSearchPlatforms([
    yuque,
    { id: 'docs', name: 'YQ Docs', aliases: ['ｄｏｃｓ'], domain: 'docs.example.com', searchUrlTemplate: 'https://docs.example.com/{Query}' },
  ]);
  const result = parsePlatformQuery('ｙｑ　ｄｏｃｓ　 Keep  Inner  Space ', platforms);
  assert.equal(result.platform.id, 'docs');
  assert.equal(result.query, 'Keep  Inner  Space');
  assert.equal(result.url, 'https://docs.example.com/Keep%20%20Inner%20%20Space');
});

test('platform parsing normalizes combining sequences without changing the original query', () => {
  const platforms = validateSearchPlatforms([{
    id: 'cafe', name: 'Café', aliases: [], domain: 'cafe.internal',
    searchUrlTemplate: 'https://cafe.internal/search?q={Query}',
  }]);
  const result = parsePlatformQuery('Cafe\u0301 Keep  Inner', platforms);
  assert.equal(result.kind, 'platform');
  assert.equal(result.query, 'Keep  Inner');
  assert.equal(result.url, 'https://cafe.internal/search?q=Keep%20%20Inner');
});

test('unknown text remains a tab query and partial tokens return platform suggestions', () => {
  const platforms = validateSearchPlatforms([yuque]);
  assert.deepEqual(parsePlatformQuery('', platforms), { kind: 'tabs', query: '' });
  assert.deepEqual(parsePlatformQuery('payments integration', platforms), { kind: 'tabs', query: 'payments integration' });
  assert.deepEqual(findSearchPlatforms('', platforms), []);
  assert.deepEqual(findSearchPlatforms('YU', platforms).map(item => item.id), ['yuque']);
  assert.deepEqual(findSearchPlatforms('unknown', platforms), []);
});

test('validation normalizes fields and merges duplicate aliases within one platform', () => {
  const [platform] = validateSearchPlatforms([{
    ...yuque,
    name: '  ＹＵＱＵＥ  ',
    aliases: [' yq ', 'ＹＱ', 'Yuque'],
    domain: ' YUQUE.COM ',
    searchUrlTemplate: ' https://example.com/search?q={Query} ',
  }]);
  assert.deepEqual(platform, {
    id: 'yuque', name: 'YUQUE', aliases: ['yq'], domain: 'yuque.com',
    searchUrlTemplate: 'https://example.com/search?q={Query}',
  });
});

test('validation permits a static fragment when the placeholder is in the query', () => {
  const [platform] = validateSearchPlatforms([{
    ...yuque,
    searchUrlTemplate: 'https://example.com/search?q={Query}#results',
  }]);
  assert.equal(parsePlatformQuery('yq docs', [platform]).url, 'https://example.com/search?q=docs#results');
});

test('validation accepts internal and internationalized hostnames and stores URL-compatible ASCII', () => {
  const platforms = validateSearchPlatforms([
    { ...yuque, id: 'wiki', name: 'Wiki', aliases: ['w'], domain: 'wiki' },
    { ...yuque, id: 'local', name: 'Local', aliases: ['l'], domain: 'localhost' },
    { ...yuque, id: 'idn', name: 'IDN', aliases: ['i'], domain: '例子.测试' },
  ]);
  assert.deepEqual(platforms.map(item => item.domain), ['wiki', 'localhost', 'xn--fsqu00a.xn--0zwm56d']);
  for (const domain of ['a..com', '-a.com', 'a-.com', 'example%2ecom', 'example.com\\path']) {
    assert.throws(() => validateSearchPlatforms([{ ...yuque, domain }]), /platforms\[0\]\.domain/);
  }
});

test('template validation does not confuse literal marker text with the query placeholder', () => {
  const template = 'https://tab-out-query-marker.example/search/tab-out-query-marker?q={Query}';
  const [platform] = validateSearchPlatforms([{ ...yuque, searchUrlTemplate: template }]);
  assert.equal(platform.searchUrlTemplate, template);
});

test('validation rejects unsafe or misplaced search templates with field-specific errors', () => {
  const badTemplates = [
    'javascript:alert({Query})',
    'https://user:pass@example.com/?q={Query}',
    'https://{Query}.example.com/search',
    'https://example.com/search#{Query}',
    'https://example.com/search?q={Query}&again={Query}',
    'https://example.com/search',
  ];
  for (const searchUrlTemplate of badTemplates) {
    assert.throws(() => validateSearchPlatforms([{ ...yuque, searchUrlTemplate }]), /platforms\[0\]\.searchUrlTemplate/);
  }
});

test('validation enforces limits, control characters, domains and cross-platform command collisions', () => {
  assert.throws(() => validateSearchPlatforms(new Array(101).fill(yuque)), /platforms/);
  assert.throws(() => validateSearchPlatforms([{ ...yuque, name: 'x'.repeat(81) }]), /platforms\[0\]\.name/);
  assert.throws(() => validateSearchPlatforms([{ ...yuque, aliases: new Array(21).fill('alias') }]), /platforms\[0\]\.aliases/);
  assert.throws(() => validateSearchPlatforms([{ ...yuque, aliases: ['bad\nname'] }]), /platforms\[0\]\.aliases\[0\]/);
  assert.throws(() => validateSearchPlatforms([{ ...yuque, domain: 'https://yuque.com/path' }]), /platforms\[0\]\.domain/);
  assert.throws(() => validateSearchPlatforms([yuque, { ...yuque, id: 'other', name: 'Other', aliases: ['ＹＱ'] }]), /platforms\[1\]\.aliases\[0\]/);
  assert.throws(() => validateSearchPlatforms([yuque, { ...yuque, name: 'Other', aliases: ['other'] }]), /platforms\[1\]\.id/);
});

test('repository treats missing storage as empty and validates before a single atomic write', async () => {
  const storage = memoryStorage();
  const repository = createSearchPlatformRepository(storage);
  assert.deepEqual(await repository.list(), []);
  const saved = await repository.save([yuque]);
  assert.deepEqual(await repository.list(), saved);
  assert.equal(storage.writes(), 1);
  await assert.rejects(() => repository.save([{ ...yuque, name: '' }]), /platforms\[0\]\.name/);
  assert.equal(storage.writes(), 1);
  assert.deepEqual(storage.snapshot().searchPlatformsV1, saved);
});

test('repository reports corrupt stored configuration and never replaces it during save', async () => {
  const storage = memoryStorage({ searchPlatformsV1: { malformed: true } });
  const repository = createSearchPlatformRepository(storage);
  await assert.rejects(() => repository.list(), /platforms: must be an array/);
  await assert.rejects(() => repository.save([yuque]), /platforms: must be an array/);
  assert.deepEqual(storage.snapshot().searchPlatformsV1, { malformed: true });
  assert.equal(storage.writes(), 0);
});

test('repository compare-and-save rejects a stale full-list write without erasing newer data', async () => {
  const initial = validateSearchPlatforms([yuque]);
  const storage = memoryStorage({ searchPlatformsV1: initial });
  const first = createSearchPlatformRepository(storage);
  const second = createSearchPlatformRepository(storage);
  const firstSnapshot = await first.list();
  const staleSnapshot = await second.list();
  const github = { id: 'github', name: 'GitHub', aliases: ['gh'], domain: 'github.com', searchUrlTemplate: 'https://github.com/search?q={Query}' };
  const google = { id: 'google', name: 'Google', aliases: ['g'], domain: 'google.com', searchUrlTemplate: 'https://google.com/search?q={Query}' };

  await first.save([...firstSnapshot, github], firstSnapshot);
  await assert.rejects(() => second.save([...staleSnapshot, google], staleSnapshot), /stale configuration/i);
  assert.deepEqual((await first.list()).map(item => item.id), ['yuque', 'github']);
  assert.equal(storage.writes(), 1);
});

test('repository serializes concurrent compare-and-save operations across instances', async () => {
  const initial = validateSearchPlatforms([yuque]);
  const storage = memoryStorage({ searchPlatformsV1: initial });
  const first = createSearchPlatformRepository(storage);
  const second = createSearchPlatformRepository(storage);
  const github = { id: 'github', name: 'GitHub', aliases: ['gh'], domain: 'github.com', searchUrlTemplate: 'https://github.com/search?q={Query}' };
  const google = { id: 'google', name: 'Google', aliases: ['g'], domain: 'google.com', searchUrlTemplate: 'https://google.com/search?q={Query}' };

  const results = await Promise.allSettled([
    first.save([...initial, github], initial),
    second.save([...initial, google], initial),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), ['fulfilled', 'rejected']);
  assert.equal((await first.list()).length, 2);
  assert.equal(storage.writes(), 1);
});

test('repository uses a cross-context Web Lock when one is available', async () => {
  const storage = memoryStorage();
  const lockCalls = [];
  const locks = {
    async request(name, callback) {
      lockCalls.push(name);
      assert.equal(storage.writes(), 0);
      return callback();
    },
  };
  const repository = createSearchPlatformRepository(storage, { locks });
  await repository.save([yuque], []);
  assert.deepEqual(lockCalls, ['tab-out:searchPlatformsV1']);
  assert.equal(storage.writes(), 1);
});

test('repository previews valid imports, keeping local entries when ids or commands conflict', async () => {
  const local = validateSearchPlatforms([yuque])[0];
  const storage = memoryStorage({ searchPlatformsV1: [local] });
  const repository = createSearchPlatformRepository(storage);
  const preview = await repository.previewImport({ version: 1, platforms: [
    { id: 'github', name: 'GitHub', aliases: ['gh'], domain: 'github.com', searchUrlTemplate: 'https://github.com/search?q={Query}' },
    { id: 'other-id', name: 'Conflicting alias', aliases: ['YQ'], domain: 'example.org', searchUrlTemplate: 'https://example.org/{Query}' },
    { ...yuque, name: 'Same id', aliases: ['same-id'] },
  ] });
  assert.deepEqual(preview.added, ['GitHub']);
  assert.deepEqual(preview.conflicts, ['Conflicting alias', 'Same id']);
  assert.deepEqual(preview.platforms.map(item => item.id), ['yuque', 'github']);
  assert.equal(storage.writes(), 0);
  await repository.save(preview.platforms);
  assert.deepEqual((await repository.export()), { version: 1, platforms: preview.platforms });
});

test('repository rejects malformed import payloads and invalid imported platforms', async () => {
  const repository = createSearchPlatformRepository(memoryStorage());
  await assert.rejects(() => repository.previewImport({ version: 2, platforms: [] }), /format/i);
  await assert.rejects(() => repository.previewImport({ version: 1, platforms: [{ ...yuque, searchUrlTemplate: 'file:///{Query}' }] }), /searchUrlTemplate/);
});
