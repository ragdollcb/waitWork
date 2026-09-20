import { zipSync, strToU8 } from 'fflate';

// 全部正文为本项目原创，夹具在测试时生成，不依赖下载或商业电子书。
export function epub({ version = 3, title = '雨中的书', body, toc = true, encrypted = false, fontOnly = false, extra = {}, missing = false } = {}) {
  const content = body ?? '<p>卷首 🌧️</p><h2 id="one">雨巷</h2><p>甲段<span>中文</span><br/>换行。</p><h2 id="two">晴空</h2><p>乙段😀结束。</p>';
  const files = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'OEBPS/book.opf': `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="${version}.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:12345678-1234-1234-1234-123456789abc</dc:identifier><dc:title>${title}</dc:title><dc:language>zh</dc:language></metadata><manifest><item id="last" href="last.xhtml" media-type="application/xhtml+xml"/><item id="body" href="body.xhtml" media-type="application/xhtml+xml"/>${toc ? version === 3 ? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' : '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' : ''}</manifest><spine${toc && version === 2 ? ' toc="ncx"' : ''}><itemref idref="body"/><itemref idref="last"/></spine></package>`,
    'OEBPS/body.xhtml': `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>正文</title></head><body>${content}</body></html>`,
    'OEBPS/last.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>最后一页。</p></body></html>',
    'OEBPS/nav.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol><li><a href="body.xhtml#one">雨巷</a><ol><li><a href="body.xhtml#two">晴空</a></li></ol></li><li><a href="last.xhtml">尾页</a></li></ol></nav></body></html>',
    'OEBPS/toc.ncx': '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/><docTitle><text>目录</text></docTitle><navMap><navPoint id="a" playOrder="1"><navLabel><text>雨巷</text></navLabel><content src="body.xhtml#one"/><navPoint id="b" playOrder="2"><navLabel><text>晴空</text></navLabel><content src="body.xhtml#two"/></navPoint></navPoint><navPoint id="c" playOrder="3"><navLabel><text>尾页</text></navLabel><content src="last.xhtml"/></navPoint></navMap></ncx>',
  };
  if (encrypted || fontOnly) files['META-INF/encryption.xml'] = `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><EncryptionMethod Algorithm="${fontOnly ? 'http://www.idpf.org/2008/embedding' : 'http://www.w3.org/2001/04/xmlenc#aes256-cbc'}"/><CipherData><CipherReference URI="OEBPS/${fontOnly ? 'font.otf' : 'body.xhtml'}"/></CipherData></EncryptedData></encryption>`;
  if (missing) delete files['OEBPS/body.xhtml'];
  Object.assign(files, extra);
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, typeof value === 'string' ? strToU8(value) : value]))));
}

function pdb(records) {
  const head = Buffer.alloc(78 + records.length * 8 + 2);
  head.write('WaitWork original fixture');
  head.write('BOOKMOBI', 60);
  head.writeUInt16BE(records.length, 76);
  let offset = head.length;
  records.forEach((record, i) => { head.writeUInt32BE(offset, 78 + i * 8); offset += record.length; });
  return Buffer.concat([head, ...records]);
}

