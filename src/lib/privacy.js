// DBX 的工作台通过 v-show 隐藏 iframe，不会触发文档 visibilitychange。
// 交叉观察可跨 iframe 感知祖先的 display:none；失焦覆盖点击 SQL/表格的路径。
export function observePrivacy(conceal) {
  const hide = () => conceal();
  const visibility = () => { if (document.hidden) hide(); };
  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => !entry.isIntersecting || entry.intersectionRatio === 0)) hide();
  });
  observer.observe(document.documentElement);
  window.addEventListener('blur', hide);
  window.addEventListener('pagehide', hide);
  document.addEventListener('visibilitychange', visibility);
  return () => {
    observer.disconnect();
    window.removeEventListener('blur', hide);
    window.removeEventListener('pagehide', hide);
    document.removeEventListener('visibilitychange', visibility);
  };
}
