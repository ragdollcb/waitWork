import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const targets = ['windows-x64', 'windows-arm64', 'darwin-x64', 'darwin-arm64', 'linux-x64', 'linux-arm64'];
const project = fileURLToPath(new URL('../', import.meta.url));
const inspector = resolve(project, '.agents/skills/dbx-plugin/scripts/inspect-dbxp.mjs');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

export function checkVersion(manifest, pkg, lock, backend, ref = '') {
  assert.equal(pkg.version, manifest.version, 'package.json 与 manifest.json 版本不一致');
  assert.equal(lock.version, manifest.version, 'package-lock.json 版本不一致');
  assert.equal(lock.packages[''].version, manifest.version, 'package-lock.json 根包版本不一致');
  assert.equal(backend.match(/dbx\.Metadata\{ID: "([^"]+)"/)?.[1], manifest.id, '后端插件 ID 不一致');
  assert.equal(backend.match(/dbx\.Metadata\{ID: "[^"]+", Version: "([^"]+)"/)?.[1], manifest.version, '后端版本不一致');
  if (ref.startsWith('refs/tags/')) {
    assert.equal(ref, `refs/tags/v${manifest.version}`, '标签必须是 v 加 manifest.json 的版本号');
  }
}

export function verifyArtifact(directory, manifest, target) {
  assert.ok(targets.includes(target), `不支持的平台：${target}`);
  const name = `${manifest.id}-${manifest.version}-${target}.dbxp`;
  const artifact = readJson(resolve(directory, name.replace(/\.dbxp$/, '.artifact.json')));
  assert.equal(artifact.target, target, '产物 target 不一致');
  assert.equal(artifact.url, name, '产物 URL 必须是当前版本的纯文件名');
  assert.ok(!Object.hasOwn(artifact, 'signingKeyId'), '发布候选不能包含 signingKeyId');
  const bytes = readFileSync(resolve(directory, name));
  assert.equal(artifact.size, bytes.length, '安装包大小与元数据不一致');
  assert.equal(artifact.sha256, createHash('sha256').update(bytes).digest('hex'), '安装包 SHA-256 与元数据不一致');

  const result = spawnSync(process.execPath, [inspector, resolve(directory, name), '--json'], {
    encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `安装包检查失败：${result.error?.message || result.stderr || result.stdout}`);
  const report = JSON.parse(result.stdout);
  assert.equal(report.signed, false, '候选安装包必须未签名');
  // 包内 backend 路径由 CLI 按平台改写，其余字段必须来自同一份源码声明。
  const binary = `bin/${target}/dbx-waitwork${target.startsWith('windows-') ? '.exe' : ''}`;
  const expected = structuredClone(manifest);
  expected.entrypoints.backend.executable = binary;
  assert.deepEqual(report.manifest, expected, '包内声明与源码不一致');
  assert.deepEqual(report.binTargets, [target], '安装包中包含错误平台的后端');
  const executable = report.entries.find((entry) => entry.name === binary);
  assert.ok(executable, '安装包缺少后端程序');
  if (!target.startsWith('windows-')) {
    assert.ok(parseInt(executable.unixMode, 8) & 0o111, 'macOS / Linux 后端缺少可执行权限');
  }
  return { target, url: name, sha256: artifact.sha256, size: artifact.size };
}

export function collectArtifacts(directory, manifest) {
  // 只接受完整的同版本六平台集合，避免混入旧包或漏平台后仍发布。
  const expectedFiles = targets.flatMap((target) => {
    const base = `${manifest.id}-${manifest.version}-${target}`;
    return [`${base}.dbxp`, `${base}.artifact.json`];
  }).sort();
  const actualFiles = readdirSync(directory).filter((name) => /\.(dbxp|artifact\.json)$/.test(name)).sort();
  assert.deepEqual(actualFiles, expectedFiles, '必须包含当前版本全部六个平台的安装包及元数据，且不能混入其他版本');
  const artifacts = targets.map((target) => verifyArtifact(directory, manifest, target));
  const { id, publisher, version, name, description } = manifest;
  return { plugin: { id, publisher, version, name, description }, artifacts };
}

function main() {
  const [command, directory = 'dist/release', target] = process.argv.slice(2);
  const manifest = readJson(resolve(project, 'manifest.json'));
  if (command === 'check') {
    checkVersion(manifest, readJson(resolve(project, 'package.json')), readJson(resolve(project, 'package-lock.json')),
      readFileSync(resolve(project, 'backend/main.go'), 'utf8'), process.env.GITHUB_REF);
    const platform = `${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`;
    if (process.env.DBX_PLUGIN_TARGET) {
      assert.equal(process.env.DBX_PLUGIN_TARGET, platform, '必须使用对应平台和架构的原生构建机');
    }
    console.log(`身份与版本检查通过：${manifest.id}@${manifest.version} (${platform})`);
  } else if (command === 'verify') {
    console.log(JSON.stringify(verifyArtifact(resolve(directory), manifest, target), null, 2));
  } else if (command === 'collect') {
    const candidates = collectArtifacts(resolve(directory), manifest);
    writeFileSync(resolve(directory, 'release-candidates.json'), `${JSON.stringify(candidates, null, 2)}\n`);
    console.log(`已校验全部 ${candidates.artifacts.length} 个平台并生成 release-candidates.json`);
  } else {
    throw new Error('用法：node scripts/release.mjs check | verify <产物目录> <target> | collect <产物目录>');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
