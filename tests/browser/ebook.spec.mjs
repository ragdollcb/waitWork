import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { epub, mobi, kf8, comboMobi } from '../fixtures/ebooks.mjs';

async function open(page) {
  await page.goto('http://127.0.0.1:5191/sandbox');
  const reader = page.frameLocator('iframe');
  await expect(reader.locator('.storage-overlay')).toHaveCount(0);
  await reader.locator('#restore-reading').click();
  await reader.locator('#toggle-sidebar').click();
  return reader;
}
const file = (name, buffer) => ({ name, buffer, mimeType: 'application/octet-stream' });

for (const version of [2, 3]) test(`EPUB ${version}：书名、嵌套目录、同文件锚点、正文顺序与自动恢复`, async ({ page }) => {
  const reader = await open(page);
  await reader.locator('#file-input').setInputFiles(file('原文件名.epub', epub({ version })));
  await expect(reader.locator('#current-book')).toHaveText('雨中的书');
  await expect(reader.locator('.book-cover')).toHaveText('EPUB');
  await expect(reader.locator('#paragraphs')).toContainText('卷首 🌧️');
  await reader.locator('#tab-toc').click();
  await expect(reader.locator('.chapter-button')).toHaveText(['01卷首', '02雨巷', '03晴空', '04尾页']);
  await reader.locator('.chapter-button').filter({ hasText: '晴空' }).click();
  await expect(reader.locator('#chapter-title')).toHaveText('-- 晴空');
  await expect(reader.locator('#paragraphs')).toContainText('乙段😀结束。');
  await expect(reader.locator('#paragraphs')).not.toContainText('甲段');
  await expect(reader.locator('#save-status')).toHaveText('已自动保存');
  await page.reload();
  await expect(reader.locator('.storage-overlay')).toHaveCount(0);
  await reader.locator('#restore-reading').click();
  await expect(reader.locator('#chapter-title')).toHaveText('-- 晴空');
  await reader.locator('#next').click();
  await expect(reader.locator('#paragraphs')).toContainText('最后一页。');
});

for (const compression of [1, 2, 17480]) test(`MOBI 压缩 ${compression}：中文正文、目录与进度恢复`, async ({ page }) => {
  const reader = await open(page);
  await reader.locator('#file-input').setInputFiles(file('小说.mobi', mobi({ compression })));
  await expect(reader.locator('#current-book')).toHaveText('口袋里的雨');
  await reader.locator('#tab-toc').click();
  await reader.locator('.chapter-button').filter({ hasText: '晴空' }).click();
  await expect(reader.locator('#paragraphs')).toContainText('乙段中文😀。');
  await expect(reader.locator('#save-status')).toHaveText('已自动保存');
  await page.reload();
  await expect(reader.locator('.storage-overlay')).toHaveCount(0);
  await reader.locator('#restore-reading').click();
  await expect(reader.locator('#chapter-title')).toHaveText('-- 晴空');
  await expect(reader.locator('#paragraphs')).toContainText('乙段中文😀。');
});

for (const makeMobi of [kf8, comboMobi]) test(`${makeMobi.name} 内容与混合多选，TXT 编码不影响电子书`, async ({ page }) => {
  const reader = await open(page);
  await reader.locator('#encoding').selectOption('gb18030');
  await reader.locator('#file-input').setInputFiles([
    file('新格式.mobi', makeMobi()), file('普通.txt', Buffer.from([0xc4, 0xe3, 0xba, 0xc3])), file('雨.epub', epub()),
  ]);
  await expect(reader.locator('#book-count')).toHaveText('3 项');
  await expect(reader.locator('#current-book')).toHaveText('新格式的雨');
  await expect(reader.locator('#paragraphs')).toContainText('KF8 原创正文🌧️。');
  await reader.getByRole('button', { name: '阅读 普通', exact: true }).click();
  await expect(reader.locator('#paragraphs')).toContainText('你好');
  await expect(reader.locator('#save-status')).toHaveText('已自动保存');
});

