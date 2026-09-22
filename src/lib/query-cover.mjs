export const COVER_LIMIT = 1024 * 1024;
export const SQL_LIMIT = 256 * 1024;
const bytes = value => new TextEncoder().encode(value).length;

export function validateCover(data) {
  for (const [key, label] of [['title', '查询名称'], ['connectionLabel', '连接显示名']]) {
    if (typeof data?.[key] !== 'string' || !data[key].trim() || [...data[key]].length > 128) throw new Error(`${label}不能为空且不能超过 128 个字符。`);
  }
  if (data.resultLabel !== undefined && (typeof data.resultLabel !== 'string' || [...data.resultLabel].length > 128)) throw new Error('结果标签名称不能超过 128 个字符。');
  if (typeof data.sql !== 'string' || bytes(data.sql) > SQL_LIMIT) throw new Error('SQL 不能超过 256 KiB。');
  const result = data.result;
  if (result !== null) {
    if (!result || typeof result.sql !== 'string' || bytes(result.sql) > SQL_LIMIT
      || !Array.isArray(result.columns) || !result.columns.length || result.columns.length > 50
      || !Array.isArray(result.rows) || result.rows.length > 500
      || !Number.isFinite(result.elapsedMs) || result.elapsedMs < 0) throw new Error('查询结果无效，最多支持 500 行、50 列。');
    for (const column of result.columns) {
      if (!column || typeof column.name !== 'string' || !column.name.trim() || [...column.name].length > 128
        || !['TEXT', 'INTEGER', 'DECIMAL'].includes(column.type)) throw new Error('列名不能为空或超过 128 个字符，列类型必须有效。');
    }
    for (const row of result.rows) {
      if (!Array.isArray(row) || row.length !== result.columns.length
        || row.some(value => value !== null && typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value)))) throw new Error('结果表每行的列数必须与表头一致，单元格必须是文本或数字。');
    }
  }
  // Go 的 JSON 存档会转义 HTML 字符和行分隔符，按实际落盘大小预留修订号空间。
  const encoded = JSON.stringify({ revision: Number.MAX_SAFE_INTEGER, data }).replace(/[<>&\u2028\u2029]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
  if (bytes(encoded) > COVER_LIMIT) throw new Error('查询内容不能超过 1 MiB，请减少 SQL 或表格数据。');
  return data;
}

// Excel 的制表符文本允许引号包裹单元格；双引号转义为两个双引号。
export function parseTable(text, sql) {
  if (bytes(text) > COVER_LIMIT) throw new Error('表格内容不能超过 1 MiB。');
  if (!text.trim()) return null;
  text = text.replace(/\r\n?/g, '\n');
  const rows = [];
  let row = [], cell = '', quoted = false, closed = false;
  const pushCell = () => { row.push(cell); cell = ''; closed = false; if (row.length > 50) throw new Error('结果表最多支持 50 列。'); };
  const pushRow = () => { pushCell(); rows.push(row); row = []; if (rows.length > 501) throw new Error('结果表最多支持 500 行数据。'); };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else { quoted = false; closed = true; }
      } else cell += char;
    } else if (char === '\t') pushCell();
    else if (char === '\n') pushRow();
    else if (closed) throw new Error('引号结束后只能是制表符或换行。');
    else if (char === '"' && cell === '') quoted = true;
    else cell += char;
  }
  if (quoted) throw new Error('表格中的引号尚未闭合。');
  if (!text.endsWith('\n') || row.length || cell || closed) pushRow();
  const headers = rows.shift();
  if (headers.some(name => !name.trim() || [...name].length > 128)) throw new Error('第一行必须是非空表头，每个列名最多 128 个字符。');
  if (rows.some(values => values.length !== headers.length)) throw new Error('结果表每行的列数必须与表头一致。');
  return { sql, columns: headers.map(name => ({ name, type: 'TEXT' })), rows, elapsedMs: 0 };
}

export function formatTable(result) {
  if (!result) return '';
  const cell = value => {
    const text = value == null ? 'NULL' : String(value);
    return /[\t\n\r"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [result.columns.map(column => column.name), ...result.rows].map(row => row.map(cell).join('\t')).join('\n');
}
