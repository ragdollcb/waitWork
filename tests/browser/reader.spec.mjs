import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { epub } from '../fixtures/ebooks.mjs';

const novel = '第一章 雨夜\n' + '雨声沿着屋檐缓缓流下，她翻开一本旧书。\n'.repeat(180) + '\n第二章 清晨\n' + '窗外天色渐亮。\n'.repeat(100);
async function reveal(reader) {
  await expect(reader.locator('.storage-overlay')).toHaveCount(0);
  if (await reader.locator('#privacy-screen').isVisible()) await reader.locator('#restore-reading').click();
  await expect(reader.locator('#reader-app')).toBeVisible();
}
async function openFiles(reader) {
  await reveal(reader);
  if (!(await reader.locator('#sidebar').isVisible())) await reader.locator('#toggle-sidebar').click();
}

const txt = { name: '长篇测试.txt', mimeType: 'text/plain', buffer: Buffer.from(novel) };

test('严格沙箱内导入、翻章、调字号、收起与恢复、自动保存并恢复进度', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:5191/sandbox');
  const reader = page.frameLocator('iframe');
  await reveal(reader);
  await expect(reader.locator('.storage-overlay')).toHaveCount(0);
  await expect(reader.locator('#chapter-title')).toContainText('第一章 旧车站');
  const storageUnavailable = await page.frames()[1].evaluate(() => { try { localStorage.getItem('test'); return false; } catch { return true; } });
  expect(storageUnavailable).toBe(true);
  await reader.locator('#file-input').setInputFiles(txt);
  await expect(reader.locator('#current-book')).toHaveText('长篇测试');
  await reader.locator('#next').click();
  await expect(reader.locator('#chapter-title')).toContainText('第二章 清晨');
  await reader.locator('#reading-scroll').evaluate((el) => { el.scrollTop = 400; });
  await expect(reader.locator('#progress-value')).not.toHaveText('0.0%');
  await reader.locator('#open-settings').click();
  await reader.locator('#font-size').fill('23');
  await expect(reader.locator('#font-size-value')).toHaveText('23 px');
  await reader.locator('[data-theme-choice="dark"]').click();
  await reader.locator('#close-settings').click();
  await reader.locator('#reading-scroll').focus();
  await page.keyboard.press('Escape');
  await expect(reader.locator('#reader-app')).toBeHidden();
  await expect(reader.locator('#privacy-screen')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(reader.locator('#chapter-title')).toContainText('第二章 清晨');
  await expect(reader.locator('#save-status')).toHaveText('已自动保存');
  await expect(reader.locator('#export')).toHaveCount(0);
  await page.reload();
  await reveal(reader);
  await expect(reader.locator('.storage-overlay')).toHaveCount(0);
  await expect(reader.locator('#chapter-title')).toContainText('第二章 清晨');
  await expect(reader.locator('html')).toHaveAttribute('data-reader-theme', 'dark');
  await expect.poll(() => reader.locator('#reading-scroll').evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

test('不可信 TXT 只渲染为文本，错误导入不破坏现有书架', async ({ page }) => {
  await page.goto('http://127.0.0.1:5191/sandbox');
  const reader = page.frameLocator('iframe');
  await reveal(reader);
  await expect(reader.locator('.storage-overlay')).toHaveCount(0);
  await reader.locator('#file-input').setInputFiles({ name: '安全测试.txt', mimeType: 'text/plain', buffer: Buffer.from('第一章 测试\n<img src=x onerror="window.pwned=true">\n<script>window.pwned=true</script>') });
  await expect(reader.locator('#paragraphs')).toContainText('<script>');
  expect(await page.frames()[1].evaluate(() => window.pwned)).toBeUndefined();
  await expect(reader.locator('#paragraphs img')).toHaveCount(0);
  await reader.locator('#file-input').setInputFiles({ name: '坏存档.json', mimeType: 'application/json', buffer: Buffer.from('{') });
  await expect(reader.locator('#toast')).toContainText('不是有效的 JSON');
  await expect(reader.locator('#current-book')).toHaveText('安全测试');
  await reader.locator('#file-input').setInputFiles({ name: '空.txt', mimeType: 'text/plain', buffer: Buffer.from('  ') });
  await expect(reader.locator('#toast')).toContainText('没有可阅读的正文');
  await expect(reader.locator('#current-book')).toHaveText('安全测试');
});

test('目录搜索、GBK 导入、移除与取消、设置中 Esc 一键收起', async ({ page }) => {
  await page.goto('http://127.0.0.1:5191');
  await reveal(page);
  await openFiles(page);
  await page.locator('#tab-toc').click();
  await page.locator('#chapter-search').fill('天光');
  await expect(page.locator('.chapter-button')).toHaveCount(1);
  await page.locator('.chapter-button').click();
  await expect(page.locator('#chapter-title')).toContainText('第三章 天光');
  await page.locator('#open-settings').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#privacy-screen')).toBeVisible();
  await page.locator('#restore-reading').click();
  await page.locator('#file-input').setInputFiles({ name: 'GBK测试.txt', mimeType: 'text/plain', buffer: Buffer.from([0xc4, 0xe3, 0xba, 0xc3]) });
  await expect(page.locator('#paragraphs')).toContainText('你好');
  await page.locator('#tab-shelf').click();
  await page.getByRole('button', { name: '移除 GBK测试', exact: true }).click();
  await page.locator('#confirm-cancel').click();
  await expect(page.locator('#current-book')).toHaveText('GBK测试');
  await page.getByRole('button', { name: '移除 GBK测试', exact: true }).click();
  await page.locator('#confirm-ok').click();
  await expect(page.locator('#empty-state')).toBeVisible();
  await expect(page.locator('#save-status')).toHaveText('已自动保存');
  await page.reload();
  await reveal(page);
  await expect(page.locator('.storage-overlay')).toHaveCount(0);
  await expect(page.locator('#empty-state')).toBeVisible();
});

test('自动保存状态可见，移动布局无水平溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:5191');
  await reveal(page);
  await expect(page.locator('#sidebar')).toBeHidden();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await expect(page.locator('#save-status')).toHaveText('已自动保存');
  await expect(page.locator('#export')).toHaveCount(0);
  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/mobile.png', fullPage: true });
});

test('实际官方 CLI 宿主可自动保存并在重开工作台后恢复', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:5190');
  await page.getByRole('button', { name: 'Wait Work', exact: true }).click();
  const reader = page.frameLocator('iframe').first();
  await reveal(reader);
  await expect(reader.locator('#chapter-title')).toContainText('第一章 旧车站', { timeout: 20000 });
  await reader.locator('#file-input').setInputFiles(txt);
  await expect(reader.locator('#current-book')).toHaveText('长篇测试');
  await expect(reader.locator('#save-status')).toHaveText('已自动保存');
  await page.reload();
  await page.getByRole('button', { name: 'Wait Work', exact: true }).click();
  await reveal(reader);
  await expect(reader.locator('#current-book')).toHaveText('长篇测试');
  await expect(reader.locator('.storage-overlay')).toHaveCount(0);
  await reader.locator('#file-input').setInputFiles({ name: '电子书.epub', mimeType: 'application/epub+zip', buffer: epub() });
  await expect(reader.locator('#current-book')).toHaveText('雨中的书');
  await reader.locator('#next').click();
  await expect(reader.locator('#chapter-title')).toContainText('雨巷');
  await expect(reader.locator('#save-status')).toHaveText('已自动保存');
  await page.reload();
  await page.getByRole('button', { name: 'Wait Work', exact: true }).click();
  await reveal(reader);
  await expect(reader.locator('#chapter-title')).toContainText('雨巷');
  await expect(reader.locator('#paragraphs')).toContainText('甲段中文');
  expect(errors).toEqual([]);
});

