// 仅用于识别旧版书架的来源；新配置始终留空，不以此作为联网默认值。
export const LEGACY_SOURCE_ORIGIN = 'https://www.biquge001.com';

export function normalizeSourceURL(value) {
  if (typeof value !== 'string') throw new Error('请输入网站首页的 HTTPS 地址。');
  const input = value.trim();
  if (!input) return '';
  let url;
  try { url = new URL(input); } catch { throw new Error('请输入完整的网站首页地址，例如 https://example.com/。'); }
  const labels = url.hostname.split('.');
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/'
    || url.hostname.length > 253 || labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    || /^[\d.]+$/.test(url.hostname) || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local')) {
    throw new Error('请填写公网网站的 HTTPS 首页地址，不含账号、端口、路径或查询参数。');
  }
  return url.origin;
}