export function mobi({ compression = 1, encrypted = false, body, title = '口袋里的雨', badHuff = false, ncxOnly = false } = {}) {
  let html = (ncxOnly ? '<html><head></head><body>' : '<html><head><guide><reference type="toc" filepos="0000000000"/></guide></head><body><div id="toc"><a filepos="1111111111">雨巷</a><a filepos="2222222222">晴空</a></div>')
    + (body ?? '<h2 id="one">雨巷</h2><p>甲段中文🌧️。</p><mbp:pagebreak/><h2 id="two">晴空</h2><p>乙段中文😀。</p>') + '</body></html>';
  const position = token => String(Buffer.byteLength(html.slice(0, Math.max(0, html.indexOf(token))))).padStart(10, '0');
  html = html.replace('0000000000', position('<div id="toc">')).replace('1111111111', position('<h2 id="one">')).replace('2222222222', position('<h2 id="two">'));
  const raw = Buffer.from(html);
  const texts = [];
  for (let start = 0; start < raw.length; start += 4096) {
    const chunk = raw.subarray(start, start + 4096);
    if (compression === 2) {
      const literals = [];
      for (let i = 0; i < chunk.length; i += 8) { const part = chunk.subarray(i, i + 8); literals.push(Buffer.from([part.length]), part); }
      texts.push(Buffer.concat(literals));
    } else texts.push(chunk);
  }
  const titleBytes = Buffer.from(title);
  const header = Buffer.alloc(248 + titleBytes.length);
  header.writeUInt16BE(compression, 0);
  header.writeUInt32BE(raw.length, 4);
  header.writeUInt16BE(texts.length, 8);
  header.writeUInt16BE(4096, 10);
  header.writeUInt16BE(encrypted ? 1 : 0, 12);
  header.write('MOBI', 16);
  header.writeUInt32BE(232, 20);
  header.writeUInt32BE(2, 24);
  header.writeUInt32BE(65001, 28);
  header.writeUInt32BE(6, 36);
  header.writeUInt32BE(248, 84);
  header.writeUInt32BE(titleBytes.length, 88);
  header.writeUInt32BE(texts.length + 1, 108);
  header.writeUInt32BE(0xffffffff, 244);
  titleBytes.copy(header, 248);
  const dictionaries = [];
  if (compression === 17480) {
    // 固定 8-bit Huffman 码，字典反向排列后每个码输出同值字节。
    const huff = Buffer.alloc(24 + 256 * 4 + 32 * 8);
    huff.write('HUFF'); huff.writeUInt32BE(24, 4); huff.writeUInt32BE(24, 8); huff.writeUInt32BE(24 + 256 * 4, 12);
    for (let i = 0; i < 256; i++) huff.writeUInt32BE((255 << 8) | 0x80 | (badHuff ? 0 : 8), 24 + i * 4);
    const cdic = Buffer.alloc(16 + 256 * 2 + 256 * 3);
    cdic.write('CDIC'); cdic.writeUInt32BE(16, 4); cdic.writeUInt32BE(256, 8); cdic.writeUInt32BE(8, 12);
    for (let i = 0; i < 256; i++) {
      const offset = 512 + i * 3;
      cdic.writeUInt16BE(offset, 16 + i * 2); cdic.writeUInt16BE(0x8001, 16 + offset); cdic[18 + offset] = 255 - i;
    }
    header.writeUInt32BE(texts.length + 1, 112); header.writeUInt32BE(2, 116); header.writeUInt32BE(texts.length + 3, 108);
    dictionaries.push(huff, cdic);
  }
  const navigation = [];
  if (ncxOnly) {
    const first = Buffer.from('目录雨巷');
    const second = Buffer.from('目录晴空');
    const index = indexRecords([[1, 1], [3, 1], [4, 1]], [
      { name: '0', values: [Number(position('<h2 id="one">')), 0, 0] },
      { name: '1', values: [Number(position('<h2 id="two">')), first.length + 1, 0] },
    ]);
    index[0].writeUInt32BE(1, 52);
    navigation.push(...index, Buffer.concat([variable(first.length), first, variable(second.length), second]));
    header.writeUInt32BE(texts.length + dictionaries.length + 1, 244);
    header.writeUInt32BE(texts.length + dictionaries.length + navigation.length + 1, 108);
  }
  return pdb([header, ...texts, ...dictionaries, ...navigation]);
}

const variable = number => {
  const bytes = [0x80 | (number & 127)];
  while ((number >>>= 7)) bytes.unshift(number & 127);
  return Buffer.from(bytes);
};

