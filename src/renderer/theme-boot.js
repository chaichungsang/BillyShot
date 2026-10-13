// 在页面渲染前就套上主题，避免先闪一下默认的紫色（主进程把主题放在 URL 参数里）
(function () {
  try {
    const q = new URLSearchParams(location.search);
    const th = q.get('theme');
    if (th) document.documentElement.dataset.theme = th;
    if (q.get('mat') === '1') document.documentElement.classList.add('material');
  } catch {}
})();
