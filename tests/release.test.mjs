import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkVersion, collectArtifacts, targets, verifyArtifact } from '../scripts/release.mjs';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (value) => Buffer.from(JSON.stringify(value));

// 构造真实 ZIP，让发布检查覆盖包内声明、校验和及 Unix 可执行权限。
function zip(entries, executable = true) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [path, data] of Object.entries(entries)) {
    const name = Buffer.from(path);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(0x0314, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt32LE(crc32(data), 16);
    record.writeUInt32LE(data.length, 20);
    record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(name.length, 28);
    const mode = path.startsWith('bin/') && executable ? 0o100755 : 0o100644;
    record.writeUInt32LE((mode << 16) >>> 0, 38);
    record.writeUInt32LE(offset, 42);
    central.push(record, name);
    offset += header.length + name.length + data.length;
  }
  const index = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(index.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, index, end]);
}

function fixture(directory, target, options = {}) {
  const packed = structuredClone(manifest);
  packed.publisher = options.publisher ?? packed.publisher;
  const binary = `bin/${target}/dbx-waitwork${target.startsWith('windows-') ? '.exe' : ''}`;
  packed.entrypoints.backend.executable = binary;
  const entries = {
    'manifest.json': json(packed),
    'ui/index.html': Buffer.from('<html>Wait Work</html>'),
    'assets/plugin.svg': Buffer.from('<svg/>'),
    'assets/query.svg': Buffer.from('<svg/>'),
    [binary]: Buffer.from('fixture backend'),
  };
  const checksums = Object.fromEntries(Object.entries(entries).map(([name, data]) => [name, hash(data)]));
  if (options.badChecksum) checksums['ui/index.html'] = '0'.repeat(64);
  entries['checksums.json'] = json({ algorithm: 'sha256', files: checksums });
  if (options.signed) entries['signature.json'] = json({ algorithm: 'ed25519', key_id: 'test' });
  if (options.missingBinary) delete entries[binary];
  const bytes = zip(entries, options.executable !== false);
  const name = `${manifest.id}-${manifest.version}-${target}`;
  const artifact = { target, url: `${name}.dbxp`, sha256: hash(bytes), size: bytes.length, ...options.metadata };
  writeFileSync(join(directory, `${name}.dbxp`), bytes);
  writeFileSync(join(directory, `${name}.artifact.json`), json(artifact));
  return artifact;
}

function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), 'waitwork-release-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('发布阻止标签、包版本或后端身份不一致', () => {
  const pkg = { version: manifest.version };
  const lock = { version: manifest.version, packages: { '': pkg } };
  const backend = `dbx.Metadata{ID: "${manifest.id}", Version: "${manifest.version}"}`;
  assert.doesNotThrow(() => checkVersion(manifest, pkg, lock, backend, `refs/tags/v${manifest.version}`));
  assert.throws(() => checkVersion(manifest, pkg, lock, backend, 'refs/tags/v99.0.0'), /标签必须/);
  assert.throws(() => checkVersion(manifest, { version: '0.0.1' }, lock, backend), /版本不一致/);
  assert.throws(() => checkVersion(manifest, pkg, lock, backend.replace(manifest.id, 'local.old')), /后端插件 ID/);
});

test('候选校验拒绝错误哈希、大小、平台、URL 和签名元数据', (t) => {
  const directory = temporary(t);
  const target = 'windows-x64';
  const artifact = fixture(directory, target);
  assert.deepEqual(verifyArtifact(directory, manifest, target), artifact);
  for (const [metadata, error] of [
    [{ sha256: '0'.repeat(64) }, /SHA-256/],
    [{ size: 1 }, /大小/],
    [{ target: 'linux-x64' }, /target/],
    [{ url: 'https://example.com/package.dbxp' }, /纯文件名/],
    [{ signingKeyId: 'test' }, /signingKeyId/],
  ]) {
    fixture(directory, target, { metadata });
    assert.throws(() => verifyArtifact(directory, manifest, target), error);
  }
});

test('包内校验拒绝签名包、身份变化、损坏正文和不可执行后端', (t) => {
  const directory = temporary(t);
  const target = 'linux-arm64';
  for (const [options, error] of [
    [{ signed: true }, /必须未签名/],
    [{ publisher: 'someone-else' }, /包内声明/],
    [{ badChecksum: true }, /安装包检查失败/],
    [{ missingBinary: true }, /安装包检查失败/],
    [{ executable: false }, /可执行权限/],
  ]) {
    fixture(directory, target, options);
    assert.throws(() => verifyArtifact(directory, manifest, target), error);
  }
});

test('汇总只接受完整六平台，拒绝缺包及混入旧版本', (t) => {
  const directory = temporary(t);
  for (const target of targets) fixture(directory, target);
  const candidates = collectArtifacts(directory, manifest);
  assert.equal(candidates.plugin.id, manifest.id);
  assert.equal(candidates.plugin.publisher, 'monstercat');
  assert.deepEqual(candidates.artifacts.map((artifact) => artifact.target), targets);
  assert.ok(candidates.artifacts.every((artifact) => /^[A-Za-z0-9._-]+\.dbxp$/.test(artifact.url)));
  const extra = join(directory, 'old-version.dbxp');
  writeFileSync(extra, 'old package');
  assert.throws(() => collectArtifacts(directory, manifest), /全部六个平台/);
  unlinkSync(extra);
  unlinkSync(join(directory, candidates.artifacts[0].url));
  assert.throws(() => collectArtifacts(directory, manifest), /全部六个平台/);
});
