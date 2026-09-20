import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.argv[2] === '--config') {
  // CLI 0.1.9 生成的 go.work 固定为 Go 1.22。使用项目 go.mod 锁定的 SDK，
  // 避免它覆盖新解析依赖所需的 Go 版本；宿主本身仍由官方 runtime 提供。
  const options = JSON.parse(process.argv[3]);
  if (options.commands?.backend) delete options.commands.backend.goWorkspace;
  const { startDevelopment } = await import('../node_modules/@dbx-app/plugin-cli/dev-runtime/runtime.mjs');
  try { await startDevelopment(options); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
} else {
  const cli = fileURLToPath(new URL('../node_modules/@dbx-app/plugin-cli/bin/dbx-plugin.js', import.meta.url));
  const child = spawn(process.execPath, [cli, 'dev', '--path', '.', '--port', '5190', ...process.argv.slice(2)], {
    env: { ...process.env, DBX_PLUGIN_DEV_RUNTIME: fileURLToPath(import.meta.url) },
    stdio: 'inherit', windowsHide: true,
  });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
}
