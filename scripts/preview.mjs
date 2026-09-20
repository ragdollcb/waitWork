import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const port = Number(process.env.PORT || 5191);
const sessions = new Map();
function backend(id) {
  if (sessions.has(id)) return sessions.get(id);
  const child = spawn(resolve('.dbx-dev/bin', process.platform === 'win32' ? 'dbx-waitwork.exe' : 'dbx-waitwork'), [], {
    env: { ...process.env, WAITWORK_DATA_DIR: resolve('.dbx-dev/preview', id) }, windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'],
  });
  let sequence = 0;
  const pending = new Map();
  createInterface({ input: child.stdout }).on('line', line => {
    const message = JSON.parse(line);
    const request = pending.get(message.id);
    if (request) { clearTimeout(request.timer); pending.delete(message.id); request.resolve(message); }
  });
  const close = () => {
    sessions.delete(id);
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('本地后端已退出')); }
    pending.clear();
  };
  child.on('exit', close);
  child.on('error', close);
  const session = { child, invoke(method, params) {
    return new Promise((resolve, reject) => {
      const requestId = ++sequence;
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('本地保存超时')); }, 15000);
      pending.set(requestId, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n');
    });
  } };
  sessions.set(id, session);
  return session;
}
const directBridge = `<script>window.dbxPlugin={ready:Promise.resolve({}),theme:{appearance:'light'},async invoke(method,params){const r=await fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,params})});const m=await r.json();if(m.error)throw Object.assign(new Error(m.error.message),m.error);return m.result;}};</script>`;
const frameBridge = `<script>
let sequence=0;const pending=new Map();window.addEventListener('message',e=>{if(e.source!==parent||e.data?.type!=='rpc-result')return;const p=pending.get(e.data.id);if(!p)return;pending.delete(e.data.id);clearTimeout(p.timer);if(e.data.error)p.reject(Object.assign(new Error(e.data.error.message),e.data.error));else p.resolve(e.data.result);});
window.dbxPlugin={ready:Promise.resolve({}),theme:{appearance:'light'},invoke(method,params){return new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('本地后端响应超时'));},20000);pending.set(id,{resolve,reject,timer});parent.postMessage({type:'rpc',id,method,params},'*');});}};
</script>`;
const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline' blob:; img-src data: blob:; font-src data: blob:; connect-src 'none'; media-src data: blob:;">`;

createServer(async (request, response) => {
  let id = request.headers.cookie?.match(/(?:^|; )waitwork-preview=([a-f0-9-]{36})(?:;|$)/)?.[1];
  if (!id) { id = randomUUID(); response.setHeader('Set-Cookie', `waitwork-preview=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`); }
  try {
    if (request.url === '/rpc' && request.method === 'POST') {
      if (request.headers.origin !== `http://127.0.0.1:${port}` || request.headers['content-type'] !== 'application/json') { response.writeHead(403).end(); return; }
      const parts = []; let size = 0;
      for await (const part of request) { size += part.length; if (size > 2 * 1024 * 1024) throw new Error('请求过大'); parts.push(part); }
      const { method, params } = JSON.parse(Buffer.concat(parts));
      const result = await backend(id).invoke(method, params);
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result)); return;
    }
    if (!['/', '/sandbox'].includes(request.url) || request.method !== 'GET') { response.writeHead(404).end(); return; }
    let html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
    if (request.url === '/sandbox') {
      // 与 DBX 相同的不透明 origin 和 CSP，父页将请求转交真实 Go 后端。
      const srcdoc = html.replace('<head>', `<head>${csp}${frameBridge}`).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      html = `<!doctype html><html><head><title>Wait Work沙箱验证</title><style>html,body{margin:0;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%}</style>${directBridge}</head><body><iframe title="阅读器" sandbox="allow-scripts" srcdoc="${srcdoc}"></iframe><script>window.addEventListener('message',async e=>{if(e.source!==document.querySelector('iframe').contentWindow||e.data?.type!=='rpc')return;let result,error;try{result=await window.dbxPlugin.invoke(e.data.method,e.data.params);}catch(err){error={message:err.message,code:err.code};}e.source.postMessage({type:'rpc-result',id:e.data.id,result,error},'*');});</script></body></html>`;
    } else html = html.replace('<head>', `<head>${directBridge}`);
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(html);
  } catch (error) { response.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: error.message } })); }
}).listen(port, '127.0.0.1', () => console.log(`Wait Work预览：http://127.0.0.1:${port}`));
process.on('exit', () => { for (const { child } of sessions.values()) child.kill(); });
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => process.exit());