test('桌面阅读页视觉快照', async ({ page }) => {
  await page.goto('http://127.0.0.1:5191');
  await reveal(page);
  await expect(page.locator('#chapter-title')).toContainText('第一章 旧车站');
  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/desktop.png', fullPage: true });
  await page.locator('#open-settings').click();
  await page.locator('[data-theme-choice="dark"]').click();
  await page.locator('#close-settings').click();
  await page.screenshot({ path: 'test-results/screenshots/dark.png', fullPage: true });
});


test('保存失败持续提示并自动重试，重新加载时不丢失最终进度', async ({ page }) => {
  await page.goto('http://127.0.0.1:5191/sandbox');
  const reader = page.frameLocator('iframe');
  await reveal(reader);
  await expect(reader.locator('#save-status')).toHaveText('已自动保存');
  await page.route('**/rpc', async route => {
    if (route.request().postDataJSON().method === 'reader/save') await route.fulfill({ json: { error: { message: '测试磁盘写入失败' } } });
    else await route.continue();
  });
  await reader.locator('#file-input').setInputFiles(txt);
  await expect(reader.locator('#save-error')).toContainText('测试磁盘写入失败');
  await expect(reader.locator('#save-status')).toHaveText('自动保存失败');
  await page.unroute('**/rpc');
  await expect(reader.locator('#save-status')).toHaveText('已自动保存', { timeout: 10000 });
  await page.reload();
  await reveal(reader);
  await expect(reader.locator('#current-book')).toHaveText('长篇测试');
});

