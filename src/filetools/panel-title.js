// 面板标题跟着任务动作走。渲染进程用 script 标签加载，测试用 require。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.filetoolsPanelTitle = api.panelTitle;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const TITLES = {
    'image.convert': '转格式',
    'image.compress': '压缩图片',
    'compress-image': '压缩图片',
    'image.resize': '改尺寸',
    'resize': '改尺寸',
    'video.mp4': '转 MP4',
    'video.compress': '压缩视频',
    'compress-video': '压缩视频',
    'video.trim': '剪头尾',
    'trim': '剪头尾',
    'video.gif': '转 GIF',
    'pdf.make': '合成 PDF',
  };
  function panelTitle(job) {
    const key = (job && (job.action || job.kind)) || '';
    return TITLES[key] || '文件工具';
  }
  return { panelTitle, TITLES };
});
