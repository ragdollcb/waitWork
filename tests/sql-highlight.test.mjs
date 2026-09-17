import test from 'node:test';
import assert from 'node:assert/strict';
import { highlightSql } from '../src/lib/sql-highlight.mjs';

test('SQL 分词保留全部字符，识别注释、转义字符串与窗口函数', () => {
  const sql = "-- SELECT 不应变成关键字\nSELECT 'a''b', '<script>', ROUND(1.25, 2), ROW_NUMBER() OVER ();\n";
  const tokens = highlightSql(sql);
  assert.equal(tokens.map(token => token.text).join(''), sql);
  assert.equal(tokens.find(token => token.text.startsWith('--')).kind, 'comment');
  assert.equal(tokens.find(token => token.text === "'a''b'").kind, 'string');
  assert.equal(tokens.find(token => token.text === 'ROW_NUMBER').kind, 'function');
  assert.equal(tokens.find(token => token.text === '1.25').kind, 'number');
  assert.deepEqual(highlightSql(''), []);
});
