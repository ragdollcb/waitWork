<script setup>
import { ref } from 'vue';
defineProps({ snapshot: Object, stale: Boolean, resultLabel: { type: String, default: '' } });
const selected = ref('result');
const format = (value, column) => value == null ? 'NULL' : column.type === 'DECIMAL' ? Number(value).toFixed(2) : String(value);
</script>

<template>
  <section class="query-results" :class="{ populated: snapshot }" aria-label="查询输出">
    <div class="result-tabs" role="tablist" aria-label="输出视图"><button class="result-label" role="tab" :title="resultLabel.trim() || (snapshot ? '结果 1' : '结果')" :aria-selected="selected === 'result'" @click="selected = 'result'">{{ resultLabel.trim() || (snapshot ? '结果 1' : '结果') }}</button><button role="tab" :aria-selected="selected === 'messages'" @click="selected = 'messages'">消息</button><span v-if="stale" class="result-stale">SQL 已修改 · 上次结果</span><span class="query-spacer"></span><span>{{ snapshot?.rows.length ?? 0 }} 行</span></div>
    <div v-if="snapshot && selected === 'result'" class="result-grid" role="tabpanel" tabindex="0" aria-label="查询结果">
      <table><thead><tr><th scope="col" class="row-number">#</th><th v-for="(column, index) in snapshot.columns" :key="index" scope="col"><span>{{ column.name }}</span><small>{{ column.type }}</small></th></tr></thead><tbody><tr v-for="(row, index) in snapshot.rows" :key="index"><th scope="row" class="row-number">{{ index + 1 }}</th><td v-for="(value, col) in row" :key="col" :class="{ numeric: snapshot.columns[col].type !== 'TEXT' }">{{ format(value, snapshot.columns[col]) }}</td></tr></tbody></table>
    </div>
    <div v-else-if="snapshot" class="query-messages" role="tabpanel"><p>语句执行完成。</p><p>返回 {{ snapshot.rows.length }} 行，{{ snapshot.columns.length }} 列。</p><p>耗时：{{ snapshot.elapsedMs }} ms</p><p v-if="stale">编辑器内容已修改，当前显示修改前的查询结果。</p></div>
    <div v-else class="result-empty" role="tabpanel">{{ selected === 'result' ? '暂无查询结果' : '暂无消息' }}</div>
    <footer class="query-statusbar"><span>{{ snapshot ? `已完成 · ${snapshot.rows.length} 行 · ${snapshot.elapsedMs} ms` : '就绪' }}</span><span class="query-spacer"></span><span>UTF-8</span><span>LF</span><span>SQL</span></footer>
  </section>
</template>
