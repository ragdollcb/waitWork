import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const bookPath = '/Book/19/19392/';
const chapters = [1, 2, 3].map((n) => ({ path: `${bookPath}${13590538 + n}.html`, title: `第${n}章 测试章节` }));
const body = (index) => `第 ${index + 1} 章的正文。\n` + '这里是用于测试阅读进度的原创段落。\n'.repeat(150) + '<img src=x onerror="window.pwned=true">';

async function fixtures(page, chapterCount = 3) {
  const chapters = Array.from({ length: chapterCount }, (_, index) => ({ path: `${bookPath}${13590539 + index}.html`, title: `第${index + 1}章 测试章节` }));
  const catalog = { bookPath, title: '在线测试小说', author: '测试作者', intro: '固定书源测试简介。', chapters };
  const cache = new Map();
  const calls = [];
  const control = { offline: false, gate: null, refreshFails: false, searchFails: false, empty: false };
  await page.route('**/rpc', async route => {
    const { method, params } = route.request().postDataJSON();
    if (!method.startsWith('source/')) return route.continue();
    calls.push({ method, params });
    let result;
    if (method === 'source/search') {
      if (control.searchFails) return route.fulfill({ json: { error: { message: '书源限制访问，请稍后重试' } } });
      result = { books: control.empty ? [] : [catalog], page: params.page, hasNext: !control.empty && params.page === 1 };
    }
    if (method === 'source/catalog') {
      if (params.refresh && control.refreshFails) return route.fulfill({ json: { error: { message: '目录刷新失败，请重试' } } });
      result = catalog;
    }
    if (method === 'source/chapter') {
      const index = chapters.findIndex(chapter => chapter.path === params.chapterPath);
      if (control.gate && index === 1) await control.gate;
      if ((control.offline || !params.allowNetwork) && !cache.has(`${params.origin}:${index}`)) return route.fulfill({ json: { error: { message: '无法连接书源，请检查网络后重试' } } });
      result = cache.get(`${params.origin}:${index}`) || { path: chapters[index].path, title: chapters[index].title, text: body(index), cached: true };
      cache.set(`${params.origin}:${index}`, result);
    }
    await route.fulfill({ json: { result } });
  });
  return { cache, calls, control };
}
async function reveal(page) {
  const reader = page.frameLocator('iframe');
  await expect(reader.locator('.storage-overlay')).toHaveCount(0);
  if (await reader.locator('#privacy-screen').isVisible()) await reader.locator('#restore-reading').click();
  return reader;
}
async function configure(reader, origin = 'https://www.biquge001.com') {
  await reader.locator('#open-settings').click();
  await reader.locator('#source-url').fill(origin);
  await reader.locator('#save-source').click();
  await reader.locator('#close-settings').click();
}
async function start(page, chapterCount = 3) {
  await page.goto('http://127.0.0.1:5191/sandbox');
  const reader = await reveal(page);
  await configure(reader);
  await reader.locator('#toggle-sidebar').click();
  await reader.locator('#tab-online').click();
  await reader.locator('#online-query').fill('测试小说');
  await reader.locator('#online-submit').click();
  await reader.locator('.online-result').click();
  await expect(reader.locator('.online-intro')).toContainText('测试简介');
  await expect(reader.locator('.online-search .chapter-button')).toHaveCount(Math.min(200, chapterCount));
  await reader.locator('#online-start').click();
  await expect(reader.locator('#chapter-title')).toHaveText(`-- ${chapters[0].title}`);
  return reader;
}

test('在线搜索、目录、翻章、进度恢复与离线缓存，正文不执行 HTML', async ({ page }) => {
  const { control } = await fixtures(page);
  const reader = await start(page);
  await expect(reader.locator('#paragraphs img')).toHaveCount(0);
  await reader.locator('#next').click();
  await expect(reader.locator('#chapter-title')).toContainText(chapters[1].title);
  await reader.locator('#reading-scroll').evaluate(el => { el.scrollTop = 600; });
  await expect.poll(() => reader.locator('#reading-scroll').evaluate(el => el.scrollTop)).toBeGreaterThan(100);
  await expect(reader.locator('#save-status')).toHaveText('已自动保存');
  control.offline = true;
  await page.reload();
  await reveal(page);
  await expect(reader.locator('#chapter-title')).toContainText(chapters[1].title);
  await expect.poll(() => reader.locator('#reading-scroll').evaluate(el => el.scrollTop)).toBeGreaterThan(100);
  await reader.locator('#next').click();
  await expect(reader.locator('#retry-chapter')).toBeVisible();
  await expect(reader.locator('#reading-scroll')).toContainText('无法连接书源');
  control.offline = false;
  await reader.locator('#retry-chapter').click();
  await expect(reader.locator('#chapter-title')).toContainText(chapters[2].title);
  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/online-reading.png' });
});

