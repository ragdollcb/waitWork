const keywords = new Set('WITH AS SELECT FROM WHERE AND OR ON LEFT INNER CROSS JOIN GROUP BY ORDER DESC ASC CASE WHEN THEN ELSE END DISTINCT OVER PARTITION ROWS BETWEEN UNBOUNDED PRECEDING CURRENT ROW VALUES IS NOT NULL'.split(' '));
const functions = new Set('COUNT SUM MAX MIN AVG ROUND COALESCE NULLIF DENSE_RANK ROW_NUMBER'.split(' '));

// 仅分词并用 Vue 文本插值渲染，编辑的 SQL 不会作为 HTML 执行。
export function highlightSql(sql) {
  const tokens = [];
  const pattern = /--[^\n]*|'(?:''|[^'])*'|\b[A-Za-z_][A-Za-z_0-9]*\b|\b\d+(?:\.\d+)?\b/g;
  let start = 0;
  for (const match of sql.matchAll(pattern)) {
    if (match.index > start) tokens.push({ text: sql.slice(start, match.index), kind: '' });
    const text = match[0];
    const upper = text.toUpperCase();
    const kind = text.startsWith('--') ? 'comment' : text.startsWith("'") ? 'string' : keywords.has(upper) ? 'keyword' : functions.has(upper) ? 'function' : /^\d/.test(text) ? 'number' : '';
    tokens.push({ text, kind });
    start = match.index + text.length;
  }
  if (start < sql.length) tokens.push({ text: sql.slice(start), kind: '' });
  return tokens;
}
