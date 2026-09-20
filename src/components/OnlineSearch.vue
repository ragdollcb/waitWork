<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import { invoke } from '../lib/host.js';

const emit = defineEmits(['read']);
const query = ref('');
const searched = ref('');
const results = ref(null);
const catalog = ref(null);
const busy = ref(false);
const error = ref('');
const chapterQuery = ref('');
const chapterPage = ref(0);
const chapters = computed(() => catalog.value?.chapters.filter(chapter => chapter.title.includes(chapterQuery.value.trim())) || []);
const shown = computed(() => chapters.value.slice(chapterPage.value * 200, (chapterPage.value + 1) * 200));
let generation = 0;
let retry = () => search();

async function request(action, apply) {
  const current = ++generation;
  busy.value = true;
  error.value = '';
  retry = () => request(action, apply);
  try {
    const value = await action();
    if (current === generation) apply(value);
  } catch (err) {
    if (current === generation) error.value = err.message || '书源请求失败，请重试。';
  } finally { if (current === generation) busy.value = false; }
}
function search(page = 1, term = query.value.trim()) {
  if (!term) { error.value = '请输入书名或作者。'; return; }
  catalog.value = null;
  results.value = null;
  searched.value = term;
  return request(() => invoke('source/search', { query: term, page }), value => { results.value = value; });
}
function openBook(book, refresh = false) {
  if (!refresh) catalog.value = null;
  chapterQuery.value = ''; chapterPage.value = 0;
  return request(() => invoke('source/catalog', { bookPath: book.bookPath, refresh }), value => { catalog.value = value; });
}
function back() { generation++; busy.value = false; error.value = ''; catalog.value = null; }
onBeforeUnmount(() => { generation++; });
</script>

<template>
  <section class="online-search" aria-label="在线搜索">
    <div class="online-search-form" role="search">
      <label class="sr-only" for="online-query">书名或作者</label>
      <input id="online-query" v-model="query" class="search" type="search" maxlength="100" placeholder="搜索书名或作者…" @keydown.enter.prevent="search()">
      <button id="online-submit" class="button" type="button" @click="search()">搜索</button>
    </div>
    <p class="sidebar-hint">书源：笔趣阁 · 按章缓存到本机</p>
    <p v-if="busy" role="status">正在加载…</p>
    <div v-if="error" class="online-error" role="alert"><p>{{ error }}</p><button class="button quiet" @click="retry()">重试</button></div>
    <template v-if="catalog">
      <button class="button quiet" @click="back">← 搜索结果</button>
      <h3>{{ catalog.title }}</h3><p class="sidebar-hint">{{ catalog.author }}</p>
      <p class="online-intro">{{ catalog.intro }}</p>
      <p v-if="catalog.warning" role="alert">{{ catalog.warning }}</p>
      <button id="online-start" class="button import-button" @click="emit('read', { catalog })">开始／继续阅读</button>
      <button class="button quiet" @click="openBook(catalog, true)">刷新目录</button>
      <p class="sidebar-hint">共 {{ catalog.chapters.length }} 章</p>
      <input v-model="chapterQuery" class="search" aria-label="查找在线目录" placeholder="查找章节…" @input="chapterPage = 0">
      <button v-for="chapter in shown" :key="chapter.path" class="chapter-button" @click="emit('read', { catalog, chapterPath: chapter.path })">{{ chapter.title }}</button>
      <nav v-if="chapters.length > 200" class="online-pages" aria-label="在线目录分页"><button class="button quiet" :disabled="chapterPage === 0" @click="chapterPage--">上一页</button><span>{{ chapterPage + 1 }}</span><button class="button quiet" :disabled="(chapterPage + 1) * 200 >= chapters.length" @click="chapterPage++">下一页</button></nav>
    </template>
    <template v-else-if="results">
      <p v-if="!results.books.length" class="sidebar-hint">没有找到相关小说，请更换关键词。</p>
      <button v-for="book in results.books" :key="book.bookPath" class="online-result" @click="openBook(book)">
        <strong>{{ book.title }}</strong><span>{{ book.author }}</span><small>{{ book.latest }}</small>
      </button>
      <nav class="online-pages" aria-label="搜索分页">
        <button class="button quiet" :disabled="results.page <= 1" @click="search(results.page - 1, searched)">上一页</button>
        <span>{{ results.page }}</span>
        <button class="button quiet" :disabled="!results.hasNext" @click="search(results.page + 1, searched)">下一页</button>
      </nav>
    </template>
  </section>
</template>
