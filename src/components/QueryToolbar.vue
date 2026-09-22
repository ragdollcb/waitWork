<script setup>
defineProps({ concealed: Boolean, saved: String, error: String, sidebarOpen: Boolean, snapshot: Boolean, queryTitle: { type: String, default: '新建查询' }, connectionLabel: { type: String, default: 'analytics / SQLite' }, settingsDisabled: Boolean });
defineEmits(['toggle', 'sidebar', 'settings']);
</script>

<template>
  <header class="query-toolbar" aria-label="查询工具栏">
    <button v-if="!concealed" id="toggle-sidebar" class="query-icon" aria-label="展开或收起侧栏" aria-controls="sidebar" :aria-expanded="sidebarOpen" @click="$emit('sidebar')"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg></button>
    <span v-else class="query-icon muted" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg></span>
    <span class="query-name" :title="queryTitle">{{ queryTitle }}</span>
    <span class="query-divider"></span>
    <button class="query-execute" disabled :title="snapshot ? '当前显示本地查询快照' : '未连接数据库'"><span aria-hidden="true">▷</span> 执行</button>
    <button class="query-secondary" disabled>解释</button>
    <span class="query-divider query-secondary"></span>
    <button class="query-connection" disabled :title="connectionLabel">{{ concealed || snapshot ? connectionLabel : '选择连接' }} <span aria-hidden="true">⌄</span></button>
    <span class="query-spacer"></span>
    <span :id="concealed ? 'cover-save-status' : 'save-status'" class="save-status" :class="{ failed: error }" role="status" :title="error || '自动保存到本机'">{{ saved }}</span>
    <button :id="concealed ? 'open-query-settings' : 'open-settings'" class="query-icon" :disabled="settingsDisabled" :aria-label="concealed ? '查询设置' : '阅读设置'" title="编辑器设置" @click="$emit('settings')">⚙</button>
    <button :id="concealed ? 'restore-reading' : 'hide-reading'" class="query-mode" :aria-label="concealed ? '展开正文（Esc）' : '收起正文（Esc）'" :title="concealed ? '展开正文 · Esc' : '收起正文 · Esc'" @click="$emit('toggle')">SQL</button>
  </header>
</template>
