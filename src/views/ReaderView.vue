<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch, watchEffect } from 'vue';
import ReaderSidebar from '../components/ReaderSidebar.vue';
import ReadingPane from '../components/ReadingPane.vue';
import ReaderSettings from '../components/ReaderSettings.vue';
import QueryToolbar from '../components/QueryToolbar.vue';
import QueryCover from '../components/QueryCover.vue';
import { observePrivacy } from '../lib/privacy.js';
import { MAX_ARCHIVE_BYTES, MAX_BOOKS, MAX_TOTAL_CHARS, DEFAULT_SETTINGS, sectionsFor, sectionAt, parseArchive, checkLibrarySize } from '../reader.mjs';
import { importLocalFile } from '../lib/ebook.mjs';
import { sample } from '../sample.mjs';
import { createStorage, invoke } from '../lib/host.js';
import { createAutosave } from '../lib/autosave.mjs';

const state = reactive({ books: [{ ...sample }], activeId: sample.id, settings: { ...DEFAULT_SETTINGS } });
const pane = ref();
const sidebar = ref();
const settingsDialog = ref();
const queryCover = ref();
const queryTitle = ref('新建查询');
watch(queryTitle, value => { document.title = value; });
const confirmDialog = ref();
const confirmation = shallowRef();
const privateMode = ref(true);
const sidebarOpen = ref(false);
const importing = ref(false);
const initialized = ref(false);
const loadError = ref('');
const saveStatus = ref('loading');
const saveError = ref('');
const storage = createStorage();
const autosave = createAutosave({
  snapshot: () => ({ books: state.books.map(book => ({ ...book })), activeId: state.activeId, settings: { ...state.settings } }),
  save: snapshot => storage.save(snapshot),
  status: (value, error = '') => { saveStatus.value = value; saveError.value = error; },
});
watch(state, () => { if (initialized.value) autosave.changed(); }, { deep: true, flush: 'sync' });
const saveLabel = computed(() => ({ loading: '正在恢复阅读…', saving: '正在自动保存…', saved: '已自动保存', error: '自动保存失败' })[saveStatus.value]);

async function initialize() {
  loadError.value = '';
  try {
    const saved = await storage.load();
    if (disposed) return;
    if (saved) Object.assign(state, saved);
    initialized.value = true;
    if (saved) saveStatus.value = 'saved';
    else autosave.changed();
    await nextTick();
    pane.value.restore();
  } catch (error) {
    if (!disposed) loadError.value = error.message || '读取本地书架失败，请重新打开插件。';
  }
}
function flushReading() {
  if (!initialized.value) return;
  pane.value?.capture();
  void autosave.flush();
}
const encoding = ref('auto');
const toast = ref('');
const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
const hostTheme = ref(colorScheme.matches ? 'dark' : 'light');
const sectionCache = new Map();
let stopPrivacy;
let toastTimer;
let lastFocus;
let disposed = false;

const activeBook = computed(() => state.books.find((book) => book.id === state.activeId));
const onlineCatalog = shallowRef(null);
const onlineText = ref('');
const onlineLoading = ref(false);
const onlineError = ref('');
const onlineWarning = ref('');
let onlineGeneration = 0;
let refreshGeneration = 0;
const displayBook = computed(() => activeBook.value?.kind === 'online' ? { ...activeBook.value, text: onlineText.value } : activeBook.value);

