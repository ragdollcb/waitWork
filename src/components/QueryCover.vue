<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import QueryToolbar from './QueryToolbar.vue';
import QueryResults from './QueryResults.vue';
import rawSql from '../data/query-demo.sql?raw';
import snapshot from '../data/query-demo.json';
import { highlightSql } from '../lib/sql-highlight.mjs';
import { validateCover, parseTable, formatTable, SQL_LIMIT } from '../lib/query-cover.mjs';
import { invoke } from '../lib/host.js';
import { createAutosave } from '../lib/autosave.mjs';

const emit = defineEmits(['restore', 'title']);
const defaultSQL = rawSql.replace(/\r\n?/g, '\n');
const defaults = () => ({ title: '新建查询', connectionLabel: 'analytics / SQLite', sql: defaultSQL, result: { ...structuredClone(snapshot), sql: defaultSQL } });
const data = ref(defaults());
const draft = ref(defaultSQL);
const title = ref(data.value.title);
const connection = ref(data.value.connectionLabel);
const resultLabel = ref('');
const table = ref('');
const errors = ref({});
const loaded = ref(false);
const loadError = ref('');
const saveError = ref('');
const status = ref('loading');
const editor = ref();
const highlighted = ref();
const gutter = ref();
const dialog = ref();
const settingsOpen = ref(false);
const resetPending = ref(false);
let revision = 0;
let disposed = false;
const message = computed(() => loadError.value || Object.values(errors.value).find(Boolean) || saveError.value);
const label = computed(() => message.value ? '未保存' : ({ loading: '正在加载', saving: '正在保存', saved: '已保存', error: '保存失败' })[status.value]);
const tokens = computed(() => highlightSql(draft.value));
const lineCount = computed(() => draft.value.split('\n').length);
const stale = computed(() => !!data.value.result && draft.value !== data.value.result.sql);
const autosave = createAutosave({
  snapshot: () => JSON.parse(JSON.stringify(data.value)),
  save: async value => { const saved = await invoke('cover/save', { revision, data: value }); revision = saved.revision; },
  status: (value, error = '') => { status.value = value; saveError.value = error; },
});

async function load() {
  loadError.value = '';
  try {
    const saved = await invoke('cover/load');
    if (disposed) return;
    if (!Number.isSafeInteger(saved.revision) || saved.revision < 0 || (saved.revision > 0 && !saved.data)) throw new Error('查询文件不完整。');
    data.value = saved.data ? validateCover(saved.data) : defaults();
    revision = saved.revision;
    draft.value = data.value.sql;
    title.value = data.value.title;
    connection.value = data.value.connectionLabel;
    resultLabel.value = data.value.resultLabel || '';
    loaded.value = true;
    status.value = 'saved';
    emit('title', data.value.title);
    await nextTick();
    syncScroll();
  } catch (error) { if (!disposed) loadError.value = error.message || '无法读取查询内容，请重试。'; }
}
function update(field, changes) {
  if (!loaded.value) return false;
  try {
    const next = validateCover({ ...data.value, ...changes });
    errors.value[field] = '';
    data.value = next;
    emit('title', next.title);
    autosave.changed();
    return true;
  } catch (error) { errors.value[field] = error.message; return false; }
}
function changeSQL(value) {
  // 不把超大粘贴内容送入高亮器；保持最近有效编辑内容。
  if (new TextEncoder().encode(value).length > SQL_LIMIT) { errors.value.sql = 'SQL 不能超过 256 KiB。'; editor.value.value = draft.value; return; }
  draft.value = value;
  update('sql', { sql: value });
}
function changeTable() {
  try { update('table', { result: parseTable(table.value, data.value.sql) }); }
  catch (error) { errors.value.table = error.message; }
}
function syncScroll() {
  if (!editor.value) return;
  highlighted.value.scrollTop = editor.value.scrollTop;
  highlighted.value.scrollLeft = editor.value.scrollLeft;
  gutter.value.scrollTop = editor.value.scrollTop;
}
function openSettings() {
  if (!loaded.value) return;
  title.value = data.value.title;
  connection.value = data.value.connectionLabel;
  resultLabel.value = data.value.resultLabel || '';
  table.value = formatTable(data.value.result);
  errors.value = { sql: errors.value.sql };
  settingsOpen.value = true;
  dialog.value.showModal();
}
function closeSettings() {
  resetPending.value = false;
  settingsOpen.value = false;
  dialog.value?.close();
  if (loaded.value) void autosave.flush();
}
async function resetQuery() {
  data.value = defaults();
  draft.value = data.value.sql;
  title.value = data.value.title;
  connection.value = data.value.connectionLabel;
  resultLabel.value = '';
  table.value = formatTable(data.value.result);
  errors.value = {};
  resetPending.value = false;
  emit('title', data.value.title);
  autosave.changed();
  await nextTick();
  editor.value.scrollTop = editor.value.scrollLeft = 0;
  syncScroll();
}
defineExpose({ closeSettings, isSettingsOpen: () => !!dialog.value?.open || resetPending.value });
onMounted(load);
onBeforeUnmount(() => { disposed = true; void autosave.stop(); });
</script>

