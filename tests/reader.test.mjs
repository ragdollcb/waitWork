import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeText, sectionsFor, paragraphsFor, sectionAt, parseArchive, archiveFor, MAX_TXT_BYTES, localMetadata, checkLibrarySize } from '../src/reader.mjs';

test('识别 UTF-8、GBK 和带 BOM 的 UTF-16，统一换行', () => {
  assert.equal(decodeText(new TextEncoder().encode('\uFEFF第一章 开始\r\n你好\r世界')).text, '第一章 开始\n你好\n世界');
  assert.deepEqual(decodeText(Uint8Array.from([0xc4, 0xe3, 0xba, 0xc3])), { text: '你好', encoding: 'GB18030' });
  assert.equal(decodeText(Uint8Array.from([0xff, 0xfe, 0x60, 0x4f, 0x7d, 0x59])).text, '你好');
  assert.equal(decodeText(Uint8Array.from([0xfe, 0xff, 0x4f, 0x60, 0x59, 0x7d])).text, '你好');
});

test('拒绝空文本、错误编码和过大文件', () => {
  assert.throws(() => decodeText(new Uint8Array()), /没有可阅读/);
  assert.throws(() => decodeText(new Uint8Array(58)), /没有可阅读/);
  assert.throws(() => decodeText(Uint8Array.from([0xff]), 'utf-8'), /编码/);
  assert.throws(() => decodeText(new Uint8Array(MAX_TXT_BYTES + 1)), /8 MB/);
});

test('正文任意位置的空字符均可清理，解码不破坏 UTF-16 有效字节', () => {
  assert.equal(decodeText(Uint8Array.from([0x41, 0, 0x42])).text, 'AB');
  assert.equal(decodeText(new TextEncoder().encode('\0第一章\0\r\n你好\0🌧️\0')).text, '第一章\n你好🌧️');
  assert.deepEqual(decodeText(Uint8Array.from([0, 0xc4, 0xe3, 0, 0xba, 0xc3, 0])), { text: '你好', encoding: 'GB18030' });
  assert.equal(decodeText(Uint8Array.from([0xff, 0xfe, 0x41, 0, 0, 0, 0x60, 0x4f, 0x42, 0])).text, 'A你B');
  assert.equal(decodeText(Uint8Array.from([0xfe, 0xff, 0, 0x41, 0, 0, 0x4f, 0x60, 0, 0x42])).text, 'A你B');
});

test('清除旧阅读器的完整尾部位置标记，非尾部标记只清理空字符', () => {
  const footer = '<PIXTEL_MMI_EBOOK_2005>29' + '\0'.repeat(58) + '</PIXTEL_MMI_EBOOK_2005>';
  const utf8 = new TextEncoder().encode('第一章 测试\r\n正文\r\n' + footer + '\r\n');
  assert.equal(decodeText(utf8).text, '第一章 测试\n正文\n');
  const gbk = Buffer.concat([Buffer.from([0xc4, 0xe3, 0xba, 0xc3]), Buffer.from(footer)]);
  assert.deepEqual(decodeText(gbk), { text: '你好', encoding: 'GB18030' });
  assert.equal(decodeText(new TextEncoder().encode('正文\0' + footer)).text, '正文');
  assert.equal(decodeText(new TextEncoder().encode('正文' + footer + '还有正文')).text, '正文' + footer.replaceAll('\0', '') + '还有正文');
  assert.equal(decodeText(new TextEncoder().encode('正文<PIXTEL_MMI_EBOOK_2005>29\0')).text, '正文<PIXTEL_MMI_EBOOK_2005>29');
  assert.equal(decodeText(new TextEncoder().encode('正文<PIXTEL_MMI_EBOOK_2005>标记示例</PIXTEL_MMI_EBOOK_2005>')).text, '正文<PIXTEL_MMI_EBOOK_2005>标记示例</PIXTEL_MMI_EBOOK_2005>');
});

test('中英文章节、卷首内容和段落位置一致', () => {
  const text = '书名与简介\n\n第一章 初见\n正文甲\n\n正文乙\n第二章 重逢\n正文丙\nChapter 3 Home\nThe end.';
  const sections = sectionsFor(text);
  assert.deepEqual(sections.map((s) => s.title), ['卷首', '第一章 初见', '第二章 重逢', 'Chapter 3 Home']);
  assert.equal(sectionAt(sections, text.indexOf('正文乙')), 1);
  assert.equal(sectionAt(sections, text.length), 3);
  for (const section of sections) for (const p of paragraphsFor(text, section)) assert.equal(text.slice(p.start, p.end), p.text);
});