async function loadOnline() {
  const current = ++onlineGeneration;
  const book = activeBook.value;
  onlineText.value = '';
  onlineError.value = '';
  onlineWarning.value = '';
  onlineLoading.value = book?.kind === 'online';
  if (!onlineLoading.value) { onlineCatalog.value = null; return; }
  if (onlineCatalog.value?.bookPath !== book.bookPath || onlineCatalog.value?.sourceOrigin !== book.sourceOrigin) onlineCatalog.value = null;
  const chapterPath = book.chapterPath;
  const source = { origin: book.sourceOrigin, allowNetwork: !!state.settings.sourceURL && state.settings.sourceURL === book.sourceOrigin };
  const valid = () => !disposed && current === onlineGeneration && activeBook.value === book && book.chapterPath === chapterPath;
  try {
    const catalog = onlineCatalog.value || { ...await invoke('source/catalog', { bookPath: book.bookPath, ...source }), sourceOrigin: book.sourceOrigin };
    if (!valid()) return;
    onlineCatalog.value = catalog;
    if (!catalog.chapters.some(chapter => chapter.path === chapterPath)) throw new Error('原阅读章节已不在目录中，请从大纲选择其他章节。');
    const chapter = await invoke('source/chapter', { bookPath: book.bookPath, chapterPath, ...source });
    if (!valid()) return;
    onlineText.value = chapter.text;
    book.position = Math.min(book.position, chapter.text.length);
    onlineWarning.value = [catalog.warning, chapter.warning].filter(Boolean).join('\n');
  } catch (error) { if (valid()) onlineError.value = error.message || '加载章节失败，请重试。'; }
  finally { if (valid()) { onlineLoading.value = false; await nextTick(); pane.value?.restore(); } }
}
watch(() => [initialized.value, activeBook.value?.id, activeBook.value?.chapterPath, state.settings.sourceURL], () => { if (initialized.value) void loadOnline(); }, { flush: 'sync' });

function retryOnline() {
  pane.value?.capture();
  if (onlineCatalog.value?.warning) onlineCatalog.value = null;
  return loadOnline();
}

async function refreshOnline() {
  const book = activeBook.value;
  if (book?.kind !== 'online') return;
  if (!state.settings.sourceURL || state.settings.sourceURL !== book.sourceOrigin) { announce('请先在设置中保存本书的来源网址，再刷新目录。'); return; }
  const current = ++refreshGeneration;
  const origin = state.settings.sourceURL;
  try {
    const catalog = { ...await invoke('source/catalog', { bookPath: book.bookPath, refresh: true, origin, allowNetwork: true }), sourceOrigin: origin };
    if (disposed || current !== refreshGeneration || activeBook.value !== book || state.settings.sourceURL !== origin) return;
    onlineGeneration++;
    onlineCatalog.value = catalog;
    announce(catalog.warning || '目录已更新。');
    await loadOnline();
  } catch (error) { if (!disposed && current === refreshGeneration && activeBook.value === book) announce(error.message); }
}
function readOnline({ catalog, chapterPath }) {
  if (!initialized.value || !state.settings.sourceURL || catalog.sourceOrigin !== state.settings.sourceURL) return;
  const existing = state.books.find(book => book.kind === 'online' && book.bookPath === catalog.bookPath && book.sourceOrigin === catalog.sourceOrigin);
  const id = existing?.id || crypto.randomUUID();
  const onlySample = state.books.length === 1 && state.books[0].id === sample.id;
  if (!existing && !onlySample && state.books.length >= MAX_BOOKS) { announce(`书架最多放 ${MAX_BOOKS} 本书，请先移除部分书籍。`); return; }
  pane.value?.capture();
  onlineCatalog.value = catalog;
  if (!existing) {
    if (onlySample) state.books = [];
    state.books.push({ id, kind: 'online', source: 'biquge001', sourceOrigin: catalog.sourceOrigin, title: catalog.title, bookPath: catalog.bookPath, chapterPath: chapterPath || catalog.chapters[0].path, position: 0 });
  } else if (chapterPath) {
    existing.position = 0;
    existing.chapterPath = chapterPath;
  }
  state.activeId = id;
  closeMobileSidebar();
  void nextTick(() => pane.value?.restore());
}
const chapters = computed(() => {
  const book = activeBook.value;
  if (!book) return [];
  if (book.kind === 'online') return onlineCatalog.value?.bookPath === book.bookPath ? onlineCatalog.value.chapters : [];
  if (!sectionCache.has(book.id)) sectionCache.set(book.id, sectionsFor(book.text, book.toc));
  return sectionCache.get(book.id);
});
const chapterIndex = computed(() => activeBook.value?.kind === 'online' ? chapters.value.findIndex(chapter => chapter.path === activeBook.value.chapterPath) : activeBook.value ? sectionAt(chapters.value, activeBook.value.position) : 0);

function announce(message) {
  if (disposed) return;
  clearTimeout(toastTimer);
  toast.value = message;
  toastTimer = setTimeout(() => { toast.value = ''; }, 6500);
}

