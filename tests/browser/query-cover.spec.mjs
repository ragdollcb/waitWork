import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

async function open(page) {
  await page.goto('http://127.0.0.1:5191/sandbox');
  const reader = page.frameLocator('iframe');
  await expect(reader.locator('.storage-overlay')).toHaveCount(0);
  await expect(reader.locator('#cover-save-status')).toHaveText('已保存');
  return reader;
}
const sql = 'SELECT order_id, status FROM daily_orders;';
const table = '订单编号\t处理状态\t备注\n001\t待审核\t\n002\t已完成\t"第一行\n第二行"';

test('自定义 SQL、名称和粘贴结果自动保存，刷新后恢复且不覆盖书架', async ({ page }) => {
  const reader = await open(page);
  await reader.locator('#query-draft').fill(sql);
  await reader.locator('#open-query-settings').click();
  await reader.locator('#query-title').fill('每日订单核对');
  await reader.locator('#query-connection').fill('订单分析 / MySQL');
  await reader.locator('#query-table').fill(table);
  await expect(reader.locator('#query-settings-status')).toHaveText('已保存');
  await expect(reader.locator('.query-preview tbody tr')).toHaveCount(2);
  await expect(reader.locator('.query-preview tbody tr').first().locator('td').first()).toHaveText('001');
  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/query-settings.png' });
  await reader.locator('#close-query-settings').click();
  await expect(reader.locator('#reader-app')).toBeHidden();
  await expect(reader.locator('#privacy-screen .result-stale')).toHaveCount(0);
  await page.reload();
  await expect(reader.locator('#cover-save-status')).toHaveText('已保存');
  await expect(reader.locator('#query-draft')).toHaveValue(sql);
  await expect(reader.locator('#privacy-screen .query-name')).toHaveText('每日订单核对');
  await expect(reader.locator('#privacy-screen .query-connection')).toContainText('订单分析 / MySQL');
  await expect(reader.locator('#privacy-screen tbody tr')).toHaveCount(2);
  await expect.poll(() => page.frames()[1].evaluate(() => document.title)).toBe('每日订单核对');
  await reader.locator('#restore-reading').click();
  await expect(reader.locator('#reader-app .query-name')).toHaveText('每日订单核对');
  await reader.locator('#open-settings').click();
  await reader.locator('[data-theme-choice="dark"]').click();
  await reader.locator('#close-settings').click();
  await reader.locator('#hide-reading').click();
  await expect(reader.locator('#query-draft')).toHaveValue(sql);
  await expect(reader.locator('#privacy-screen')).toBeVisible();
  await page.screenshot({ path: 'test-results/screenshots/query-custom-dark.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await reader.locator('#open-query-settings').click();
  await expect(reader.locator('#query-table')).toBeVisible();
  // 全页截图会临时改变宿主视口，触发插件的隐藏检测；使用用户实际看到的视口。
  await page.screenshot({ path: 'test-results/screenshots/query-settings-mobile.png' });
  const bounds = await reader.locator('#query-settings').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
});

test('错误表格保留原结果，文本不会作为 HTML 执行，清空和恢复可持久化', async ({ page }) => {
  const reader = await open(page);
  await reader.locator('#query-draft').fill(sql);
  await reader.locator('#open-query-settings').click();
  await reader.locator('#query-table').fill('编号\t备注\n001\t<img src=x onerror=alert(1)>');
  await expect(reader.locator('#query-settings-status')).toHaveText('已保存');
  await expect(reader.locator('.query-preview img')).toHaveCount(0);
  await expect(reader.locator('.query-preview tbody')).toContainText('<img src=x onerror=alert(1)>');
  await reader.locator('#query-table').fill('a\tb\n1');
  await expect(reader.locator('#query-settings-status')).toContainText('列数');
  await expect(reader.locator('.query-preview tbody')).toContainText('001');
  await reader.locator('#close-query-settings').click();
  await page.reload();
  await expect(reader.locator('#privacy-screen tbody')).toContainText('001');
  await reader.locator('#open-query-settings').click();
  await reader.locator('#query-table').fill('');
  await expect(reader.locator('#query-settings-status')).toHaveText('已保存');
  await reader.locator('#close-query-settings').click();
  await page.reload();
  await expect(reader.locator('#cover-save-status')).toHaveText('已保存');
  await expect(reader.locator('#privacy-screen .result-empty')).toHaveText('暂无查询结果');
  await reader.locator('#reset-query').click();
  await expect(reader.locator('#query-draft')).toHaveValue(sql);
  await reader.locator('#confirm-reset-query').click();
  await expect(reader.locator('#cover-save-status')).toHaveText('已保存');
  await page.reload();
  await expect(reader.locator('#privacy-screen tbody tr')).toHaveCount(24);
  await expect(reader.locator('#query-draft')).not.toHaveValue(sql);
});

test('结果标签自定义、清空和还原预置均可保存，旧存档仍显示默认标签', async ({ page }) => {
  const reader = await open(page);
  await expect(reader.locator('#privacy-screen > .query-results').getByRole('tab', { name: '结果 1', exact: true })).toBeVisible();
  await reader.locator('#open-query-settings').click();
  await reader.locator('#query-result-label').fill('<b>订单明细</b>');
  await expect(reader.locator('.query-preview').getByRole('tab', { name: '<b>订单明细</b>', exact: true })).toBeVisible();
  await expect(reader.locator('.query-preview .result-label b')).toHaveCount(0);
  await expect(reader.locator('#query-settings-status')).toHaveText('已保存');
  await reader.locator('#close-query-settings').click();
  await page.reload();
  await expect(reader.locator('#privacy-screen > .query-results').getByRole('tab', { name: '<b>订单明细</b>', exact: true })).toBeVisible();
  await reader.locator('#open-query-settings').click();
  await expect(reader.locator('#query-result-label')).toHaveValue('<b>订单明细</b>');
  await reader.locator('#query-result-label').fill('超'.repeat(129));
  await expect(reader.locator('#query-settings-status')).toContainText('不能超过 128');
  await reader.locator('#query-result-label').fill('');
  await expect(reader.locator('#query-settings-status')).toHaveText('已保存');
  await reader.locator('#close-query-settings').click();
  await page.reload();
  await expect(reader.locator('#privacy-screen > .query-results').getByRole('tab', { name: '结果 1', exact: true })).toBeVisible();
  await reader.locator('#open-query-settings').click();
  await reader.locator('#query-result-label').fill('自定义结果');
  await reader.locator('#close-query-settings').click();
  await reader.locator('#reset-query').click();
  await reader.locator('#confirm-reset-query').click();
  await expect(reader.locator('#cover-save-status')).toHaveText('已保存');
  await page.reload();
  await expect(reader.locator('#privacy-screen > .query-results').getByRole('tab', { name: '结果 1', exact: true })).toBeVisible();
});

test('Esc 和失焦关闭查询设置，保持阅读正文隐藏', async ({ page }) => {
  const reader = await open(page);
  await reader.locator('#open-query-settings').click();
  await reader.locator('#query-title').fill('安全关闭测试');
  await page.keyboard.press('Escape');
  await expect(reader.locator('#query-settings')).not.toBeVisible();
  await expect(reader.locator('#reader-app')).toBeHidden();
  await expect(reader.locator('#cover-save-status')).toHaveText('已保存');
  await reader.locator('#open-query-settings').click();
  await reader.locator('#query-title').fill('失焦后保留');
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.textContent = '切换宿主页';
    button.style = 'position:fixed;top:0;right:0;z-index:100';
    document.body.append(button);
  });
  await page.getByRole('button', { name: '切换宿主页' }).click();
  await expect(reader.locator('#query-settings')).not.toBeVisible();
  await expect(reader.locator('#reader-app')).toBeHidden();
  await expect(reader.locator('#cover-save-status')).toHaveText('已保存');
  await page.reload();
  await expect(reader.locator('#privacy-screen .query-name')).toHaveText('失焦后保留');
});

