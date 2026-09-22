import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTable, formatTable, validateCover, SQL_LIMIT } from '../src/lib/query-cover.mjs';

const config = (result = null) => ({ title: '订单核对', connectionLabel: '业务库 / MySQL', sql: 'SELECT * FROM orders;', result });

test('结果标签兼容旧存档，允许清空恢复默认，限制类型和长度', () => {
  for (const resultLabel of ['', '订单明细', '😀'.repeat(128)]) assert.doesNotThrow(() => validateCover({ ...config(), resultLabel }));
  assert.doesNotThrow(() => validateCover(config()));
  for (const resultLabel of [null, 123, '😀'.repeat(129)]) assert.throws(() => validateCover({ ...config(), resultLabel }));
});

test('粘贴 Excel 表格保留前导零、空值、中文和引号中的换行', () => {
  const result = parseTable('编号\t备注\t状态\r\n001\t"第一行\r\n第二行 ""引号"""\t\r\n002\tNULL\t完成\r\n', 'select 1');
  assert.deepEqual(result.columns.map(c => c.name), ['编号', '备注', '状态']);
  assert.deepEqual(result.rows, [['001', '第一行\n第二行 "引号"', ''], ['002', 'NULL', '完成']]);
  assert.deepEqual(parseTable(formatTable(result), result.sql), result);
  assert.equal(validateCover(config(result)).result, result);
});

test('空输入清空结果；仅表头合法；末尾空单元格和引号包裹换行不丢失', () => {
  assert.equal(parseTable('', ''), null);
  assert.deepEqual(parseTable('编号\t名称\n', '').rows, []);
  assert.deepEqual(parseTable('a\tb\n1\t', '').rows, [['1', '']]);
  assert.deepEqual(parseTable('a\n"\n"', '').rows, [['\n']]);
  assert.deepEqual(parseTable('a\n""', '').rows, [['']]);
});

test('表头、行列数、引号和输入配额错误均拒绝', () => {
  for (const value of ['a\t\n1\t2', 'a\tb\n1', 'a\n"未结束', 'a\n"已结束"x', Array(51).fill('列').join('\t'), 'a\n' + Array(501).fill('1').join('\n'), 'a'.repeat(1024 * 1024 + 1)]) {
    assert.throws(() => parseTable(value, ''));
  }
  assert.throws(() => validateCover({ ...config(), sql: 'a'.repeat(SQL_LIMIT + 1) }));
  assert.throws(() => validateCover({ ...config(), title: '😀'.repeat(129) }));
  assert.doesNotThrow(() => validateCover({ ...config(), title: '😀'.repeat(128) }));
  assert.throws(() => validateCover(config({ sql: '', columns: [{ name: 'a', type: 'TEXT' }], rows: [[{}]], elapsedMs: 0 })));
  assert.throws(() => validateCover(config({ sql: '', columns: [{ name: 'a', type: 'TEXT' }], rows: [['文'.repeat(400000)]], elapsedMs: 0 })));
  assert.throws(() => validateCover(config({ sql: '', columns: [{ name: 'a', type: 'TEXT' }], rows: [['<'.repeat(180000)]], elapsedMs: 0 })));
});

test('默认样例通过新存储校验，重复列名允许保留', async () => {
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile(new URL('../src/data/query-demo.sql', import.meta.url), 'utf8');
  const result = JSON.parse(await readFile(new URL('../src/data/query-demo.json', import.meta.url), 'utf8'));
  assert.doesNotThrow(() => validateCover({ ...config(), sql, result: { ...result, sql } }));
  assert.deepEqual(parseTable('id\tid\n001\t002', '').columns.map(c => c.name), ['id', 'id']);
});
