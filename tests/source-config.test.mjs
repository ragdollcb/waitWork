import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSourceURL } from '../src/lib/source-config.mjs';
import { DEFAULT_SETTINGS, validSettings } from '../src/reader.mjs';
test('书源默认留空，规范化地址，错误配置不回退到网站', () => {
  assert.equal(DEFAULT_SETTINGS.sourceURL, '');
  assert.equal(validSettings({ sourceURL: 'http://example.com' }).sourceURL, '');
  assert.equal(normalizeSourceURL(' HTTPS://Example.COM/ '), 'https://example.com');
  assert.equal(normalizeSourceURL(''), '');
  for (const value of ['http://example.com', 'https://localhost', 'https://127.0.0.1', 'https://x.local', 'https://user@example.com', 'https://example.com/path', 'https://example.com?q=1', 'https://example.com:8080']) assert.throws(() => normalizeSourceURL(value));
});