test('损坏、加密、缺正文、超限及混合批次失败均不改变书架', async ({ page }, testInfo) => {
  const reader = await open(page);
  const original = await reader.locator('#current-book').textContent();
  const cases = [
    [file('损坏.epub', Buffer.from('bad zip')), '损坏'],
    [file('损坏.mobi', Buffer.from('bad mobi')), 'MOBI'],
    [file('加密.epub', epub({ encrypted: true })), '已加密'],
    [file('加密.mobi', mobi({ encrypted: true })), '已加密'],
    [file('坏压缩.mobi', mobi({ compression: 17480, badHuff: true })), '压缩编码无效'],
    [file('缺正文.epub', epub({ missing: true })), '缺少正文'],
    [file('空正文.epub', epub({ body: '', extra: { 'OEBPS/last.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><body/></html>' } })), '没有可阅读的正文'],
    [file('过大.epub', Buffer.alloc(32 * 1024 * 1024 + 1)), '32 MiB'],
    [file('正文过大.epub', epub({ body: '字'.repeat(8 * 1024 * 1024 + 1), toc: false })), '正文超过'],
    [file('解压过大.epub', epub({ extra: { 'large.bin': new Uint8Array(64 * 1024 * 1024) } })), '64 MiB'],
  ];
  await mkdir(testInfo.outputDir, { recursive: true });
  const goodPath = testInfo.outputPath('成功.txt');
  await writeFile(goodPath, '成功正文');
  for (const [bad, message] of cases) {
    // 大文件走磁盘路径，避免 Playwright trace 反复序列化数十 MiB 的 base64。
    const badPath = testInfo.outputPath(bad.name);
    await writeFile(badPath, bad.buffer);
    await reader.locator('#file-input').setInputFiles([goodPath, badPath]);
    await expect(reader.locator('#toast')).toContainText(message);
    await expect(reader.locator('#toast')).toContainText(bad.name);
    await expect(reader.locator('#current-book')).toHaveText(original);
    await expect(reader.locator('#book-count')).toHaveText('1 项');
  }
});

test('书内脚本和外部资源不执行、不联网，字体混淆不阻止正文导入', async ({ page }) => {
  const reader = await open(page);
  const requests = [];
  page.on('request', request => { if (request.url().includes('ebook-test.invalid')) requests.push(request.url()); });
  const body = '<h2 id="one">雨巷</h2><script>globalThis.ebookInjected=true</script><style>@import "https://ebook-test.invalid/a.css";</style><img src="https://ebook-test.invalid/a.png"/><iframe src="https://ebook-test.invalid/frame"/><p>安全正文&lt;script&gt;</p>';
  await reader.locator('#file-input').setInputFiles(file('安全.epub', epub({ body, fontOnly: true })));
  await expect(reader.locator('#current-book')).toHaveText('雨中的书');
  await expect(reader.locator('#paragraphs')).toContainText('安全正文<script>');
  await expect(reader.locator('#paragraphs')).not.toContainText('ebookInjected');
  await expect(reader.locator('#paragraphs img, #paragraphs iframe, #paragraphs script')).toHaveCount(0);
  expect(await page.frames()[1].evaluate(() => globalThis.ebookInjected)).toBeUndefined();
  expect(requests).toEqual([]);
});

test('没有原生目录时识别章节，长章仍分段', async ({ page }) => {
  const reader = await open(page);
  await reader.locator('#file-input').setInputFiles(file('无目录.epub', epub({ toc: false, title: '', body: '<h2>第一章 开始</h2><p>' + '长正文🌧️'.repeat(5000) + '</p><h2>第二章 结束</h2><p>结尾。</p>' })));
  await expect(reader.locator('#current-book')).toHaveText('无目录');
  await reader.locator('#tab-toc').click();
  await expect(reader.locator('.chapter-button').filter({ hasText: '续 2' })).toHaveCount(1);
  await reader.locator('.chapter-button').filter({ hasText: '第二章 结束' }).click();
  await expect(reader.locator('#paragraphs')).toContainText('结尾。');
});

test('EPUB 的 UTF-16 XML 与 CDATA 正文可读取，目录仍能定位', async ({ page }) => {
  const reader = await open(page);
  const xml = '<?xml version="1.0" encoding="UTF-16"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h2 id="one">雨巷</h2><p><![CDATA[中文🌧️ <字面文字>]]></p><h2 id="two">晴空</h2><p>第二段。</p></body></html>';
  const encoded = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')]);
  await reader.locator('#file-input').setInputFiles(file('UTF16.EPUB', epub({ extra: { 'OEBPS/body.xhtml': encoded } })));
  await expect(reader.locator('#paragraphs')).toContainText('中文🌧️ <字面文字>');
  await reader.locator('#next').click();
  await expect(reader.locator('#chapter-title')).toHaveText('-- 晴空');
  await expect(reader.locator('#paragraphs')).toContainText('第二段。');
});

test('仅含 NCX 目录的 MOBI 保留章节名及字节锚点', async ({ page }) => {
  const reader = await open(page);
  await reader.locator('#file-input').setInputFiles(file('NCX.mobi', mobi({ ncxOnly: true })));
  await expect(reader.locator('#current-book')).toHaveText('口袋里的雨');
  await reader.locator('#tab-toc').click();
  await reader.locator('.chapter-button').filter({ hasText: '目录晴空' }).click();
  await expect(reader.locator('#chapter-title')).toHaveText('-- 目录晴空');
  await expect(reader.locator('#paragraphs')).toContainText('乙段中文😀。');
  await expect(reader.locator('#paragraphs')).not.toContainText('甲段');
  await expect(reader.locator('#save-status')).toHaveText('已自动保存');
});