async function confirmAction(title, message, action) {
  confirmation.value = { title, message, action };
  await nextTick();
  if (disposed) return;
  if (privateMode.value) return;
  confirmDialog.value.showModal();
  confirmDialog.value.querySelector('#confirm-cancel').focus();
}
function closeConfirm() { confirmation.value = undefined; confirmDialog.value?.close(); }
function confirmOK() { const action = confirmation.value?.action; closeConfirm(); action?.(); }
function closeMobileSidebar() { if (window.innerWidth <= 700) sidebarOpen.value = false; }

function updatePosition(position) { if (activeBook.value && !(activeBook.value.kind === 'online' && (onlineLoading.value || onlineError.value))) activeBook.value.position = position; }
async function selectBook(id) {
  pane.value.capture();
  state.activeId = id;
  closeMobileSidebar();
  await nextTick();
  pane.value.restore();
}
function removeBook(book) {
  confirmAction('移除这本书？', `“${book.title}”的正文和阅读位置将从书架移除，此变更会自动保存。原始 TXT 文件不受影响。`, () => {
    pane.value.capture();
    state.books = state.books.filter((item) => item.id !== book.id);
    sectionCache.delete(book.id);
    if (state.activeId === book.id) state.activeId = state.books[0]?.id ?? null;
  });
}
async function navigate(index) {
  if (!activeBook.value || !chapters.value[index]) return;
  if (activeBook.value.kind === 'online') {
    activeBook.value.position = 0;
    if (activeBook.value.chapterPath !== chapters.value[index].path) {
      activeBook.value.chapterPath = chapters.value[index].path;
    }
    closeMobileSidebar();
    await nextTick();
    pane.value?.restore();
    if (!privateMode.value) pane.value?.focus();
    return;
  }
  activeBook.value.position = chapters.value[index].start;
  closeMobileSidebar();
  await nextTick();
  pane.value.restore();
  pane.value.focus();
}
async function seek(ratio) {
  if (!activeBook.value) return;
  if (activeBook.value.kind === 'online') return navigate(Math.min(chapters.value.length - 1, Math.floor(ratio * chapters.value.length)));
  activeBook.value.position = Math.round(ratio * activeBook.value.text.length);
  await nextTick();
  pane.value.restore();
}
async function toggleSidebar() {
  pane.value.capture();
  sidebarOpen.value = !sidebarOpen.value;
  await nextTick();
  pane.value.restore();
}
async function changeSetting(key, value) {
  pane.value.capture();
  state.settings[key] = value;
  await nextTick();
  pane.value.restore();
}
async function resetSettings() {
  pane.value.capture();
  state.settings = { ...DEFAULT_SETTINGS };
  await nextTick();
  pane.value.restore();
}

watchEffect(() => {
  const settings = state.settings;
  const root = document.documentElement;
  root.dataset.readerTheme = settings.theme === 'auto' ? hostTheme.value : settings.theme;
  root.style.setProperty('--reader-size', `${settings.fontSize}px`);
  root.style.setProperty('--reader-line', settings.lineHeight);
  root.style.setProperty('--reader-width', `${settings.width}px`);
  root.style.setProperty('--reader-font', settings.font === 'sans' ? '"Segoe UI","Microsoft YaHei",sans-serif' : 'Consolas,"Cascadia Code","Microsoft YaHei",monospace');
});

