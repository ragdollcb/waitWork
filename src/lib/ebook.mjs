import { EPUB } from 'foliate-js/epub.js';
import { MOBI, isMOBI } from '../vendor/mobi.js';
import { configure, ZipReader, BlobReader } from '@zip.js/zip.js/index-native.js';
import { unzlibSync } from 'fflate';
import { MAX_TXT_BYTES, decodeText, localMetadata } from '../reader.mjs';

export const MAX_EBOOK_BYTES = 32 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 10000;
const encryptedMessage = '文件正文已加密，暂不支持导入，请使用未加密的电子书。';
const expandedMessage = '电子书解压内容超过 64 MiB，无法导入。';
const shortTitle = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 200).replace(/[\uD800-\uDBFF]$/, '');
const pause = () => new Promise(resolve => setTimeout(resolve, 0));

// 原生解压直接消费包内字节，不启用 Worker、WASM 或网络加载。
configure({ useWebWorkers: false, useCompressionStream: true });

async function openEpub(file) {
  const reader = new ZipReader(new BlobReader(file));
  let book;
  try {
    const entries = new Map();
    let declared = 0;
    for await (const entry of reader.getEntriesGenerator()) {
      if (entry.directory) continue;
      if (entries.size >= MAX_ENTRIES) throw new Error('电子书内部文件数量过多。');
      if (entry.encrypted) throw new Error(encryptedMessage);
      if (entries.has(entry.filename) || /(^\/|\\|(^|\/)\.\.($|\/))/.test(entry.filename)) throw new Error('电子书内部文件路径无效。');
      declared += entry.uncompressedSize;
      if (declared > MAX_EXPANDED_BYTES) throw new Error(expandedMessage);
      entries.set(entry.filename, entry);
    }
    let expanded = 0;
    const cache = new Map();
    const encrypted = new Set();
    const read = async name => {
      if (encrypted.has(name)) throw new Error(encryptedMessage);
      const entry = entries.get(name);
      if (!entry) return null;
      if (cache.has(name)) return cache.get(name);
      const parts = [];
      let size = 0;
      await entry.getData(new WritableStream({ write(bytes) {
        expanded += bytes.length;
        size += bytes.length;
        if (expanded > MAX_EXPANDED_BYTES || size > entry.uncompressedSize) throw new Error(expandedMessage);
        parts.push(bytes);
      } }), { checkSignature: true });
      const blob = new Blob(parts);
      cache.set(name, blob);
      return blob;
    };
    const loadText = async name => {
      const blob = await read(name);
      if (!blob) return null;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const encoding = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0x3c && bytes[1] === 0) ? 'utf-16le'
        : (bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0 && bytes[1] === 0x3c) ? 'utf-16be' : 'utf-8';
      return new TextDecoder(encoding, { fatal: true }).decode(bytes);
    };
    const encryption = await loadText('META-INF/encryption.xml');
    if (encryption) {
      const doc = new DOMParser().parseFromString(encryption, 'application/xml');
      if (doc.querySelector('parsererror')) throw new Error('电子书加密信息损坏。');
      for (const node of doc.getElementsByTagNameNS('*', 'CipherReference')) {
        const uri = node.getAttribute('URI');
        if (uri) encrypted.add(decodeURI(uri));
      }
    }
    book = new EPUB({ loadText, loadBlob: read, getSize: name => entries.get(name)?.uncompressedSize || 0 });
    await book.init();
    // Foliate 会略过缺失的 spine 项；导入不能因此静默丢失正文。
    if (book.sections.length !== book.resources.spine.length) throw new Error('电子书缺少正文文件。');
    for (const section of book.sections) {
      if (!entries.has(section.id)) throw new Error('电子书缺少正文文件。');
      if (encrypted.has(section.id)) throw new Error(encryptedMessage);
    }
    return { book, close: async () => { book.destroy(); cache.clear(); await reader.close(); } };
  } catch (error) {
    book?.destroy();
    await reader.close();
    throw error;
  }
}