<template>
  <section id="privacy-screen" class="query-cover" aria-label="查询工作台">
    <QueryToolbar concealed :snapshot="!!data.result" :query-title="data.title" :connection-label="data.connectionLabel" :saved="label" :error="message" :settings-disabled="!loaded" @settings="openSettings" @toggle="$emit('restore')" />
    <div class="query-filebar"><span class="sql-file-icon" aria-hidden="true">SQL</span><span class="query-filename">{{ data.title }}.sql</span><span class="query-spacer"></span><span>{{ lineCount }} 行</span><button id="reset-query" :disabled="!loaded" title="恢复预置查询" aria-label="恢复预置查询" @click="resetPending = true">↶</button></div>
    <div v-if="message" id="cover-error" class="cover-notice" role="alert">{{ message }}<button v-if="loadError" id="retry-cover" class="button" @click="load">重新读取</button></div>
    <div v-if="resetPending" class="cover-notice" role="group" aria-label="恢复预置查询确认">恢复预置查询会替换当前内容并自动保存。<button id="confirm-reset-query" class="button" @click="resetQuery">确认恢复</button><button class="button" @click="resetPending = false">取消</button></div>
    <div class="sql-editor">
      <div ref="gutter" class="sql-gutter" aria-hidden="true"><div v-for="line in lineCount" :key="line">{{ line }}</div></div>
      <div class="sql-surface">
        <pre ref="highlighted" class="sql-highlight" aria-hidden="true"><span v-for="(token, index) in tokens" :key="index" :class="token.kind ? `sql-${token.kind}` : undefined">{{ token.text }}</span>{{ '\n' }}</pre>
        <textarea id="query-draft" ref="editor" :value="draft" :disabled="!loaded" wrap="off" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="SQL 编辑器" @input="changeSQL($event.target.value)" @scroll="syncScroll" />
      </div>
    </div>
    <QueryResults :snapshot="data.result" :stale="stale" :result-label="data.resultLabel" />
    <dialog id="query-settings" ref="dialog" class="settings-dialog query-settings" aria-labelledby="query-settings-title" @cancel.prevent="closeSettings" @close="resetPending = false">
      <div class="dialog-heading"><h2 id="query-settings-title">查询设置</h2><button id="close-query-settings" class="icon-button" aria-label="关闭查询设置" @click="closeSettings">×</button></div>
      <p class="settings-help">修改后自动保存到本机。SQL 和结果仅用于展示，不会连接数据库执行。</p>
      <label for="query-title">查询名称</label><input id="query-title" v-model="title" class="search" @input="update('title', { title })">
      <label for="query-connection">连接显示名</label><input id="query-connection" v-model="connection" class="search" @input="update('connection', { connectionLabel: connection })">
      <label for="query-result-label">结果标签名称</label><input id="query-result-label" v-model="resultLabel" class="search" placeholder="留空使用默认名称：结果 1" @input="update('resultLabel', { resultLabel })">
      <label for="query-table">结果表</label><p id="query-table-help" class="settings-help">从 Excel 或查询结果复制并粘贴，第一行是列名，最多 500 行数据、50 列。清空可移除结果；修改 SQL 后重新粘贴可更新对应关系。</p>
      <textarea id="query-table" v-model="table" class="query-table-input" aria-describedby="query-table-help" spellcheck="false" @input="changeTable" />
      <p id="query-settings-status" class="settings-help" role="status">{{ message || label }}</p>
      <div v-if="settingsOpen" class="query-preview"><QueryResults :snapshot="data.result" :stale="stale" :result-label="data.resultLabel" /></div>
    </dialog>
  </section>
</template>
