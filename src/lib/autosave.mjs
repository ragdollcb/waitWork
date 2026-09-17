// 串行提交快照，写入期间的新变化留到下一次，防止旧进度覆盖新进度。
export function createAutosave({ snapshot, save, status, delay = 250, retryDelay = 5000 }) {
  let timer;
  let pending = false;
  let running = false;
  let stopped = false;
  let conflict = false;

  async function flush() {
    clearTimeout(timer);
    timer = undefined;
    if (running || !pending || conflict) return;
    running = true;
    pending = false;
    status('saving');
    try {
      await save(snapshot());
      status(pending ? 'saving' : 'saved');
    } catch (error) {
      pending = true;
      conflict = error.code === -32009 || /其他窗口更新/.test(error.message);
      status('error', error.message || '自动保存失败，请检查磁盘空间和文件权限。');
      if (!stopped && !conflict) timer = setTimeout(flush, retryDelay);
      running = false;
      return;
    }
    running = false;
    if (pending) void flush();
  }

  return {
    changed() {
      if (stopped || conflict) return;
      pending = true;
      status('saving');
      // 不反复重置计时器，连续滚动也会周期保存。
      if (!timer && !running) timer = setTimeout(flush, delay);
    },
    flush,
    stop() { stopped = true; return flush(); },
  };
}
