// PNG 编码放在 Worker 线程里做：不占界面线程，也不依赖界面线程空闲（canvas.toBlob 在无显卡加速时会卡约 1 秒）
self.onmessage = async (e) => {
  const { id, bitmap } = e.data;
  try {
    const oc = new OffscreenCanvas(bitmap.width, bitmap.height);
    oc.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await oc.convertToBlob({ type: 'image/png' });
    const ab = await blob.arrayBuffer();
    self.postMessage({ id, png: ab }, [ab]);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
