export const MAX_TXT_BYTES = 8 * 1024 * 1024;
export const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
export const MAX_BOOKS = 20;
export const MAX_TOTAL_CHARS = 24 * 1024 * 1024;
export const DEFAULT_SETTINGS = { theme: 'auto', fontSize: 14, lineHeight: 1.7, width: 960, font: 'mono' };
const SECTION_SIZE = 16000;
const headingPattern = /^(?:第[\d０-９零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟]+[章回节卷部篇].*|(?:序章|序言|楔子|引子|尾声|终章|后记|番外)(?:[\s：:、.].*)?|chapter\s+\d+\b.*)$/i;

export function decodeText(buffer, encoding = 'auto') {
  const bytes = new Uint8Array(buffer);
  if (bytes.length > MAX_TXT_BYTES) throw new Error('这本书超过 8 MB，请拆分后导入。');
  let chosen = encoding;
  if (chosen === 'auto') {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) chosen = 'utf-16le';
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) chosen = 'utf-16be';
    else {
      try { return { text: normalizeText(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), encoding: 'UTF-8' }; }
      catch (error) { if (!(error instanceof TypeError)) throw error; chosen = 'gb18030'; }
    }
  }
  let decoded;
  try { decoded = new TextDecoder(chosen, { fatal: true }).decode(bytes); }
  catch { throw new Error('无法按所选编码读取，请更换导入编码后重试。'); }
  return { text: normalizeText(decoded), encoding: chosen.toUpperCase() };
}

export function normalizeText(text) {
  // 先按编码解码，再清理文本中的 NUL，不能直接删原始字节，否则会破坏 UTF-16 正文。
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
    .replace(/<PIXTEL_MMI_EBOOK_2005>[\d\s\0]*<\/PIXTEL_MMI_EBOOK_2005>\s*$/, '')
    .replace(/\0/g, '');
  if (!normalized.trim()) throw new Error('文件中没有可阅读的正文。');
  return normalized;
}

export function sectionsFor(text) {
  const starts = [];
  for (const match of text.matchAll(/[^\n]+/g)) {
    const line = match[0].trim();
    if (line.length <= 80 && headingPattern.test(line)) starts.push({ title: line, start: match.index, body: match.index + match[0].length });
  }
  if (!starts.length) starts.push({ title: '正文', start: 0, body: 0 });
  else if (text.slice(0, starts[0].start).trim()) starts.unshift({ title: '卷首', start: 0, body: 0 });
  const sections = [];
  starts.forEach((chapter, index) => {
    const end = starts[index + 1]?.start ?? text.length;
    let cursor = chapter.body;
    let part = 1;
    do {
      let cut = Math.min(cursor + SECTION_SIZE, end);
      if (cut < end) {
        const newline = text.lastIndexOf('\n', cut);
        if (newline > cursor + SECTION_SIZE / 2) cut = newline + 1;
        else if (/[\uD800-\uDBFF]/.test(text[cut - 1])) cut--;
      }
      sections.push({ title: chapter.title + (part > 1 ? `（续 ${part}）` : ''), start: part === 1 ? chapter.start : cursor, body: cursor, end: cut });
      cursor = cut;
      part++;
    } while (cursor < end);
  });
  return sections;
}

export function paragraphsFor(text, section) {
  const paragraphs = [];
  const part = text.slice(section.body, section.end);
  for (const match of part.matchAll(/[^\n]+/g)) {
    if (!match[0].trim()) continue;
    // 无换行的大段 TXT 也分块渲染，以便稳定恢复位置。
    for (let offset = 0; offset < match[0].length;) {
      let end = Math.min(offset + 1200, match[0].length);
      if (end < match[0].length && /[\uD800-\uDBFF]/.test(match[0][end - 1])) end--;
      paragraphs.push({ text: match[0].slice(offset, end), start: section.body + match.index + offset, end: section.body + match.index + end });
      offset = end;
    }
  }
  return paragraphs;
}

export function sectionAt(sections, position) {
  const index = sections.findIndex((section) => position < section.end);
  return index < 0 ? sections.length - 1 : index;
}

export function validSettings(settings = {}) {
  const value = settings && typeof settings === 'object' ? settings : {};
  const number = (key, min, max) => Number.isFinite(value[key]) ? Math.min(max, Math.max(min, value[key])) : DEFAULT_SETTINGS[key];
  return {
    theme: ['auto', 'light', 'dark', 'green'].includes(value.theme) ? value.theme : 'auto',
    fontSize: number('fontSize', 12, 30), lineHeight: number('lineHeight', 1.4, 2.6), width: number('width', 480, 960),
    font: ['mono', 'sans'].includes(value.font) ? value.font : 'mono',
  };
}

export function parseArchive(json) {
  let data;
  try { data = JSON.parse(json); } catch { throw new Error('存档不是有效的 JSON 文件。'); }
  if (!data || data.format !== 'xidu' || data.version !== 1 || !Array.isArray(data.books) || data.books.length > MAX_BOOKS) throw new Error('不是受支持的 waitWork 存档，请导入 .waitwork.json 文件。');
  let total = 0;
  const ids = new Set();
  const books = data.books.map((book) => {
    if (!book || typeof book.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(book.id) || ids.has(book.id) || typeof book.title !== 'string' || !book.title.trim() || book.title.length > 200 || typeof book.text !== 'string' || book.text.length > MAX_TXT_BYTES) throw new Error('存档中的书籍信息不完整或超出限制。');
    ids.add(book.id);
    total += book.text.length;
    if (total > MAX_TOTAL_CHARS) throw new Error('存档正文过大，请减少书籍数量。');
    const text = normalizeText(book.text);
    return { id: book.id, title: book.title.trim(), text, position: Number.isFinite(book.position) ? Math.max(0, Math.min(text.length, Math.floor(book.position))) : 0 };
  });
  return { books, activeId: ids.has(data.activeId) ? data.activeId : books[0]?.id ?? null, settings: validSettings(data.settings) };
}

export function archiveFor(state) {
  return JSON.stringify({ format: 'xidu', version: 1, activeId: state.activeId, settings: state.settings, books: state.books.map(({ id, title, text, position }) => ({ id, title, text, position })) });
}