// Foliate 的 MOBI 解压回调不带配额；按记录检查实际输出，限制整本书的累计解压量。
class BoundedMobi extends MOBI {
  sizes = new Map();
  expanded = 0;
  async loadText(index) {
    if (this.headers.palmdoc.encryption) throw new Error(encryptedMessage);
    const data = await super.loadText(index);
    if (data.length > 65536) throw new Error('MOBI 正文记录过大或已损坏。');
    if (!this.sizes.has(index)) {
      this.expanded += data.length;
      this.sizes.set(index, data.length);
      if (this.expanded > MAX_EXPANDED_BYTES) throw new Error(expandedMessage);
    }
    if (index % 32 === 0) await pause();
    return data;
  }
}

async function openMobi(file) {
  if (!(await isMOBI(file))) throw new Error('不是有效的 MOBI 文件。');
  const bytes = await file.arrayBuffer();
  const view = new DataView(bytes);
  if (bytes.byteLength < 78) throw new Error('MOBI 文件头不完整。');
  const count = view.getUint16(76);
  if (count < 2 || 78 + count * 8 > bytes.byteLength) throw new Error('MOBI 记录表损坏。');
  let previous = 78 + count * 8 - 1;
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    const start = view.getUint32(78 + i * 8);
    const end = i + 1 < count ? view.getUint32(86 + i * 8) : bytes.byteLength;
    if (start <= previous || end <= start || end > bytes.byteLength) throw new Error('MOBI 记录位置无效。');
    previous = start;
    // 同时检查组合文件中的 KF8 头，不能绕过加密或解压长度限制。
    if (end - start >= 24 && decoder.decode(bytes.slice(start + 16, start + 20)) === 'MOBI') {
      if (view.getUint16(start + 12)) throw new Error(encryptedMessage);
      if (view.getUint32(start + 4) > MAX_EXPANDED_BYTES) throw new Error(expandedMessage);
      if (![1, 2, 17480].includes(view.getUint16(start))) throw new Error('暂不支持此 MOBI 压缩方式。');
      if (view.getUint16(start + 8) >= count - i) throw new Error('MOBI 正文记录不完整。');
    }
  }
  const book = await new BoundedMobi({ unzlib: unzlibSync }).open(file);
  return { book, close: () => book.destroy() };
}

const ignoredTags = new Set(['head', 'script', 'style', 'template', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math', 'audio', 'video']);
const blockTags = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'aside', 'nav', 'blockquote', 'pre', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'table', 'hr']);

// 在生成最终文本的同一次遍历中记录偏移；之后不再 trim/归一化正文，避免锚点错位。
export function documentText(doc, limit = MAX_TXT_BYTES) {
  const parts = [];
  const offsets = new WeakMap();
  let length = 0;
  let last = '';
  function append(value) {
    if (!value) return;
    length += value.length;
    if (length > limit) throw new Error('转换后的正文超过单本 8 Mi UTF-16 代码单元限制。');
    parts.push(value);
    last = value.slice(-1);
  }
  const newline = () => { if (length && last !== '\n') append('\n'); };
  const root = doc.body || doc.documentElement;
  if (!root || doc.querySelector('parsererror')) throw new Error('电子书正文格式损坏。');
  const stack = [{ node: root, pre: false }];
  while (stack.length) {
    const { node, pre, exit } = stack.pop();
    if (exit) { newline(); continue; }
    if (node.nodeType === 3 || node.nodeType === 4) {
      let value = node.nodeValue.replace(/\r\n?/g, '\n').replace(/[\0\uFEFF]/g, '');
      if (!pre) {
        value = value.replace(/[\s\u00a0]+/g, ' ');
        if (!length || /[\s]/.test(last)) value = value.replace(/^ /, '');
      }
      append(value);
      continue;
    }
    if (node.nodeType !== 1) continue;
    const tag = node.localName.toLowerCase();
    if (ignoredTags.has(tag) || node.hasAttribute('hidden')) continue;
    const block = blockTags.has(tag);
    if (block || tag === 'br') newline();
    if ((tag === 'td' || tag === 'th') && last && !/\s/.test(last)) append(' ');
    offsets.set(node, length);
    if (block) stack.push({ exit: true });
    for (let i = node.childNodes.length - 1; i >= 0; i--) stack.push({ node: node.childNodes[i], pre: pre || tag === 'pre' });
  }
  return { text: parts.join(''), offsets };
}

