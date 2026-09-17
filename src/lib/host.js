import { parseArchive } from '../reader.mjs';

async function invoke(method, params = {}) {
  const bridge = window.dbxPlugin;
  if (!bridge) throw new Error('请在 DBX 或 npm run preview 开发预览中打开，自动保存需要本地后端。');
  await bridge.ready;
  return bridge.invoke(method, params);
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
        let text = '';
        for (const hash of book.chunks) text += (await invoke('reader/chunk-get', { hash })).text;
        texts.set(book.id, { text, chunks: book.chunks });
        books.push({ ...book, text });
      }
      return parseArchive(JSON.stringify({ ...saved.data, books, format: 'xidu', version: 1 }));
    },
    async save(state) {
      const books = [];
      const nextTexts = new Map();
      for (const book of state.books) {
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