test('保存失败重试最终内容，读取失败禁止覆盖且不阻断阅读', async ({ page }) => {
  const reader = await open(page);
  await page.route('**/rpc', async route => {
    if (route.request().postDataJSON().method === 'cover/save') await route.fulfill({ json: { error: { message: '测试查询写入失败' } } });
    else await route.continue();
  });
  await reader.locator('#query-draft').fill(sql);
  await expect(reader.locator('#cover-error')).toContainText('测试查询写入失败');
  await expect(reader.locator('#cover-save-status')).toHaveText('未保存');
  await page.unroute('**/rpc');
  await expect(reader.locator('#cover-save-status')).toHaveText('已保存', { timeout: 10000 });
  let writes = 0;
  await page.route('**/rpc', async route => {
    const method = route.request().postDataJSON().method;
    if (method === 'cover/save') writes++;
    if (method === 'cover/load') await route.fulfill({ json: { error: { message: '测试查询读取失败' } } });
    else await route.continue();
  });
  await page.reload();
  await expect(reader.locator('#cover-error')).toContainText('测试查询读取失败');
  await expect(reader.locator('#query-draft')).toBeDisabled();
  await reader.locator('#restore-reading').click();
  await expect(reader.locator('#reader-app')).toBeVisible();
  expect(writes).toBe(0);
  await reader.locator('#hide-reading').click();
  await page.unroute('**/rpc');
  await reader.locator('#retry-cover').click();
  await expect(reader.locator('#query-draft')).toHaveValue(sql);
  await expect(reader.locator('#cover-save-status')).toHaveText('已保存');
});

test('同一后端的旧窗口不能覆盖更新后的查询', async ({ page, context }) => {
  const first = await open(page);
  const secondPage = await context.newPage();
  const second = await open(secondPage);
  await first.locator('#query-draft').fill('SELECT 111;');
  await expect(first.locator('#cover-save-status')).toHaveText('已保存');
  await second.locator('#query-draft').fill('SELECT 222;');
  await expect(second.locator('#cover-error')).toContainText('其他窗口');
  await secondPage.reload();
  await expect(second.locator('#query-draft')).toHaveValue('SELECT 111;');
});
