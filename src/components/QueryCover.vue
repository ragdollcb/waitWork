<script setup>
import { computed, nextTick, ref } from 'vue';
import QueryToolbar from './QueryToolbar.vue';
import QueryResults from './QueryResults.vue';
import rawSql from '../data/query-demo.sql?raw';
import snapshot from '../data/query-demo.json';
import { highlightSql } from '../lib/sql-highlight.mjs';
defineEmits(['restore']);
const sql = rawSql.replace(/\r\n?/g, '\n');
const draft = ref(sql);
const editor = ref();
const highlighted = ref();
const gutter = ref();
const tokens = computed(() => highlightSql(draft.value));
const lineCount = computed(() => draft.value.split('\n').length);
const edited = computed(() => draft.value !== sql);
function syncScroll() {
  highlighted.value.scrollTop = editor.value.scrollTop;
  highlighted.value.scrollLeft = editor.value.scrollLeft;
  gutter.value.scrollTop = editor.value.scrollTop;
}
async function resetQuery() {
  draft.value = sql;
  await nextTick();
  editor.value.scrollTop = editor.value.scrollLeft = 0;
  syncScroll();
}
</script>

<template>
  <section id="privacy-screen" class="query-cover" aria-label="新建查询">
    <QueryToolbar concealed snapshot @toggle="$emit('restore')" />
    <div class="query-filebar"><span class="sql-file-icon" aria-hidden="true">SQL</span><span>新建查询.sql{{ edited ? ' •' : '' }}</span><span class="query-spacer"></span><span>{{ lineCount }} 行</span><button id="reset-query" title="恢复预置 SQL 和对应结果" aria-label="恢复预置查询" @click="resetQuery">↶</button></div>
    <div class="sql-editor">
      <div ref="gutter" class="sql-gutter" aria-hidden="true"><div v-for="line in lineCount" :key="line">{{ line }}</div></div>
      <div class="sql-surface">
        <pre ref="highlighted" class="sql-highlight" aria-hidden="true"><span v-for="(token, index) in tokens" :key="index" :class="token.kind ? `sql-${token.kind}` : undefined">{{ token.text }}</span>{{ '\n' }}</pre>
        <textarea id="query-draft" ref="editor" v-model="draft" wrap="off" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="SQL 编辑器" @scroll="syncScroll" />
      </div>
    </div>
    <QueryResults :snapshot="snapshot" :stale="edited" />
  </section>
</template>
