import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { createAutosave } from '../src/lib/autosave.mjs';

test('写入期间的变化串行保存，连续滚动不会无限推迟保存', async () => {
  let value = 1;
  let release;
  const saved = [];
  const statuses = [];
  const writer = createAutosave({ delay: 10, snapshot: () => value, status: s => statuses.push(s), save: async snapshot => {
    saved.push(snapshot);
    if (snapshot === 1) await new Promise(resolve => { release = resolve; });
  } });
  writer.changed();
  await sleep(20);
  assert.deepEqual(saved, [1]);
  value = 2; writer.changed();
  value = 3; writer.changed();
  assert.deepEqual(saved, [1]);
  release();
  await sleep(20);
  assert.deepEqual(saved, [1, 3]);
  assert.equal(statuses.at(-1), 'saved');
  await writer.stop();
});

test('失败后自动重试最新快照，关闭时立即提交等待中的变化', async () => {
  let value = 1;
  let attempts = 0;
  const saved = [];
  const statuses = [];
  const writer = createAutosave({ delay: 1000, retryDelay: 15, snapshot: () => value, status: s => statuses.push(s), save: async snapshot => {
    if (++attempts === 1) throw new Error('磁盘失败');
    saved.push(snapshot);
  } });
  writer.changed();
  await writer.flush();
  assert.equal(statuses.at(-1), 'error');
  value = 2; writer.changed();
  await sleep(35);
  assert.deepEqual(saved, [2]);
  value = 3; writer.changed();
  await writer.stop();
  assert.deepEqual(saved, [2, 3]);
});

test('版本冲突停止重试，不覆盖其他窗口的书架', async () => {
  let attempts = 0;
  const writer = createAutosave({ delay: 1, retryDelay: 1, snapshot: () => ({}), status: () => {}, save: async () => {
    attempts++;
    throw Object.assign(new Error('书架已在其他窗口更新'), { code: -32009 });
  } });
  writer.changed();
  await writer.flush();
  writer.changed();
  await sleep(20);
  assert.equal(attempts, 1);
  await writer.stop();
});