test('大纲滚动到底自动追加章节，搜索结果也能继续加载', async ({ page }) => {
  await fixtures(page, 450);
  const reader = await start(page, 450);
  const buttons = reader.locator('#chapter-list .chapter-button');
  const panel = reader.locator('#toc-panel');
  await expect(buttons).toHaveCount(200);
  await panel.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(buttons).toHaveCount(400);
  await expect(reader.locator('#chapter-title')).toContainText(chapters[0].title);
  await panel.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(buttons).toHaveCount(450);
  await buttons.nth(239).click();
  await expect(reader.locator('#chapter-title')).toContainText('第240章 测试章节');
  await reader.locator('#chapter-search').fill('测试章节');
  await expect(buttons).toHaveCount(200);
  await panel.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(buttons).toHaveCount(400);
  await panel.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(buttons).toHaveCount(450);
  await reader.locator('#chapter-search').fill('不存在的章节');
  await expect(buttons).toHaveCount(0);
  await expect(reader.locator('#chapter-empty')).toBeVisible();
});

test('大纲向上连续加载到第一章，并保持原章节位置', async ({ page }) => {
  await fixtures(page, 650);
  const reader = await start(page, 650);
  const panel = reader.locator('#toc-panel');
  const buttons = reader.locator('#chapter-list .chapter-button');
  await reader.locator('#chapter-search').fill('第600章');
  await buttons.first().click();
  await expect(reader.locator('#chapter-title')).toContainText('第600章');
  await reader.locator('#chapter-search').fill('');
  await expect(buttons.first()).toContainText('第550章');
  for (const first of [350, 150, 1]) {
    const offset = await panel.evaluate(async el => {
      // 先离开顶部，确保下一次拖到顶部产生真实 scroll 事件。
      el.scrollTop = 250;
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      el.scrollTop = 0;
      const anchor = el.querySelector('.chapter-button');
      const before = anchor.getBoundingClientRect().top;
      for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
      return { before, after: anchor.getBoundingClientRect().top };
    });
    await expect(buttons.first()).toContainText(`第${first}章`);
    expect(Math.abs(offset.after - offset.before)).toBeLessThanOrEqual(1);
    await expect(reader.locator('#chapter-title')).toContainText('第600章');
  }
  await buttons.first().click();
  await expect(reader.locator('#chapter-title')).toContainText(chapters[0].title);
});

test('在线正文滚动更新进度时不回弹', async ({ page }) => {
  await fixtures(page);
  const reader = await start(page);
  const positions = await reader.locator('#reading-scroll').evaluate(async el => {
    const settle = async () => {
      for (let i = 0; i < 8; i++) await new Promise(requestAnimationFrame);
    };
    await settle();
    const positions = [];
    for (const top of [317, 653, 991, 1327, 867]) {
      el.scrollTop = top;
      const before = el.scrollTop;
      await settle();
      positions.push({ before, after: el.scrollTop });
    }
    return positions;
  });
  for (const { before, after } of positions) expect(after).toBe(before);
  await expect(reader.locator('#save-status')).toHaveText('已自动保存');
});

test('快速切章和隐藏期间迟到响应不覆盖新章节、不展开正文', async ({ page }) => {
  const { control, calls } = await fixtures(page);
  const reader = await start(page);
  let release;
  control.gate = new Promise(resolve => { release = resolve; });
  await reader.locator('#next').click();
  await expect.poll(() => calls.filter(call => call.method === 'source/chapter' && call.params.chapterPath === chapters[1].path).length).toBe(1);
  await reader.locator('#next').click();
  await expect(reader.locator('#chapter-title')).toContainText(chapters[2].title);
  await reader.locator('#reading-scroll').focus();
  await page.keyboard.press('Escape');
  release();
  await expect(reader.locator('#privacy-screen')).toBeVisible();
  await reader.locator('#restore-reading').click();
  await expect(reader.locator('#chapter-title')).toContainText(chapters[2].title);
  control.refreshFails = true;
  await reader.locator('#refresh-online').click();
  await expect(reader.locator('#toast')).toContainText('目录刷新失败');
  await expect(reader.locator('#chapter-title')).toContainText(chapters[2].title);
});

test('重复加入不会复制书籍，在线与本地混合书架可以保存和移除', async ({ page }) => {
  await fixtures(page);
  const reader = await start(page);
  await reader.locator('#tab-online').click();
  await reader.locator('#online-start').click();
  await expect(reader.locator('#book-count')).toHaveText('1 项');
  await reader.locator('#file-input').setInputFiles({ name: '本地测试.txt', mimeType: 'text/plain', buffer: Buffer.from('第一章 本地\n本地内容。') });
  await expect(reader.locator('#current-book')).toHaveText('本地测试');
  await reader.locator('#tab-shelf').click();
  await reader.getByRole('button', { name: '阅读 在线测试小说', exact: true }).click();
  await expect(reader.locator('#chapter-title')).toContainText(chapters[0].title);
  await reader.getByRole('button', { name: '移除 在线测试小说', exact: true }).click();
  await reader.locator('#confirm-ok').click();
  await expect(reader.locator('#current-book')).toHaveText('本地测试');
  await expect(reader.locator('#save-status')).toHaveText('已自动保存');
  await page.reload();
  await reveal(page);
  await expect(reader.locator('#current-book')).toHaveText('本地测试');
});

