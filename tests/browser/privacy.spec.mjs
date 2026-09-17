import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

const demo = JSON.parse(readFileSync(new URL('../../src/data/query-demo.json', import.meta.url), 'utf8'));
const demoSql = readFileSync(new URL('../../src/data/query-demo.sql', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

async function sandbox(page) {
  await page.goto('http://127.0.0.1:5191/sandbox');
  const reader = page.frameLocator('iframe');
  await expect(reader.locator('.storage-overlay')).toHaveCount(0);
  return reader;
}

async function hostNavigation(page) {
  await page.evaluate(() => {
    const frame = document.querySelector('iframe');
    const tabs = document.createElement('nav');
    tabs.style = 'height:32px;display:flex;background:#eee;gap:12px';
    for (const name of ['SQL 查询', 'users 表', '新建查询']) {
      const button = document.createElement('button');
      button.textContent = name;
      button.onclick = () => { frame.style.display = name === '新建查询' ? 'block' : 'none'; };
      tabs.append(button);
    }
    document.body.prepend(tabs);
    frame.style.height = 'calc(100% - 32px)';
  });
}

test('默认显示新建查询，展开后的正文呈 SQL 注释，Esc 可往返', async ({ page }) => {
  const reader = await sandbox(page);
  await expect(reader.locator('#privacy-screen')).toBeVisible();
  await expect(reader.locator('#reader-app')).toBeHidden();
  await expect.poll(() => page.frames()[1].evaluate(() => document.title)).toBe('新建查询');
  await expect(reader.locator('#privacy-screen')).not.toContainText('waitWork');
  await expect(reader.locator('#privacy-screen')).not.toContainText('雨停之前');
  await reader.locator('#query-draft').fill('SELECT 1;');
  await reader.locator('#restore-reading').click();
  await expect(reader.locator('#reader-app')).toBeVisible();
  await expect(reader.locator('#sidebar')).toBeHidden();
  await expect(reader.locator('#chapter-title')).toContainText('-- 第一章');
  await expect(reader.locator('#paragraphs p').first()).toHaveAttribute('data-line', '3');
  await expect(reader.locator('#reader-app .query-toolbar')).toContainText('新建查询');
  await expect(reader.locator('#reader-app .query-toolbar')).not.toContainText('阅读');
  await reader.locator('#reading-scroll').focus();
  await page.keyboard.press('Escape');
  await expect(reader.locator('#privacy-screen')).toBeVisible();
  await expect(reader.locator('#query-draft')).toHaveValue('SELECT 1;');
  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/query-cover.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(reader.locator('#reader-app')).toBeVisible();
});

test('长 SQL 与结果快照一致，编辑标记旧结果，恢复与滚动不泄露正文', async ({ page }) => {
  const reader = await sandbox(page);
  await expect(reader.locator('#query-draft')).toHaveValue(demoSql);
  expect(demoSql.split('\n').length).toBeGreaterThan(800);
  await expect(reader.locator('.sql-gutter > div')).toHaveCount(demoSql.split('\n').length);
  await expect(reader.locator('#privacy-screen .result-grid tbody tr')).toHaveCount(demo.rows.length);
  await expect(reader.locator('#privacy-screen .result-grid thead th')).toHaveCount(demo.columns.length + 1);
  for (let col = 0; col < demo.columns.length; col++) {
    await expect(reader.locator('.result-grid thead th').nth(col + 1)).toContainText(demo.columns[col].name);
    const value = demo.rows[0][col];
    const displayed = value == null ? 'NULL' : demo.columns[col].type === 'DECIMAL' ? value.toFixed(2) : String(value);
    await expect(reader.locator('.result-grid tbody tr').first().locator('td').nth(col)).toHaveText(displayed);
  }
  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/query-demo.png', fullPage: true });
  await reader.locator('#query-draft').evaluate(el => { el.scrollTop = 1200; });
  await expect.poll(() => reader.locator('.sql-highlight').evaluate(el => el.scrollTop)).toBe(1200);
  await expect.poll(() => reader.locator('.sql-gutter').evaluate(el => el.scrollTop)).toBe(1200);
  await reader.locator('#query-draft').fill("SELECT '<img src=x onerror=alert(1)>';");
  await expect(reader.locator('.sql-highlight img')).toHaveCount(0);
  await expect(reader.locator('.result-stale')).toContainText('SQL 已修改');
  await reader.locator('#reset-query').click();
  await expect(reader.locator('#query-draft')).toHaveValue(demoSql);
  await expect(reader.locator('.result-stale')).toHaveCount(0);
  await reader.locator('#privacy-screen').getByRole('tab', { name: '消息', exact: true }).click();
  await expect(reader.locator('.query-messages')).toContainText('返回 24 行，17 列');
  await reader.locator('#privacy-screen').getByRole('tab', { name: '结果 1', exact: true }).click();
  await reader.locator('#restore-reading').click();
  await reader.locator('#open-settings').click();
  await reader.locator('[data-theme-choice="dark"]').click();
  await reader.locator('#close-settings').click();
  await reader.locator('#hide-reading').click();
  await page.screenshot({ path: 'test-results/screenshots/query-demo-dark.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.frames()[1].evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: 'test-results/screenshots/query-demo-mobile.png', fullPage: true });
  await expect(reader.locator('#reader-app')).toBeHidden();
});

test('切换宿主 SQL 和表格后自动收起，返回保持收起且不抢焦点', async ({ page }) => {
  const reader = await sandbox(page);
  await hostNavigation(page);
  for (const tab of ['SQL 查询', 'users 表']) {
    await reader.locator('#restore-reading').click();
    await reader.locator('#open-settings').click();
    await expect(reader.locator('#settings-dialog')).toBeVisible();
    await page.getByRole('button', { name: tab, exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.activeElement.textContent)).toBe(tab);
    await page.getByRole('button', { name: '新建查询', exact: true }).click();
    await expect(reader.locator('#privacy-screen')).toBeVisible();
    await expect(reader.locator('#settings-dialog')).not.toBeVisible();
    await expect(reader.locator('#reader-app')).toBeHidden();
    expect(await page.evaluate(() => document.activeElement.textContent)).toBe('新建查询');
  }
});

test('宿主仅用 display:none 隐藏祖先，没有 blur 也能收起', async ({ page }) => {
  // 独立验证可见性检测，不让失焦监听掩盖缺陷。
  await page.addInitScript(() => window.addEventListener('blur', event => event.stopImmediatePropagation(), true));
  const reader = await sandbox(page);
  await reader.locator('#restore-reading').click();
  await expect(reader.locator('#reader-app')).toBeVisible();
  const frame = page.frames()[1];
  await page.evaluate(() => {
    document.body.id = 'workbench-tab';
    document.body.style.display = 'none';
  });
  await expect.poll(() => frame.evaluate(() => document.querySelector('#reader-app').hidden)).toBe(true);
  await page.evaluate(() => { document.querySelector('#workbench-tab').style.display = ''; });
  await expect(reader.locator('#privacy-screen')).toBeVisible();
  await expect(reader.locator('#reader-app')).toBeHidden();
  await reader.locator('#restore-reading').click();
  await expect(reader.locator('#reader-app')).toBeVisible();
});

test('仅移出焦点也收起，导入确认不会在收起页面上弹出', async ({ page }) => {
  const reader = await sandbox(page);
  await hostNavigation(page);
  await reader.locator('#restore-reading').click();
  await reader.locator('#file-input').setInputFiles({ name: '测试.txt', mimeType: 'text/plain', buffer: Buffer.from('第一章 测试\n本地正文') });
  await expect(reader.locator('#current-book')).toHaveText('测试');
  await page.getByRole('button', { name: '新建查询', exact: true }).click();
  await expect(reader.locator('#privacy-screen')).toBeVisible();
  const archive = { format: 'xidu', version: 1, books: [{ id: 'restore-book', title: '恢复', text: '第一章 恢复\n恢复的正文', position: 0 }], activeId: 'restore-book', settings: {} };
  await reader.locator('#file-input').setInputFiles({ name: '旧存档.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(archive)) });
  await expect(reader.locator('#confirm-dialog')).not.toBeVisible();
  await expect(reader.locator('#privacy-screen')).toBeVisible();
  await reader.locator('#restore-reading').click();
  await expect(reader.locator('#confirm-dialog')).toBeVisible();
  await reader.locator('#confirm-ok').click();
  await expect(reader.locator('#paragraphs')).toContainText('恢复的正文');
});