test('加载失败时阻止编辑和覆盖旧书架，可重新读取', async ({ page }) => {
  await page.goto('http://127.0.0.1:5191');
  await reveal(page);
  await expect(page.locator('#save-status')).toHaveText('已自动保存');
  await page.locator('#file-input').setInputFiles(txt);
  await expect(page.locator('#save-status')).toHaveText('已自动保存');
  let writes = 0;
  await page.route('**/rpc', async route => {
    const method = route.request().postDataJSON().method;
    if (method === 'reader/save') writes++;
    if (method === 'reader/load') await route.fulfill({ json: { error: { message: '测试书架读取失败' } } });
    else await route.continue();
  });
  await page.reload();
  await expect(page.locator('.storage-overlay')).toContainText('测试书架读取失败');
  await expect(page.locator('#reader-app')).toHaveAttribute('inert', '');
  expect(writes).toBe(0);
  await page.unroute('**/rpc');
  await page.getByRole('button', { name: '重新读取' }).click();
  await reveal(page);
  await expect(page.locator('.storage-overlay')).toHaveCount(0);
  await expect(page.locator('#current-book')).toHaveText('长篇测试');
});

test('超过宿主单条消息限制的小说分块保存，重载正文完整', async ({ page }) => {
  await page.goto('http://127.0.0.1:5191/sandbox');
  const reader = page.frameLocator('iframe');
  await reveal(reader);
  await expect(reader.locator('.storage-overlay')).toHaveCount(0);
  const large = '第一章 大书\n' + '中文🌧️阅读内容\n'.repeat(120000) + '\n第二章 末尾\n保存完整。';
  expect(Buffer.byteLength(large)).toBeGreaterThan(2 * 1024 * 1024);
  await reader.locator('#file-input').setInputFiles({ name: '大书.txt', mimeType: 'text/plain', buffer: Buffer.from(large) });
  await expect(reader.locator('#current-book')).toHaveText('大书');
  await expect(reader.locator('#save-status')).toHaveText('已自动保存', { timeout: 20000 });
  await page.reload();
  await reveal(reader);
  await expect(reader.locator('.storage-overlay')).toHaveCount(0);
  await openFiles(reader);
  await reader.locator('#tab-toc').click();
  await reader.locator('#chapter-search').fill('末尾');
  await reader.locator('.chapter-button').click();
  await expect(reader.locator('#paragraphs')).toContainText('保存完整。');
});


test('旧版 JSON 存档导入后自动保存，更新同 ID 正文也能恢复', async ({ page }) => {
  await page.goto('http://127.0.0.1:5191');
  await reveal(page);
  await expect(page.locator('#save-status')).toHaveText('已自动保存');
  const archive = { format: 'xidu', version: 1, activeId: 'legacy', books: [{ id: 'legacy', title: '旧版书架', text: '第一章 旧书\n旧版正文', position: 0 }], settings: { theme: 'green', fontSize: 22 } };
  const input = () => ({ name: '备份.xidu.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(archive)) });
  await page.locator('#file-input').setInputFiles(input());
  await expect(page.locator('#current-book')).toHaveText('旧版书架');
  await expect(page.locator('#save-status')).toHaveText('已自动保存');
  archive.books[0].text = '第一章 新书\n更新后的正文🌧️';
  await page.locator('#file-input').setInputFiles(input());
  await page.locator('#confirm-ok').click();
  await expect(page.locator('#paragraphs')).toContainText('更新后的正文🌧️');
  await expect(page.locator('#save-status')).toHaveText('已自动保存');
  await page.reload();
  await reveal(page);
  await expect(page.locator('.storage-overlay')).toHaveCount(0);
  await expect(page.locator('#paragraphs')).toContainText('更新后的正文🌧️');
  await expect(page.locator('html')).toHaveAttribute('data-reader-theme', 'green');
});

test('两个窗口的过期修改被阻止，不覆盖已保存书架', async ({ page, context }) => {
  await page.goto('http://127.0.0.1:5191');
  await reveal(page);
  await expect(page.locator('#save-status')).toHaveText('已自动保存');
  const other = await context.newPage();
  await other.goto('http://127.0.0.1:5191');
  await reveal(other);
  await expect(other.locator('#save-status')).toHaveText('已自动保存');
  await page.bringToFront();
  await reveal(page);
  await page.locator('#file-input').setInputFiles(txt);
  await expect(page.locator('#current-book')).toHaveText('长篇测试');
  await expect(page.locator('#save-status')).toHaveText('已自动保存');
  await other.bringToFront();
  await reveal(other);
  await other.locator('#next').click();
  await expect(other.locator('#save-error')).toContainText('其他窗口更新');
  await page.bringToFront();
  await page.reload();
  await reveal(page);
  await expect(page.locator('.storage-overlay')).toHaveCount(0);
  await expect(page.locator('#current-book')).toHaveText('长篇测试');
});
