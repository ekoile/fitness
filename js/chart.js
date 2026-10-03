// Minimal, dependency-free SVG line chart with a crosshair + tooltip.
// points: [{ date: ISO, value: number, deload: bool }]

function niceTicks(min, max, count = 4) {
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (t) => {
  const d = new Date(t);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
};

export function renderLineChart(container, points, { format = (v) => String(v), height = 220 } = {}) {
  container.innerHTML = '';
  if (!points.length) return;
  const width = Math.max(260, container.clientWidth || 320);
  const m = { top: 14, right: 16, bottom: 28, left: 44 };
  const iw = width - m.left - m.right;
  const ih = height - m.top - m.bottom;

  const times = points.map((p) => new Date(p.date).getTime());
  const values = points.map((p) => p.value);
  let t0 = Math.min(...times);
  let t1 = Math.max(...times);
  if (t0 === t1) { t0 -= 86400000 * 3; t1 += 86400000 * 3; }
  // Weights/reps rarely make sense from zero, but include zero when data is near it.
  const vMin = Math.min(...values);
  const vMax = Math.max(...values);
  const ticks = niceTicks(vMin < vMax * 0.25 ? 0 : vMin, vMax);
  const y0 = ticks[0];
  const y1 = ticks[ticks.length - 1];

  const x = (t) => m.left + ((t - t0) / (t1 - t0)) * iw;
  const y = (v) => m.top + ih - ((v - y0) / (y1 - y0 || 1)) * ih;

  const NS = 'http://www.w3.org/2000/svg';
  const el = (name, attrs, parent) => {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };

  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'chart', role: 'img' });

  // Gridlines + y labels
  for (const t of ticks) {
    el('line', { x1: m.left, x2: width - m.right, y1: y(t), y2: y(t), class: 'grid' }, svg);
    const lab = el('text', { x: m.left - 8, y: y(t) + 4, 'text-anchor': 'end', class: 'axis-label' }, svg);
    lab.textContent = format(t);
  }

  // X labels: first, last, and a middle one if there is room.
  const xTicks = [t0, t1];
  if (iw > 240) xTicks.splice(1, 0, (t0 + t1) / 2);
  xTicks.forEach((t, i) => {
    const anchor = i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle';
    const lab = el('text', { x: x(t), y: height - 8, 'text-anchor': anchor, class: 'axis-label' }, svg);
    lab.textContent = shortDate(t);
  });

  // Line
  if (points.length > 1) {
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(times[i]).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
    el('path', { d, class: 'series-line' }, svg);
  }

  // Crosshair (hidden until hover)
  const cross = el('line', { y1: m.top, y2: m.top + ih, class: 'crosshair', visibility: 'hidden' }, svg);

  // Dots: filled = normal week, hollow = deload week
  const dots = points.map((p, i) =>
    el('circle', { cx: x(times[i]), cy: y(p.value), r: 4, class: p.deload ? 'dot dot-deload' : 'dot' }, svg),
  );

  container.appendChild(svg);

  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  container.appendChild(tip);

  // Hover/touch: snap to the nearest point by x.
  const hit = el('rect', { x: m.left - 10, y: 0, width: iw + 20, height, fill: 'transparent' }, svg);
  let active = -1;
  const show = (evt) => {
    const rect = svg.getBoundingClientRect();
    const px = ((evt.clientX - rect.left) / rect.width) * width;
    let best = 0;
    for (let i = 1; i < times.length; i++) {
      if (Math.abs(x(times[i]) - px) < Math.abs(x(times[best]) - px)) best = i;
    }
    if (active >= 0) dots[active].setAttribute('r', 4);
    active = best;
    dots[best].setAttribute('r', 6);
    const cx = x(times[best]);
    cross.setAttribute('x1', cx);
    cross.setAttribute('x2', cx);
    cross.setAttribute('visibility', 'visible');
    const p = points[best];
    tip.innerHTML = '';
    const v = document.createElement('strong');
    v.textContent = format(p.value);
    const dt = document.createElement('span');
    dt.textContent = shortDate(times[best]) + (p.deload ? ' · deload' : '');
    tip.append(v, dt);
    tip.hidden = false;
    const left = (cx / width) * rect.width;
    tip.style.left = Math.min(Math.max(left, 50), rect.width - 50) + 'px';
    tip.style.top = (y(p.value) / height) * rect.height - 8 + 'px';
  };
  const hide = () => {
    if (active >= 0) dots[active].setAttribute('r', 4);
    active = -1;
    cross.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', hide);
}
