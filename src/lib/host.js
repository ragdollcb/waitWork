import { parseArchive } from '../reader.mjs';

export async function invoke(method, params = {}) {
  const bridge = window.dbxPlugin;
  if (!bridge) throw new Error('请在 DBX 或 npm run preview 开发预览中打开，自动保存需要本地后端。');
  await bridge.ready;
  return bridge.invoke(method, params, { timeoutMs: 15000 });
}

// 正文只在导入时上传；滚动和设置变化只更新小体积书架索引。
export function createStorage() {
  let revision = 0;
  let texts = new Map();
  return {
    async load() {
      const saved = await invoke('reader/load');
      revision = saved.revision;
      texts = new Map();
      if (!saved.data) return null;
      const books = [];
      for (const book of saved.data.books) {
        if (book.kind === 'online') { books.push(validateOnlineBook(book)); continue; }
        let text = '';
        for (const hash of book.chunks) text += (await invoke('reader/chunk-get', { hash })).text;
        texts.set(book.id, { text, chunks: book.chunks });
        books.push({ ...book, text });
      }
      const local = parseArchive(JSON.stringify({ ...saved.data, books: books.filter(book => book.kind !== 'online'), format: 'xidu', version: 1 }));
      const locals = new Map(local.books.map(book => [book.id, book]));
      const ids = new Set(books.map(book => book.id));
      if (books.length > 20 || ids.size !== books.length || (books.length && !ids.has(saved.data.activeId))) throw new Error('书架信息无效，请保留本地数据并检查文件。');
      return { books: books.map(book => book.kind === 'online' ? book : locals.get(book.id)), activeId: saved.data.activeId, settings: local.settings };
    },
    async save(state) {
      const books = [];
      const nextTexts = new Map();
      for (const book of state.books) {
        if (book.kind === 'online') { books.push(validateOnlineBook(book)); continue; }
        let cached = texts.get(book.id);
        if (cached?.text !== book.text) {
          const chunks = [];
          for (let start = 0; start < book.text.length;) {
            let end = Math.min(start + 128 * 1024, book.text.length);
            const last = book.text.charCodeAt(end - 1);
            if (end < book.text.length && last >= 0xD800 && last <= 0xDBFF) end--;
            chunks.push((await invoke('reader/chunk-put', { text: book.text.slice(start, end) })).hash);
            start = end;
          }
          cached = { text: book.text, chunks };
        }
        nextTexts.set(book.id, cached);
        books.push({ id: book.id, title: book.title, position: book.position, chunks: cached.chunks });
      }
      const result = await invoke('reader/save', { revision, data: { books, activeId: state.activeId, settings: state.settings } });
      revision = result.revision;
      texts = nextTexts;
    },
  };
}

export function onlineID(path) { return `biquge001-${path.replace(/^\/+|\/+$/g, '').replaceAll('/', '-')}`; }

export function validateOnlineBook(book) {
  if (book.source !== 'biquge001' || !/^\/Book\/\d{1,8}\/\d{1,12}\/$/.test(book.bookPath)
    || book.id !== onlineID(book.bookPath) || typeof book.title !== 'string' || !book.title.trim() || book.title.length > 200
    || !/^\/Book\/\d{1,8}\/\d{1,12}\/[1-9]\d{0,15}\.html$/.test(book.chapterPath) || !book.chapterPath.startsWith(book.bookPath)
    || !Number.isInteger(book.position) || book.position < 0 || book.position > 2 * 1024 * 1024) throw new Error('在线书籍信息无效，请保留本地数据并检查文件。');
  const { id, title, source, bookPath, chapterPath, position } = book;
  return { id, title, kind: 'online', source, bookPath, chapterPath, position };
}
