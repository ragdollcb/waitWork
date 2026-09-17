<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { paragraphsFor } from '../reader.mjs';
import QueryResults from './QueryResults.vue';

const props = defineProps({ book: Object, chapters: Array, chapterIndex: Number, hidden: Boolean, busy: Boolean });
const emit = defineEmits(['position', 'navigate', 'seek', 'import', 'sample']);
const scroller = ref();
const paragraphRoot = ref();
const section = computed(() => props.chapters[props.chapterIndex]);
const paragraphs = computed(() => props.book && section.value ? paragraphsFor(props.book.text, section.value) : []);
const progress = computed(() => props.book ? Math.min(100, props.book.position / props.book.text.length * 100) : 0);
let restoring = false;
let layoutFrame = 0;
let scrollFrame = 0;
let generation = 0;

function capture() {
  if (!props.book || !section.value || restoring || props.hidden || !scroller.value) return;
  const el = scroller.value;
  let position = props.book.position;
  if (el.scrollTop <= 2) position = section.value.start;
  else if (el.scrollHeight - el.clientHeight - el.scrollTop <= 2) position = props.chapterIndex === props.chapters.length - 1 ? props.book.text.length : Math.max(section.value.start, section.value.end - 1);
  else {
    const top = el.getBoundingClientRect().top + 14;
    for (const p of paragraphRoot.value.children) {
      const rect = p.getBoundingClientRect();
      if (rect.bottom > top) {
        const ratio = Math.max(0, Math.min(1, (top - rect.top) / Math.max(1, rect.height)));
        position = Math.floor(Number(p.dataset.start) + ratio * (Number(p.dataset.end) - Number(p.dataset.start)));
        break;
      }
    }
  }
  emit('position', position);
}

async function restore() {
  const current = ++generation;
  restoring = true;
  cancelAnimationFrame(layoutFrame);
  await nextTick();
  if (current !== generation) return;
  layoutFrame = requestAnimationFrame(() => {
    const el = scroller.value;
    if (!props.book || props.hidden || !el || !section.value) { restoring = false; return; }
    const position = props.book.position;
    if (position <= section.value.body) el.scrollTop = 0;
    else if (position >= section.value.end - 1) el.scrollTop = el.scrollHeight;
    else {
      const p = [...paragraphRoot.value.children].find((item) => Number(item.dataset.end) > position);
      if (p) {
        const ratio = Math.max(0, (position - Number(p.dataset.start)) / (Number(p.dataset.end) - Number(p.dataset.start)));
        el.scrollTop = Math.max(0, el.scrollTop + p.getBoundingClientRect().top - el.getBoundingClientRect().top + ratio * p.getBoundingClientRect().height - 14);
      }
    }
    layoutFrame = requestAnimationFrame(() => { restoring = false; });
  });
}
function onScroll() { cancelAnimationFrame(scrollFrame); scrollFrame = requestAnimationFrame(capture); }
function focus() { scroller.value?.focus({ preventScroll: true }); }
function pageDown(up = false) { const el = scroller.value; if (el) el.scrollBy({ top: el.clientHeight * (up ? -0.85 : 0.85), behavior: 'instant' }); }
watch(() => [props.book?.id, props.chapterIndex, props.hidden], restore, { flush: 'post', immediate: true });
onBeforeUnmount(() => { generation++; cancelAnimationFrame(layoutFrame); cancelAnimationFrame(scrollFrame); });
defineExpose({ capture, restore, focus, pageDown });
</script>

<template>
  <main class="reading-main">
    <div id="reading-meta" class="query-filebar"><span class="sql-file-icon" aria-hidden="true">SQL</span><span>新建查询.sql</span><span id="current-book" class="sr-only">{{ book?.title }}</span><span class="query-spacer"></span><span id="section-count">{{ chapterIndex + 1 }} / {{ chapters.length }}</span></div>
    <div id="reading-scroll" ref="scroller" class="reading-scroll" tabindex="0" aria-label="小说正文" @scroll.passive="onScroll">
      <article v-if="book" id="article" class="article">
        <div class="sql-comment sql-heading" data-line="1">-- 新建查询</div>
        <h1 id="chapter-title" class="sql-comment" data-line="2"><span class="comment-prefix" aria-hidden="true">-- </span>{{ section?.title }}</h1>
        <div id="paragraphs" ref="paragraphRoot" class="paragraphs"><p v-for="(p, index) in paragraphs" :key="p.start" :data-line="index + 3" :data-start="p.start" :data-end="p.end"><span class="comment-prefix" aria-hidden="true">-- </span>{{ p.text }}</p></div>
        <div class="chapter-end"><button v-if="chapterIndex < chapters.length - 1" id="next-inline" class="button quiet" @click="emit('navigate', chapterIndex + 1)">下一段 →</button></div>
      </article>
      <section v-else id="empty-state" class="empty-state"><p class="sql-comment">-- 输入 SQL 查询</p><button id="empty-import" class="button quiet" :disabled="busy" @click="emit('import')">打开本地文件</button><button id="load-sample" class="button quiet" @click="emit('sample')">打开示例</button></section>
    </div>
    <footer v-if="book" id="reading-footer" class="reading-footer">
      <button id="previous" class="button quiet" aria-label="上一章" :disabled="chapterIndex === 0" @click="emit('navigate', chapterIndex - 1)">← <span>上一段</span></button>
      <div class="progress-group"><label for="progress">位置</label><input id="progress" type="range" min="0" max="1000" step="1" :value="Math.round(progress * 10)" aria-label="全书阅读进度" :aria-valuetext="`全书 ${progress.toFixed(1)}%`" @input="emit('seek', Number($event.target.value) / 1000)"><output id="progress-value" for="progress">{{ progress.toFixed(1) }}%</output></div>
      <button id="next" class="button quiet" aria-label="下一章" :disabled="chapterIndex === chapters.length - 1" @click="emit('navigate', chapterIndex + 1)"><span>下一段</span> →</button>
    </footer>
    <QueryResults />
  </main>
</template>