function indexRecords(tags, rows) {
  const tagx = Buffer.alloc(12 + (tags.length + 1) * 4);
  tagx.write('TAGX'); tagx.writeUInt32BE(tagx.length, 4); tagx.writeUInt32BE(1, 8);
  tags.forEach(([tag, values], i) => { tagx.set([tag, values, 1 << i, 0], 12 + i * 4); });
  tagx.set([0, 0, 0, 1], tagx.length - 4);
  const meta = Buffer.alloc(56);
  meta.write('INDX'); meta.writeUInt32BE(56, 4); meta.writeUInt32BE(1, 24); meta.writeUInt32BE(65001, 28);
  const entries = rows.map(({ name, values }) => Buffer.concat([Buffer.from([Buffer.byteLength(name)]), Buffer.from(name), Buffer.from([(1 << tags.length) - 1]), ...values.map(variable)]));
  const head = Buffer.alloc(56);
  head.write('INDX'); head.writeUInt32BE(56, 4); head.writeUInt32BE(rows.length, 24);
  const offsets = Buffer.alloc(4 + rows.length * 2); offsets.write('IDXT');
  let offset = 56;
  entries.forEach((entry, i) => { offsets.writeUInt16BE(offset, 4 + i * 2); offset += entry.length; });
  head.writeUInt32BE(offset, 20);
  return [Buffer.concat([meta, tagx]), Buffer.concat([head, ...entries, offsets])];
}

export function kf8() {
  const skeleton = Buffer.from('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>正文</title></head><body></body></html>');
  const fragment = Buffer.from('<h2 id="one">第一章 新格式</h2><p>KF8 原创正文🌧️。</p>');
  const insert = skeleton.indexOf('</body>');
  const raw = Buffer.concat([skeleton, fragment]);
  const skel = indexRecords([[1, 1], [6, 2]], [{ name: '0', values: [1, 0, skeleton.length] }]);
  const frag = indexRecords([[2, 1], [4, 1], [6, 2]], [{ name: String(insert), values: [0, 0, 0, fragment.length] }]);
  const exth = Buffer.alloc(12); exth.write('EXTH'); exth.writeUInt32BE(12, 4);
  const title = Buffer.from('新格式的雨');
  const header = Buffer.alloc(280 + title.length);
  header.writeUInt16BE(1); header.writeUInt32BE(raw.length, 4); header.writeUInt16BE(1, 8); header.writeUInt16BE(4096, 10);
  header.write('MOBI', 16); header.writeUInt32BE(252, 20); header.writeUInt32BE(2, 24); header.writeUInt32BE(65001, 28); header.writeUInt32BE(8, 36);
  header.writeUInt32BE(280, 84); header.writeUInt32BE(title.length, 88); header.writeUInt32BE(6, 108); header.writeUInt32BE(64, 128);
  header.writeUInt32BE(0xffffffff, 192); header.writeUInt32BE(0xffffffff, 244); header.writeUInt32BE(4, 248); header.writeUInt32BE(2, 252); header.writeUInt32BE(0xffffffff, 260);
  exth.copy(header, 268); title.copy(header, 280);
  return pdb([header, raw, ...skel, ...frag]);
}

export function comboMobi() {
  const recordsOf = data => {
    const count = data.readUInt16BE(76);
    return Array.from({ length: count }, (_, i) => data.subarray(data.readUInt32BE(78 + i * 8), i + 1 < count ? data.readUInt32BE(86 + i * 8) : data.length));
  };
  const legacy = recordsOf(mobi());
  const title = legacy[0].subarray(248);
  const header = Buffer.alloc(272 + title.length);
  legacy[0].subarray(0, 248).copy(header);
  header.writeUInt32BE(272, 84); header.writeUInt32BE(64, 128);
  header.write('EXTH', 248); header.writeUInt32BE(24, 252); header.writeUInt32BE(1, 256);
  header.writeUInt32BE(121, 260); header.writeUInt32BE(12, 264); header.writeUInt32BE(legacy.length + 1, 268);
  title.copy(header, 272);
  legacy[0] = header;
  return pdb([...legacy, Buffer.from('BOUNDARY'), ...recordsOf(kf8())]);
}
