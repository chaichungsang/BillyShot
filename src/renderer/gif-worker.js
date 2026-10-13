// GIF 编码 Worker（gifenc，每帧独立调色板）
import { GIFEncoder, quantize, applyPalette } from './vendor/gifenc.esm.js';

let gif = null, w = 0, h = 0, frames = 0;
self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') { gif = GIFEncoder(); w = m.w; h = m.h; frames = 0; return; }
  if (m.type === 'frame') {
    const rgba = new Uint8ClampedArray(m.data);
    const palette = quantize(rgba, 256, { format: 'rgb565' });
    const index = applyPalette(rgba, palette, 'rgb565');
    gif.writeFrame(index, w, h, { palette, delay: Math.max(20, Math.round(m.delay)), repeat: 0 });
    frames++;
    self.postMessage({ type: 'progress', frames });
    return;
  }
  if (m.type === 'finish') {
    gif.finish();
    const bytes = gif.bytes();
    self.postMessage({ type: 'done', bytes: bytes.buffer, frames }, [bytes.buffer]);
  }
};