test('没有章节和超长单章都分段，正文不丢失且不切坏 emoji', () => {
  const text = '没有章节\n' + '中🌧️'.repeat(16000);
  const sections = sectionsFor(text);
  assert.ok(sections.length > 1);
  assert.ok(sections.every((s) => s.end - s.body <= 16000));
  assert.equal(sections.map((s) => text.slice(s.body, s.end)).join(''), text);
  const paragraphs = sections.flatMap((s) => paragraphsFor(text, s));
  assert.ok(paragraphs.every((p) => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(p.text)));
  assert.equal(paragraphs.map((p) => p.text).join(''), text.replaceAll('\n', ''));
});

test('只有章节标题的文件也可打开', () => {
  const text = '第一章 开始';
  const sections = sectionsFor(text);
  assert.equal(sections.length, 1);
  assert.deepEqual(paragraphsFor(text, sections[0]), []);
});

test('存档往返保留正文、进度和设置，忽略内部派生数据', () => {
  const state = { books: [{ id: 'book-1', title: '测试', text: '第一章 开始\n小说正文', position: 8, derived: '不保存' }], activeId: 'book-1', settings: { theme: 'dark', fontSize: 23 } };
  const encoded = archiveFor(state);
  assert.ok(!encoded.includes('derived'));
  const restored = parseArchive(encoded);
  assert.equal(restored.books[0].position, 8);
  assert.equal(restored.books[0].text, state.books[0].text);
  assert.equal(restored.activeId, 'book-1');
  assert.equal(restored.settings.fontSize, 23);
  assert.equal(restored.settings.theme, 'dark');
});

test('存档拒绝错误格式、重复 ID，限制不可信的进度与设置', () => {
  assert.throws(() => parseArchive('not-json'), /JSON/);
  assert.throws(() => parseArchive('null'), /存档/);
  const book = { id: 'a', title: '测试', text: '正文', position: 9999 };
  const data = { format: 'xidu', version: 1, books: [book], activeId: 'missing', settings: { fontSize: 999, theme: '<script>', width: -2 } };
  const restored = parseArchive(JSON.stringify(data));
  assert.equal(restored.books[0].position, 2);
  assert.equal(restored.activeId, 'a');
  assert.equal(restored.settings.fontSize, 30);
  assert.equal(restored.settings.width, 480);
  assert.equal(restored.settings.theme, 'auto');
  data.books.push(book);
  assert.throws(() => parseArchive(JSON.stringify(data)), /书籍信息/);
});

test('电子书任意章节名及 UTF-16 位置往返保存，长章分段不丢正文', () => {
  const text = '卷首🌧️\n雨巷\n' + '中文😀'.repeat(10000) + '\n晴空\n尾声';
  const toc = [{ title: '雨巷', start: text.indexOf('雨巷') }, { title: '晴空', start: text.indexOf('晴空') }];
  const book = { id: 'epub', title: '雨', text, toc, format: 'epub', position: toc[1].start };
  const state = { books: [book], activeId: book.id, settings: {} };
  const restored = parseArchive(archiveFor(state));
  assert.deepEqual(restored.books[0], book);
  const sections = sectionsFor(text, toc);
  assert.equal(sections[0].title, '卷首');
  assert.equal(sections[sectionAt(sections, book.position)].title, '晴空');
  assert.ok(sections.some(item => item.title === '雨巷（续 2）'));
  assert.equal(sections.map(item => text.slice(item.body, item.end)).join(''), text);
  assert.doesNotThrow(() => checkLibrarySize(state));
});

test('目录拒绝乱序、重复、越界、空标题及正文归一化后偏移失效的存档', () => {
  for (const toc of [null, {}, [{ title: '', start: 0 }], [{ title: 'a', start: -1 }], [{ title: 'a', start: 10 }], [{ title: 'a', start: 0.5 }], [{ title: 'a', start: 1 }, { title: 'b', start: 1 }], [{ title: 'a', start: 2 }, { title: 'b', start: 1 }]]) {
    assert.throws(() => localMetadata({ text: '1234567890', toc }), /目录/);
  }
  const book = { id: 'a', title: '书', text: 'abc\r\ndef', toc: [{ title: '章', start: 5 }] };
  assert.throws(() => parseArchive(archiveFor({ books: [book] })), /正文与章节目录不一致/);
  assert.throws(() => localMetadata({ text: 'abc', format: 'pdf' }), /格式/);
});

test('导入前拒绝超过保存容量的目录', () => {
  const book = { id: 'a', title: '书', text: '文'.repeat(3000), format: 'epub', toc: Array.from({ length: 3000 }, (_, start) => ({ title: '章'.repeat(200), start })) };
  assert.throws(() => checkLibrarySize({ books: [book], activeId: 'a', settings: {} }), /书架目录信息过大/);
});