async function setPrivacy(hide, focus = true) {
  queryCover.value?.closeSettings();
  if (hide === privateMode.value) return;
  if (hide) {
    flushReading();
    lastFocus = document.activeElement;
    toast.value = '';
  }
  privateMode.value = hide;
  document.title = queryTitle.value;
  await nextTick();
  if (disposed || privateMode.value !== hide) return;
  if (hide) {
    // 先隐藏并禁用正文，再关原生 dialog，避免它把焦点还给旧的设置按钮。
    settingsDialog.value.close();
    closeConfirm();
    // 自动收起不能把焦点从宿主的 SQL、表格或其他页面抢回来。
    if (focus) document.querySelector('#restore-reading')?.focus({ preventScroll: true });
  } else {
    pane.value.restore();
    if (lastFocus?.isConnected && lastFocus.getClientRects().length) lastFocus.focus({ preventScroll: true });
    else pane.value.focus();
    if (confirmation.value) confirmDialog.value.showModal();
  }
}
function handleKey(event) {
  if (!initialized.value) return;
  if (event.key === 'Escape' && queryCover.value?.isSettingsOpen()) { event.preventDefault(); event.stopPropagation(); queryCover.value.closeSettings(); return; }
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setPrivacy(!privateMode.value); return; }
  if (privateMode.value || settingsDialog.value.isOpen() || confirmDialog.value.open || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.target.closest('input, select, textarea, button')) return;
  if (event.key === 'ArrowLeft') { event.preventDefault(); navigate(chapterIndex.value - 1); }
  if (event.key === 'ArrowRight') { event.preventDefault(); navigate(chapterIndex.value + 1); }
  if (event.code === 'Space') { event.preventDefault(); pane.value.pageDown(event.shiftKey); }
}
function conceal() { flushReading(); void setPrivacy(true, false); }
function resized() { if (!privateMode.value) pane.value.restore(); }
function syncHostTheme() {
  const appearance = window.dbxPlugin?.theme?.appearance;
  if (!disposed && ['dark', 'light'].includes(appearance)) hostTheme.value = appearance;
}
function systemThemeChanged(event) { if (!window.dbxPlugin) hostTheme.value = event.matches ? 'dark' : 'light'; }

async function importFiles(files) {
  if (!initialized.value || !files.length || importing.value) return;
  importing.value = true;
  try {
    if (files.some((file) => /\.json$/i.test(file.name))) {
      if (files.length !== 1 || !/\.json$/i.test(files[0].name)) throw new Error('请单独导入一个存档，TXT、EPUB、MOBI 可以混合多选。');
      if (files[0].size > MAX_ARCHIVE_BYTES) throw new Error('存档超过 64 MB，无法导入。');
      const restored = parseArchive(await files[0].text());
      checkLibrarySize(restored);
      if (disposed) return;
      const apply = async () => {
        // 相同书籍 ID 的存档也可能包含不同正文，先清除派生章节缓存。
        sectionCache.clear();
        Object.assign(state, restored);
        closeMobileSidebar();
        await nextTick();
        pane.value.restore();
        announce('存档已恢复，可以接着读了。');
      };
      if (state.books.some((book) => book.id !== sample.id)) await confirmAction('用存档替换当前书架？', '当前书架、阅读位置和设置会被此存档替换。替换后会自动保存，请确认存档内容是你需要的。', apply);
      else await apply();
      return;
    }
    if (files.some((file) => !/\.(txt|epub|mobi)$/i.test(file.name))) throw new Error('目前支持 TXT、EPUB、MOBI 小说和 Wait Work JSON 存档。');
    if (files.length > MAX_BOOKS) throw new Error(`书架最多放 ${MAX_BOOKS} 本书，请减少本次导入数量。`);
    let total = 0;
    const imported = [];
    const encodings = new Set();
    const selectedEncoding = encoding.value;
    for (const file of files) {
      const { label, ...decoded } = await importLocalFile(file, selectedEncoding);
      if (disposed) return;
      total += decoded.text.length;
      if (total > MAX_TOTAL_CHARS) throw new Error('书架正文总量过大，请先移除部分书籍。');
      imported.push({ id: crypto.randomUUID(), ...decoded, position: 0 });
      encodings.add(label);
    }
    pane.value.capture();
    const hasOnlySample = state.books.length === 1 && state.books[0].id === sample.id;
    const existing = hasOnlySample ? [] : state.books;
    if (existing.length + imported.length > MAX_BOOKS) throw new Error(`书架最多放 ${MAX_BOOKS} 本书，请先移除部分书籍。`);
    if (total + existing.reduce((sum, book) => sum + (book.text?.length || 0), 0) > MAX_TOTAL_CHARS) throw new Error('书架正文总量过大，请先移除部分书籍。');
    checkLibrarySize({ books: [...existing, ...imported], activeId: imported[0].id, settings: state.settings });
    // 批量导入失败时保留原有书架，全部读取成功后再提交。
    if (hasOnlySample) sectionCache.delete(sample.id);
    state.books = [...existing, ...imported];
    state.activeId = imported[0].id;
    closeMobileSidebar();
    announce(`已导入 ${imported.length} 本 · ${[...encodings].join(' / ')}\n正在自动保存小说和阅读位置。`);
  } catch (error) { announce(error.message || '导入失败，请确认文件可读后重试。'); }
  finally { importing.value = false; }
}

