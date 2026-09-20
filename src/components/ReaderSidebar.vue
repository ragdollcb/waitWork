<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import OnlineSearch from './OnlineSearch.vue';

const props = defineProps({ books: Array, activeId: String, chapters: Array, chapterIndex: Number, busy: Boolean, sourceUrl: String });
const emit = defineEmits(['select-book', 'remove-book', 'navigate', 'files', 'read-online', 'refresh-online', 'settings']);
const encoding = defineModel('encoding', { default: 'auto' });
const tab = ref('shelf');
const query = ref('');
const fileInput = ref();
const visibleCount = ref(200);
const precedingCount = ref(0);
const matched = computed(() => props.chapters.map((chapter, index) => ({ chapter, index })).filter(({ chapter }) => chapter.title.toLowerCase().includes(query.value.trim().toLowerCase())));
const start = computed(() => query.value.trim() ? 0 : Math.max(0, props.chapterIndex - 50 - precedingCount.value));
const shown = computed(() => matched.value.slice(start.value, start.value + visibleCount.value));
const percent = (book) => book.kind === 'online' ? 0 : Math.min(100, book.position / book.text.length * 100);
const online = computed(() => props.books.find(book => book.id === props.activeId)?.kind === 'online');
watch(() => props.activeId, () => { query.value = ''; });
watch([() => props.activeId, query], () => { visibleCount.value = 200; });
watch([() => props.activeId, () => props.chapterIndex, query], () => { precedingCount.value = 0; });

let prepending = false;
async function loadMoreChapters(event) {
  const el = event.currentTarget;
  if (prepending) return;
  if (start.value > 0 && el.scrollTop <= 80) {
    const anchor = el.querySelector('.chapter-button');
    const top = anchor?.getBoundingClientRect().top;
    const count = Math.min(200, start.value);
    prepending = true;
    precedingCount.value += count;
    visibleCount.value += count;
    await nextTick();
    // 保持原章节在视口中的位置，同时兼容浏览器自身的滚动锚定。
    if (anchor?.isConnected) el.scrollTop += anchor.getBoundingClientRect().top - top;
    prepending = false;
    return;
  }
  // 提前追加下一批，浏览目录不需要切换正在阅读的章节。
  const remaining = matched.value.length - start.value;
  if (visibleCount.value < remaining && el.scrollHeight - el.scrollTop - el.clientHeight <= 80) {
    visibleCount.value = Math.min(visibleCount.value + 200, remaining);
  }
}

function chooseFiles() {
  if (props.busy) return;
  fileInput.value.click();
}
function selectFiles(event) {
  emit('files', [...event.target.files]);
  event.target.value = '';
}
defineExpose({ chooseFiles });
</script>

<template>
  <aside id="sidebar" class="sidebar" aria-label="书架与目录">
    <div class="sidebar-heading"><span class="eyebrow">文件与书架</span><span id="book-count" class="count">{{ books.length }} 项</span></div>
    <button id="import" class="button import-button" :disabled="busy" @click="chooseFiles"><span aria-hidden="true">＋</span> 打开文件</button>
    <input id="file-input" ref="fileInput" type="file" accept=".txt,.epub,.mobi,.json" multiple hidden aria-label="选择 TXT、EPUB、MOBI 小说或 Wait Work 存档" @change="selectFiles">
    <label class="encoding-label" for="encoding">TXT 编码 <select id="encoding" v-model="encoding"><option value="auto">自动识别</option><option value="utf-8">UTF-8</option><option value="gb18030">GB18030 / GBK</option><option value="utf-16le">UTF-16 LE</option><option value="utf-16be">UTF-16 BE</option></select></label>
    <nav class="sidebar-tabs" aria-label="侧栏内容">
      <button id="tab-shelf" :class="{ active: tab === 'shelf' }" :aria-pressed="tab === 'shelf'" @click="tab = 'shelf'">文件</button>
      <button id="tab-toc" :class="{ active: tab === 'toc' }" :aria-pressed="tab === 'toc'" @click="tab = 'toc'">大纲</button>
      <button id="tab-online" :class="{ active: tab === 'online' }" :aria-pressed="tab === 'online'" @click="tab = 'online'">在线搜索</button>
    </nav>
    <section id="shelf-panel" :hidden="tab !== 'shelf'" class="sidebar-panel" aria-label="书架">
      <div id="book-list">
        <div v-for="book in books" :key="book.id" class="book-card" :class="{ active: book.id === activeId }">
          <button class="book-open" :aria-label="`阅读 ${book.title}`" :aria-pressed="book.id === activeId" @click="emit('select-book', book.id)">
            <span class="book-cover" aria-hidden="true">{{ book.kind === 'online' ? 'WEB' : (book.format || 'txt').toUpperCase() }}</span>
            <span class="book-info"><span class="book-title">{{ book.title }}</span><span class="book-subtitle">{{ book.kind === 'online' ? `${book.sourceOrigin} · 按章缓存` : `${(book.text.length / 1000).toFixed(1)} k · UTF-8` }}</span></span>
          </button>
          <div class="book-bottom"><span>{{ book.kind === 'online' ? '自动记录章节与位置' : `位置 ${percent(book).toFixed(1)}%` }}</span><button class="remove-book" :aria-label="`移除 ${book.title}`" @click="emit('remove-book', book)">移除</button></div>
          <div v-if="book.kind !== 'online'" class="book-progress"><span :style="{ width: `${percent(book)}%` }"></span></div>
        </div>
        <p v-if="!books.length" class="sidebar-hint">书架暂无书籍。</p>
      </div>
    </section>
    <section id="toc-panel" :hidden="tab !== 'toc'" class="sidebar-panel" aria-label="章节目录" @scroll.passive="loadMoreChapters">
      <button v-if="online" id="refresh-online" class="button quiet" @click="emit('refresh-online')">刷新目录</button>
      <label class="sr-only" for="chapter-search">搜索章节</label><input id="chapter-search" v-model="query" class="search" placeholder="搜索章节…" type="search">
      <div id="chapter-list">
        <button v-for="{ chapter, index } in shown" :key="index" class="chapter-button" :class="{ active: index === chapterIndex }" :aria-current="index === chapterIndex ? 'location' : undefined" @click="emit('navigate', index)"><span class="chapter-index">{{ String(index + 1).padStart(2, '0') }}</span><span>{{ chapter.title }}</span></button>
        <p v-if="matched.length > shown.length" class="sidebar-hint">当前显示 {{ start + 1 }}–{{ start + shown.length }} 节，共 {{ matched.length }} 节。滚动到顶部或底部加载更多。输入章节名可快速查找。</p>
      </div>
      <p v-if="!matched.length" id="chapter-empty" class="sidebar-hint">没有匹配的章节</p>
    </section>
    <section :hidden="tab !== 'online'" class="sidebar-panel"><OnlineSearch :source-url="sourceUrl" @settings="emit('settings')" @read="catalog => { emit('read-online', catalog); tab = 'toc'; }" /></section>
    <div class="session-note"><span class="session-dot" aria-hidden="true"></span><div><strong>自动保存</strong><p>文件与编辑位置保存在本机。</p></div></div>
  </aside>
</template>