async function extractBook(book) {
  const targets = new Map();
  const pending = [...(book.toc || [])].reverse();
  let count = 0;
  while (pending.length) {
    const item = pending.pop();
    if (++count > MAX_ENTRIES) throw new Error('电子书章节数量超过 10000。');
    if (item.subitems) pending.push(...[...item.subitems].reverse());
    if (!item.href || !shortTitle(item.label)) continue;
    let resolved;
    try { resolved = await book.resolveHref(item.href); } catch { continue; }
    if (!resolved || resolved.index < 0) continue;
    const list = targets.get(resolved.index) || [];
    list.push({ title: shortTitle(item.label), anchor: resolved.anchor });
    targets.set(resolved.index, list);
  }
  const parts = [];
  const toc = [];
  let length = 0;
  for (let index = 0; index < book.sections.length; index++) {
    const section = book.sections[index];
    if (!section.createDocument) continue;
    const doc = await section.createDocument();
    const extracted = documentText(doc, MAX_TXT_BYTES - length);
    if (!extracted.text.trim()) continue;
    for (const target of targets.get(index) || []) {
      let anchor;
      try { anchor = target.anchor(doc); } catch { continue; }
      const offset = anchor === 0 ? 0 : extracted.offsets.get(anchor);
      if (offset !== undefined && offset < extracted.text.length) toc.push({ title: target.title, start: length + offset });
    }
    parts.push(extracted.text);
    length += extracted.text.length;
    if (!extracted.text.endsWith('\n')) { parts.push('\n'); length++; }
    if (length > MAX_TXT_BYTES) throw new Error('转换后的正文超过单本 8 Mi UTF-16 代码单元限制。');
    await pause();
  }
  const text = parts.join('');
  if (!text.trim()) throw new Error('文件中没有可阅读的正文。');
  toc.sort((a, b) => a.start - b.start);
  return { text, toc: toc.filter((item, i) => !i || item.start !== toc[i - 1].start) };
}

export async function importLocalFile(file, encoding = 'auto') {
  const format = file.name.split('.').pop().toLowerCase();
  const filename = shortTitle(file.name.replace(/\.[^.]+$/, '')) || '未命名小说';
  let opened;
  try {
    if (!['txt', 'epub', 'mobi'].includes(format)) throw new Error('目前支持 TXT、EPUB、MOBI 小说和 Wait Work JSON 存档。');
    if (file.size > (format === 'txt' ? MAX_TXT_BYTES : MAX_EBOOK_BYTES)) throw new Error(format === 'txt' ? '超过 8 MB，请拆分后导入。' : '超过 32 MiB，无法导入。');
    if (format === 'txt') {
      const decoded = decodeText(await file.arrayBuffer(), encoding);
      return { title: filename, text: decoded.text, format, label: decoded.encoding };
    }
    if (!file.size) throw new Error('文件中没有可阅读的正文。');
    opened = await (format === 'epub' ? openEpub(file) : openMobi(file));
    const extracted = await extractBook(opened.book);
    const title = opened.book.metadata?.title;
    const name = typeof title === 'object' && title ? Object.values(title)[0] : title;
    const result = { title: shortTitle(name) || filename, ...extracted, format, label: format.toUpperCase() };
    localMetadata(result);
    return result;
  } catch (error) {
    const message = /[\u4e00-\u9fff]/.test(error.message) ? error.message : '文件损坏或格式不受支持，无法读取。';
    throw new Error(`“${file.name}”：${message}`);
  } finally { await opened?.close(); }
}