function loadSample() { state.books = [{ ...sample }]; state.activeId = sample.id; closeMobileSidebar(); }

onMounted(() => {
  document.title = '新建查询';
  void initialize();
  stopPrivacy = observePrivacy(conceal);
  document.addEventListener('keydown', handleKey, true);
  window.addEventListener('resize', resized);
  document.addEventListener('dbx-plugin-env', syncHostTheme);
  colorScheme.addEventListener('change', systemThemeChanged);
  window.dbxPlugin?.ready.then(syncHostTheme).catch(() => announce('宿主初始化失败，请重新打开插件。'));
});
onBeforeUnmount(() => {
  flushReading();
  void autosave.stop();
  disposed = true;
  stopPrivacy?.();
  clearTimeout(toastTimer);
  document.removeEventListener('keydown', handleKey, true);
  window.removeEventListener('resize', resized);
  document.removeEventListener('dbx-plugin-env', syncHostTheme);
  colorScheme.removeEventListener('change', systemThemeChanged);
});
</script>

<template>
  <div id="reader-app" :inert="!initialized || privateMode" class="app" :class="{ 'sidebar-collapsed': !sidebarOpen }" :hidden="privateMode">
    <QueryToolbar :query-title="queryTitle" :saved="saveLabel" :error="saveError" :sidebar-open="sidebarOpen" @sidebar="toggleSidebar" @settings="settingsDialog.open()" @toggle="setPrivacy(true)" />
    <div class="workspace">
      <ReaderSidebar ref="sidebar" v-model:encoding="encoding" :books="state.books" :active-id="state.activeId" :chapters="chapters" :chapter-index="chapterIndex" :busy="importing" :source-url="state.settings.sourceURL" @select-book="selectBook" @remove-book="removeBook" @navigate="navigate" @files="importFiles" @read-online="readOnline" @refresh-online="refreshOnline" @settings="settingsDialog.open()" />
      <ReadingPane ref="pane" :query-title="queryTitle" :book="displayBook" :chapters="chapters" :chapter-index="chapterIndex" :hidden="privateMode" :busy="importing" :loading="onlineLoading" :error="onlineError" :warning="onlineWarning" @retry="retryOnline" @position="updatePosition" @navigate="navigate" @seek="seek" @import="sidebar.chooseFiles()" @sample="loadSample" />
    </div>
  </div>
  <section v-if="!initialized" class="storage-overlay" role="status"><h2>{{ loadError ? '无法读取本地文件' : '正在加载查询…' }}</h2><p>{{ loadError || '正在恢复本地文件和编辑位置。' }}</p><button v-if="loadError" class="button" @click="initialize">重新读取</button></section>
  <div v-if="initialized && saveError && !privateMode" id="save-error" class="save-error" role="alert">{{ saveError }}<span>最新修改尚未保存，请保持插件打开。</span></div>
  <QueryCover ref="queryCover" v-show="privateMode" @title="queryTitle = $event" @restore="setPrivacy(false)" />
  <ReaderSettings ref="settingsDialog" :settings="state.settings" @change="changeSetting" @reset="resetSettings" />
  <dialog id="confirm-dialog" ref="confirmDialog" class="confirm-dialog" aria-labelledby="confirm-title" @cancel="confirmation = undefined"><h2 id="confirm-title">{{ confirmation?.title }}</h2><p id="confirm-message">{{ confirmation?.message }}</p><div class="dialog-actions"><button id="confirm-cancel" class="button quiet" @click="closeConfirm">取消</button><button id="confirm-ok" class="button import-button" @click="confirmOK">确定</button></div></dialog>
  <div id="toast" class="toast" role="status" aria-live="polite" :hidden="!toast || privateMode">{{ toast }}</div>
</template>
