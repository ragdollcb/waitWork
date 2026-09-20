<script setup>
import { ref, watch } from 'vue';
import { normalizeSourceURL } from '../lib/source-config.mjs';
const props = defineProps({ settings: Object });
const emit = defineEmits(['change', 'reset']);
const dialog = ref();
const sourceURL = ref('');
const sourceError = ref('');
const sourceStatus = ref('');
watch(() => props.settings.sourceURL, value => { if (sourceURL.value !== (value || '')) { sourceURL.value = value || ''; sourceError.value = ''; sourceStatus.value = ''; } });
function open() { sourceURL.value = props.settings.sourceURL || ''; sourceError.value = ''; sourceStatus.value = ''; dialog.value.showModal(); }
function saveSource() {
  sourceError.value = ''; sourceStatus.value = '';
  try {
    const value = normalizeSourceURL(sourceURL.value);
    sourceURL.value = value;
    emit('change', 'sourceURL', value);
    sourceStatus.value = value ? '网址已应用，正在自动保存到本机。' : '已清空网址，在线访问已关闭；已有缓存仍可阅读。';
  } catch (error) { sourceError.value = error.message; }
}
const themes = [{ id: 'auto', name: '随 DBX' }, { id: 'light', name: '雾白' }, { id: 'green', name: '青叶' }, { id: 'dark', name: '夜读' }];
defineExpose({ open, close: () => dialog.value.close(), isOpen: () => dialog.value?.open });
</script>

<template>
  <dialog id="settings-dialog" ref="dialog" class="settings-dialog" aria-labelledby="settings-title">
    <div class="dialog-heading"><h2 id="settings-title">编辑器设置</h2><button id="close-settings" class="icon-button" aria-label="关闭阅读设置" @click="dialog.close()">×</button></div><p class="dialog-intro">调整本地文本的显示方式。</p>
    <fieldset><legend>页面颜色</legend><div class="theme-options"><button v-for="theme in themes" :key="theme.id" :data-theme-choice="theme.id" :aria-pressed="settings.theme === theme.id" @click="emit('change', 'theme', theme.id)"><i v-if="theme.id !== 'auto'" class="swatch" :class="theme.id"></i>{{ theme.name }}</button></div></fieldset>
    <label class="setting-row" for="font-size">字号 <output id="font-size-value">{{ settings.fontSize }} px</output></label><input id="font-size" type="range" min="12" max="30" step="1" :value="settings.fontSize" @input="emit('change', 'fontSize', Number($event.target.value))">
    <label class="setting-row" for="line-height">行距 <output id="line-height-value">{{ settings.lineHeight.toFixed(2) }}</output></label><input id="line-height" type="range" min="1.4" max="2.6" step="0.05" :value="settings.lineHeight" @input="emit('change', 'lineHeight', Number($event.target.value))">
    <label class="setting-row" for="text-width">正文宽度 <output id="text-width-value">{{ settings.width }} px</output></label><input id="text-width" type="range" min="480" max="960" step="20" :value="settings.width" @input="emit('change', 'width', Number($event.target.value))">
    <label class="setting-row" for="font-family">字体 <select id="font-family" :value="settings.font" @change="emit('change', 'font', $event.target.value)"><option value="mono">等宽 · 代码风格</option><option value="sans">系统字体</option></select></label>
    <fieldset class="source-settings"><legend>自定义书源</legend>
      <label class="setting-row" for="source-url">网站首页地址</label>
      <input id="source-url" v-model="sourceURL" class="search" type="url" maxlength="2048" placeholder="请输入 HTTPS 网站首页地址" aria-describedby="source-help source-example" @input="sourceError = ''; sourceStatus = ''" @keydown.enter.prevent="saveSource">
      <div class="source-actions"><button id="save-source" class="button import-button" @click="saveSource">保存网址</button><button id="clear-source" class="button quiet" @click="sourceURL = ''; saveSource()">清空网址</button></div>
      <p v-if="sourceError" id="source-url-error" class="online-error" role="alert">{{ sourceError }}</p>
      <p v-if="sourceStatus" role="status" class="settings-help">{{ sourceStatus }}</p>
      <p id="source-help" class="settings-help">插件不预设启用任何网站。请自行填写有权访问的网址，并遵守网站规则与版权要求。仅支持与当前解析规则兼容的网站，并非任意网址都能解析。</p>
      <p id="source-example" class="settings-help">当前已适配的网址示例：<span class="source-example">https://www.biquge001.com/</span><br>此地址仅作适配说明，不会自动填写或访问。</p>
    </fieldset>
    <p class="settings-help">切换窗口、标签或页面时自动收起；返回后按 Esc 展开。</p>
    <p class="settings-help">正文区域内：← / → 切换章节，空格向下翻页。<br>Esc 一键收起或恢复正文。</p><button id="reset-settings" class="button quiet" @click="emit('reset')">恢复默认设置</button>
  </dialog>
</template>
