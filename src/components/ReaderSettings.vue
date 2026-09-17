<script setup>
import { ref } from 'vue';
defineProps({ settings: Object });
const emit = defineEmits(['change', 'reset']);
const dialog = ref();
const themes = [{ id: 'auto', name: '随 DBX' }, { id: 'light', name: '雾白' }, { id: 'green', name: '青叶' }, { id: 'dark', name: '夜读' }];
defineExpose({ open: () => dialog.value.showModal(), close: () => dialog.value.close(), isOpen: () => dialog.value?.open });
</script>

<template>
  <dialog id="settings-dialog" ref="dialog" class="settings-dialog" aria-labelledby="settings-title">
    <div class="dialog-heading"><h2 id="settings-title">编辑器设置</h2><button id="close-settings" class="icon-button" aria-label="关闭阅读设置" @click="dialog.close()">×</button></div><p class="dialog-intro">调整本地文本的显示方式。</p>
    <fieldset><legend>页面颜色</legend><div class="theme-options"><button v-for="theme in themes" :key="theme.id" :data-theme-choice="theme.id" :aria-pressed="settings.theme === theme.id" @click="emit('change', 'theme', theme.id)"><i v-if="theme.id !== 'auto'" class="swatch" :class="theme.id"></i>{{ theme.name }}</button></div></fieldset>
    <label class="setting-row" for="font-size">字号 <output id="font-size-value">{{ settings.fontSize }} px</output></label><input id="font-size" type="range" min="12" max="30" step="1" :value="settings.fontSize" @input="emit('change', 'fontSize', Number($event.target.value))">
    <label class="setting-row" for="line-height">行距 <output id="line-height-value">{{ settings.lineHeight.toFixed(2) }}</output></label><input id="line-height" type="range" min="1.4" max="2.6" step="0.05" :value="settings.lineHeight" @input="emit('change', 'lineHeight', Number($event.target.value))">
    <label class="setting-row" for="text-width">正文宽度 <output id="text-width-value">{{ settings.width }} px</output></label><input id="text-width" type="range" min="480" max="960" step="20" :value="settings.width" @input="emit('change', 'width', Number($event.target.value))">
    <label class="setting-row" for="font-family">字体 <select id="font-family" :value="settings.font" @change="emit('change', 'font', $event.target.value)"><option value="mono">等宽 · 代码风格</option><option value="sans">系统字体</option></select></label>
    <p class="settings-help">切换窗口、标签或页面时自动收起；返回后按 Esc 展开。</p>
    <p class="settings-help">正文区域内：← / → 切换章节，空格向下翻页。<br>Esc 一键收起或恢复正文。</p><button id="reset-settings" class="button quiet" @click="emit('reset')">恢复默认设置</button>
  </dialog>
</template>