test('搜索分页、空结果、重试和移动端目录展示', async ({ page }) => {
  const { control, calls } = await fixtures(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:5191/sandbox');
  const reader = await reveal(page);
  await configure(reader);
  await reader.locator('#toggle-sidebar').click();
  await reader.locator('#tab-online').click();
  await reader.locator('#online-query').fill('测试');
  await reader.locator('#online-query').press('Enter');
  await expect(reader.locator('.online-result')).toHaveCount(1);
  await reader.getByRole('navigation', { name: '搜索分页' }).getByRole('button', { name: '下一页' }).click();
  await expect(reader.locator('.online-pages span')).toHaveText('2');
  expect(calls.some(call => call.method === 'source/search' && call.params.page === 2)).toBe(true);
  control.empty = true;
  await reader.locator('#online-submit').click();
  await expect(reader.locator('.online-search')).toContainText('没有找到相关小说');
  control.empty = false;
  control.searchFails = true;
  await reader.locator('#online-submit').click();
  await expect(reader.locator('.online-error')).toContainText('书源限制访问');
  control.searchFails = false;
  await reader.locator('.online-error button').click();
  await reader.locator('.online-result').click();
  await expect(reader.locator('.online-search .chapter-button')).toHaveCount(3);
  expect(await page.frames()[1].evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  control.refreshFails = true;
  await reader.locator('.online-search').getByRole('button', { name: '刷新目录', exact: true }).click();
  await expect(reader.locator('.online-error')).toContainText('目录刷新失败');
  await expect(reader.locator('.online-search .chapter-button')).toHaveCount(3);
  control.refreshFails = false;
  await reader.locator('.online-error button').click();
  await expect(reader.locator('.online-error')).toHaveCount(0);
  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/online-mobile-catalog.png' });
  await reader.locator('.online-search .chapter-button').nth(1).click();
  await expect(reader.locator('#chapter-title')).toContainText(chapters[1].title);
  await expect(reader.locator('#sidebar')).toBeHidden();
});

test('网址默认留空，校验、保存恢复与清空后禁用搜索', async ({ page }) => {
  const { calls } = await fixtures(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:5191/sandbox');
  const reader = await reveal(page);
  await reader.locator('#toggle-sidebar').click();
  await reader.locator('#tab-online').click();
  await expect(reader.locator('#online-query')).toBeDisabled();
  expect(calls).toHaveLength(0);
  await reader.locator('#configure-source').click();
  await expect(reader.locator('#source-url')).toHaveValue('');
  await expect(reader.locator('#source-example')).toContainText('https://www.biquge001.com/');
  await reader.locator('#source-url').fill('http://example.com');
  await reader.locator('#save-source').click();
  await expect(reader.locator('#source-url-error')).toBeVisible();
  await reader.locator('#source-url').fill('https://books.example.com/');
  await reader.locator('#save-source').click();
  await expect(reader.locator('#source-url')).toHaveValue('https://books.example.com');
  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/source-settings.png' });
  await reader.locator('#close-settings').click();
  await expect(reader.locator('#save-status')).toHaveText('已自动保存');
  await page.reload();
  await reveal(page);
  await reader.locator('#open-settings').click();
  await expect(reader.locator('#source-url')).toHaveValue('https://books.example.com');
  await reader.locator('#close-settings').click();
  await reader.locator('#toggle-sidebar').click();
  await reader.locator('#tab-online').click();
  await reader.locator('#online-query').fill('测试');
  await reader.locator('#online-submit').click();
  await expect(reader.locator('.online-result')).toHaveCount(1);
  expect(calls.at(-1).params.origin).toBe('https://books.example.com');
  await configure(reader, '');
  await expect(reader.locator('#online-query')).toBeDisabled();
  await expect(reader.locator('.online-result')).toHaveCount(0);
});

test('清空来源后只读缓存，切换来源后同路径小说分别入架', async ({ page }) => {
  const { calls } = await fixtures(page);
  const reader = await start(page);
  await configure(reader, '');
  await expect(reader.locator('#chapter-title')).toContainText(chapters[0].title);
  await expect.poll(() => calls.at(-1).params.allowNetwork).toBe(false);
  await configure(reader, 'https://other.example.com');
  await reader.locator('#tab-online').click();
  await reader.locator('#online-query').fill('测试');
  await reader.locator('#online-submit').click();
  await reader.locator('.online-result').click();
  await reader.locator('#online-start').click();
  await expect(reader.locator('#book-count')).toHaveText('2 项');
  await expect(reader.locator('#chapter-title')).toContainText(chapters[0].title);
  expect(calls.at(-1).params.origin).toBe('https://other.example.com');
  await expect(reader.locator('#save-status')).toHaveText('已自动保存');
});
