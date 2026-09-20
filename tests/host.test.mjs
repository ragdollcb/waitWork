import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStorage, onlineID } from '../src/lib/host.js';

const bookPath = '/Book/19/19392/';
const online = { id: onlineID(bookPath), kind: 'online', source: 'biquge001', bookPath, chapterPath: `${bookPath}13590539.html`, title: '在线小说', position: 12 };

test('混合书架只上传本地正文，恢复在线元数据而不加载全部章节', async () => {
  let saved;
  const chunks = new Map();
  const methods = [];
  globalThis.window = { dbxPlugin: { ready: Promise.resolve(), async invoke(method, params) {
    methods.push(method);
    if (method === 'reader/load') return saved || { revision: 0, data: null };
    if (method === 'reader/chunk-put') { const hash = `hash${chunks.size}`; chunks.set(hash, params.text); return { hash }; }
    if (method === 'reader/chunk-get') return { text: chunks.get(params.hash) };
    if (method === 'reader/save') { saved = { revision: params.revision + 1, data: params.data }; return { revision: saved.revision }; }
    throw new Error(`非预期请求 ${method}`);
  } } };
  try {
    const storage = createStorage();
    assert.equal(await storage.load(), null);
    await storage.save({ books: [{ id: 'local', title: '本地小说', text: '第一章\n测试正文', position: 0 }, online], activeId: online.id, settings: {} });
    assert.equal(chunks.size, 1);
    assert.deepEqual(saved.data.books[1], online);
    const restored = await createStorage().load();
    assert.equal(restored.activeId, online.id);
    assert.equal(restored.books[0].text, '第一章\n测试正文');
    assert.deepEqual(restored.books[1], online);
    assert.ok(!methods.some(method => method.startsWith('source/')));
    await storage.save({ ...restored, books: restored.books.map(book => ({ ...book, position: 1 })) });
    assert.equal(chunks.size, 1);
  } finally { delete globalThis.window; }
});

test('纯在线书架恢复、旧书架兼容和损坏数据保护', async () => {
  let books = [online];
  globalThis.window = { dbxPlugin: { ready: Promise.resolve(), async invoke() { return { revision: 1, data: { books, activeId: online.id, settings: {} } }; } } };
  try {
    assert.equal((await createStorage().load()).books[0].chapterPath, online.chapterPath);
    books = [{ ...online, chapterPath: '/Book/1/2/123.html' }];
    await assert.rejects(createStorage().load(), /在线书籍信息无效/);
    books = [online, online];
    await assert.rejects(createStorage().load(), /书架信息无效/);
  } finally { delete globalThis.window; }
});
