// 动作弧几何。键的槽位固定：3 键夹角 60°，4 键 48°，半径 104，中心死区 32，扇区到 180。
const RADIUS = 104;
const KEY = 60;
const HUB = 64;
const HIT = 180;
const DEAD = 32;

function stepFor(count) {
  if (count >= 4) return 48;
  if (count === 3) return 60;
  return 0;
}

// 屏幕坐标：0° 向右，90° 向下。
function angles(count, centerDeg) {
  const step = stepFor(count);
  const out = [];
  for (let i = 0; i < count; i++) out.push(centerDeg + ((count - 1) / 2 - i) * step);
  return out;
}

function point(angleDeg, r) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

function norm(angle) {
  let a = angle % 360;
  if (a < 0) a += 360;
  return a;
}
function angDiff(a, b) {
  const d = Math.abs(norm(a) - norm(b));
  return Math.min(d, 360 - d);
}

// 下半屏向上开，上半屏向下开；贴左右边时转向屏幕内侧。然后把整段弧平移进工作区，半径不变。
function placeArc({ cursor, workArea, count, anchor }) {
  const area = workArea || { x: 0, y: 0, width: 1920, height: 1080 };
  const n = Math.max(1, count || 1);
  const margin = 16;
  const reach = RADIUS + KEY / 2 + 28;
  let dir = 'down';
  if (anchor === 'tray') dir = 'down';
  else if (cursor) {
    const midY = area.y + area.height / 2;
    dir = cursor.y > midY ? 'up' : 'down';
    if (cursor.x < area.x + reach) dir = 'right';
    else if (cursor.x > area.x + area.width - reach) dir = 'left';
  }
  const center = { down: 90, up: 270, right: 0, left: 180 }[dir];
  const angs = angles(n, center);
  let hx = cursor ? cursor.x : area.x + area.width / 2;
  let hy = cursor ? cursor.y : area.y + 40;
  if (anchor === 'tray' && cursor) { hx = cursor.x; hy = cursor.y; }
  const pts = angs.map((a) => point(a, RADIUS));
  let minX = 0; let minY = 0; let maxX = 0; let maxY = 0;
  for (const p of pts) {
    minX = Math.min(minX, p.x - KEY / 2);
    maxX = Math.max(maxX, p.x + KEY / 2);
    minY = Math.min(minY, p.y - KEY / 2);
    maxY = Math.max(maxY, p.y + KEY / 2 + 22);
  }
  minX = Math.min(minX, -HUB / 2);
  maxX = Math.max(maxX, HUB / 2);
  minY = Math.min(minY, -HUB / 2);
  maxY = Math.max(maxY, HUB / 2);
  if (hx + minX < area.x + margin) hx = area.x + margin - minX;
  if (hx + maxX > area.x + area.width - margin) hx = area.x + area.width - margin - maxX;
  if (hy + minY < area.y + margin) hy = area.y + margin - minY;
  if (hy + maxY > area.y + area.height - margin) hy = area.y + area.height - margin - maxY;
  return { dir, center, angles: angs, hub: { x: hx, y: hy }, radius: RADIUS, key: KEY, hubSize: HUB, hit: HIT };
}

function hitTest(dx, dy, anglesList) {
  const r = Math.hypot(dx, dy);
  if (r <= DEAD) return { zone: 'cancel' };
  if (r > HIT) return { zone: 'outside' };
  const ang = norm(Math.atan2(dy, dx) * 180 / Math.PI);
  let best = 0;
  let bestD = Infinity;
  anglesList.forEach((a, i) => {
    const d = angDiff(ang, a);
    if (d < bestD) { bestD = d; best = i; }
  });
  const half = anglesList.length > 1 ? stepFor(anglesList.length) / 2 + 8 : 180;
  if (bestD > half) return { zone: 'outside' };
  return { zone: 'key', index: best };
}

module.exports = { RADIUS, KEY, HUB, HIT, DEAD, angles, point, placeArc, hitTest, stepFor };
