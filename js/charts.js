// Gráfico de linhas em SVG puro, com crosshair e tooltip. Sem dependências.
// series: [{ name, color, dashed, points: [{ date: 'YYYY-MM-DD', value, event? }] }]
// Pontos com event 'net' marcam vencimentos (degrau = impostos pagos no resgate).

import { brl, brlShort, date as fmtDate } from './formatters.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function niceTicks(min, max, count = 5) {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const ticks = [];
  for (let v = Math.floor(min / step) * step; v <= max + step / 2; v += step) ticks.push(v);
  return ticks;
}

// Valor de uma série numa data: último ponto com data ≤ alvo (após o resgate, o líquido).
function valueAt(points, t) {
  let found = null;
  for (const p of points) if (p.t <= t) found = p;
  return found;
}

export function renderLineChart(container, series, { height = 300 } = {}) {
  const width = Math.max(320, container.clientWidth || 640);
  const m = { top: 16, right: 16, bottom: 32, left: 64 };
  const all = series.flatMap((s) => s.points.map((p) => ({ ...p, t: Date.parse(p.date) })));
  if (!all.length) {
    container.textContent = 'Sem dados para o gráfico.';
    return;
  }
  const tMin = Math.min(...all.map((p) => p.t));
  const tMax = Math.max(...all.map((p) => p.t));
  const yTicks = niceTicks(Math.min(...all.map((p) => p.value)), Math.max(...all.map((p) => p.value)));
  const yMin = yTicks[0];
  const yMax = yTicks.at(-1);
  const x = (t) => m.left + ((t - tMin) / (tMax - tMin || 1)) * (width - m.left - m.right);
  const y = (v) => m.top + (1 - (v - yMin) / (yMax - yMin || 1)) * (height - m.top - m.bottom);

  const prepared = series.map((s) => ({ ...s, pts: s.points.map((p) => ({ ...p, t: Date.parse(p.date) })) }));

  // Marcas do eixo X: até ~6 datas uniformemente distribuídas.
  const xTickCount = Math.min(6, Math.floor((width - m.left) / 90));
  const xTicks = Array.from({ length: xTickCount + 1 }, (_, i) => tMin + ((tMax - tMin) * i) / xTickCount);

  const grid = yTicks.map((v) => `
    <line x1="${m.left}" x2="${width - m.right}" y1="${y(v)}" y2="${y(v)}" class="chart-grid"/>
    <text x="${m.left - 8}" y="${y(v) + 4}" text-anchor="end" class="chart-axis">${esc(brlShort(v))}</text>`).join('');
  const anchor = (i) => (i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle');
  const xAxis = xTicks.map((t, i) => `
    <text x="${x(t)}" y="${height - 10}" text-anchor="${anchor(i)}" class="chart-axis">${esc(fmtDate(new Date(t).toISOString().slice(0, 10)).slice(3))}</text>`).join('');
  const lines = prepared.map((s) => `
    <path d="${s.pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.value).toFixed(1)}`).join('')}"
      fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" ${s.dashed ? 'stroke-dasharray="6 4"' : ''}/>`).join('');
  const markers = prepared.flatMap((s) => s.pts.filter((p) => p.event === 'net').map((p) => `
    <circle cx="${x(p.t)}" cy="${y(p.value)}" r="4.5" fill="${s.color}" class="chart-marker"/>`)).join('');

  container.innerHTML = `
    <div class="chart-wrap" style="position:relative">
      <svg xmlns="${SVG_NS}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img"
        aria-label="Evolução estimada do patrimônio por estratégia. Os valores estão na tabela por etapa.">
        ${grid}${xAxis}
        <line x1="${m.left}" x2="${m.left}" y1="${m.top}" y2="${height - m.bottom}" class="chart-hair" visibility="hidden"/>
        ${lines}${markers}
        <rect x="${m.left}" y="${m.top}" width="${width - m.left - m.right}" height="${height - m.top - m.bottom}" fill="transparent" class="chart-hit"/>
      </svg>
      <div class="chart-tooltip" role="status" hidden></div>
    </div>`;

  const svg = container.querySelector('svg');
  const hair = svg.querySelector('.chart-hair');
  const tip = container.querySelector('.chart-tooltip');
  const dates = [...new Set(all.map((p) => p.t))].sort((a, b) => a - b);

  const show = (clientX) => {
    const box = svg.getBoundingClientRect();
    const px = ((clientX - box.left) / box.width) * width;
    const t = dates.reduce((best, d) => (Math.abs(x(d) - px) < Math.abs(x(best) - px) ? d : best), dates[0]);
    hair.setAttribute('x1', x(t));
    hair.setAttribute('x2', x(t));
    hair.setAttribute('visibility', 'visible');
    tip.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = fmtDate(new Date(t).toISOString().slice(0, 10));
    tip.append(title);
    for (const s of prepared) {
      const p = valueAt(s.pts, t);
      if (!p) continue;
      const row = document.createElement('div');
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = s.color;
      row.append(sw, `${s.name}: ${brl(p.value)}${p.event === 'net' ? ' (líquido no resgate)' : ''}`);
      tip.append(row);
    }
    tip.hidden = false;
    const left = (x(t) / width) * box.width;
    tip.style.left = `${Math.min(left + 12, box.width - tip.offsetWidth - 4)}px`;
    tip.style.top = '8px';
  };
  const hide = () => {
    hair.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };
  const hit = svg.querySelector('.chart-hit');
  hit.addEventListener('pointermove', (e) => show(e.clientX));
  hit.addEventListener('pointerleave', hide);
}
