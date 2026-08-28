/* Epic BOS — offline SVG chart + UI library (no CDN, no deps).
   Include on any page:  <script src="/ui/assets/epic-ui.js"></script>
   Everything renders crisp SVG that works fully offline inside the Electron app.

   API (all take a container el + data; safe on empty data):
     Epic.api(path, opts)                      -> fetch helper (x-api-key)
     Epic.inr(n) / Epic.num(n) / Epic.pct(n)   -> India-format helpers
     Epic.kpi(el, {label,value,delta,icon,spark,foot,tone})
     Epic.lineChart(el, series, {x,y,label,color,area,height})
     Epic.barChart(el, rows, {label,value,secondary,height,horizontal,color,money})
     Epic.donut(el, rows, {label,value,center,money})
     Epic.sparkline(el, values, {color,height})
     Epic.gauge(el, pct, {label})
     Epic.heat(el, buckets, {value,label})      -> 24h intensity strip
     Epic.toast(msg, tone)
     Epic.sidebar(active)                        -> renders the shared app nav
*/
(function (global) {
  const NS = 'http://www.w3.org/2000/svg';
  const KEY = '';
  const PALETTE = ['#6d8bff','#3ecf8e','#ffb454','#ff6b6b','#a06bff','#22d3ee','#f472b6','#94a3b8'];

  // ---- data + format helpers ----
  const api = (p, o = {}) => fetch('/api' + p, { headers: { 'x-api-key': KEY, 'Content-Type': 'application/json' }, ...o }).then(r => r.json());
  const inr = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
  const inr1 = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 });
  const num = (n) => (Number(n) || 0).toLocaleString('en-IN');
  const pct = (n) => (Number(n) || 0).toFixed(1) + '%';
  const compact = (n) => { n = Number(n) || 0; const a = Math.abs(n); if (a >= 1e7) return '₹' + (n/1e7).toFixed(2) + 'Cr'; if (a >= 1e5) return '₹' + (n/1e5).toFixed(2) + 'L'; if (a >= 1e3) return '₹' + (n/1e3).toFixed(1) + 'K'; return '₹' + Math.round(n); };

  function el(tag, attrs, kids) {
    const e = document.createElementNS(NS, tag);
    for (const k in (attrs || {})) e.setAttribute(k, attrs[k]);
    for (const c of (kids || [])) e.appendChild(c);
    return e;
  }
  function svg(w, h, vb) { return el('svg', { width: '100%', height: h, viewBox: vb || `0 0 ${w} ${h}`, preserveAspectRatio: 'none', style: 'overflow:visible' }); }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

  // ---- KPI tile ----
  function kpi(container, o) {
    const tone = o.tone || (o.delta > 0 ? 'up' : o.delta < 0 ? 'down' : 'flat');
    const dArrow = o.delta > 0 ? '▲' : o.delta < 0 ? '▼' : '■';
    const dCls = o.delta > 0 ? 'up' : o.delta < 0 ? 'down' : 'flat';
    const wrap = document.createElement('div');
    wrap.className = 'card kpi';
    wrap.innerHTML =
      `<div class="k-label">${o.label}</div>` +
      `<div class="k-val">${o.value}</div>` +
      `<div class="k-foot">` +
        (o.delta !== undefined && o.delta !== null ? `<span class="delta ${dCls}">${dArrow} ${Math.abs(o.delta).toFixed(1)}%</span>` : '') +
        (o.foot ? `<span>${o.foot}</span>` : '') +
      `</div>` +
      (o.icon ? `<div class="k-ico">${o.icon}</div>` : '');
    if (o.spark && o.spark.length) {
      const holder = document.createElement('div'); holder.className = 'spark';
      wrap.appendChild(holder);
      sparkline(holder, o.spark, { color: tone === 'down' ? 'var(--bad)' : 'var(--ok)', height: 34 });
    }
    if (container) { container.appendChild(wrap); }
    return wrap;
  }

  // ---- sparkline ----
  function sparkline(container, values, o = {}) {
    o = o || {}; const h = o.height || 34, w = 120;
    const s = svg(w, h); const node = clear(container); node.appendChild(s);
    if (!values || values.length < 2) return s;
    const max = Math.max(...values), min = Math.min(...values), span = (max - min) || 1;
    const step = w / (values.length - 1);
    const pts = values.map((v, i) => [i * step, h - 4 - ((v - min) / span) * (h - 8)]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const area = `${d} L ${w} ${h} L 0 ${h} Z`;
    const col = o.color || 'var(--brand)';
    s.appendChild(el('path', { d: area, fill: col, 'fill-opacity': '0.12', stroke: 'none' }));
    s.appendChild(el('path', { d, fill: 'none', stroke: col, 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    return s;
  }

  // ---- line / area chart with axes + hover ----
  function lineChart(container, series, o = {}) {
    o = o || {}; const h = o.height || 240, w = 640, padL = 46, padB = 26, padT = 12, padR = 12;
    const node = clear(container); const s = svg(w, h); node.appendChild(s);
    const xKey = o.x || 'label', yKey = o.y || 'revenue';
    if (!series || !series.length) { node.innerHTML = '<div class="empty">No data yet.</div>'; return; }
    const ys = series.map(d => Number(d[yKey]) || 0);
    const maxY = Math.max(1, ...ys); const niceMax = niceCeil(maxY);
    const iw = w - padL - padR, ih = h - padT - padB;
    const xAt = i => padL + (series.length === 1 ? iw / 2 : (i / (series.length - 1)) * iw);
    const yAt = v => padT + ih - (v / niceMax) * ih;
    // gridlines + y labels
    for (let g = 0; g <= 4; g++) {
      const val = niceMax * g / 4, y = yAt(val);
      s.appendChild(el('line', { x1: padL, y1: y, x2: w - padR, y2: y, stroke: 'var(--line)', 'stroke-width': '1' }));
      const t = el('text', { x: padL - 8, y: y + 4, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': '10' }); t.textContent = compact(val); s.appendChild(t);
    }
    const col = o.color || 'var(--brand)';
    const pts = series.map((d, i) => [xAt(i), yAt(Number(d[yKey]) || 0)]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    if (o.area !== false) {
      const grad = 'grad_' + Math.abs(hash(container.id || yKey));
      const defs = el('defs'); const lg = el('linearGradient', { id: grad, x1: '0', y1: '0', x2: '0', y2: '1' });
      lg.appendChild(el('stop', { offset: '0', 'stop-color': col, 'stop-opacity': '0.35' }));
      lg.appendChild(el('stop', { offset: '1', 'stop-color': col, 'stop-opacity': '0' }));
      defs.appendChild(lg); s.appendChild(defs);
      s.appendChild(el('path', { d: `${d} L ${pts[pts.length-1][0]} ${padT+ih} L ${pts[0][0]} ${padT+ih} Z`, fill: `url(#${grad})` }));
    }
    s.appendChild(el('path', { d, fill: 'none', stroke: col, 'stroke-width': '2.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    // x labels (thin out) + points
    const skip = Math.ceil(series.length / 8);
    series.forEach((row, i) => {
      s.appendChild(el('circle', { cx: pts[i][0], cy: pts[i][1], r: '2.6', fill: col }));
      if (i % skip === 0 || i === series.length - 1) {
        const t = el('text', { x: pts[i][0], y: h - 8, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': '10' }); t.textContent = row[xKey]; s.appendChild(t);
      }
    });
    return s;
  }

  // ---- bar chart (vertical or horizontal), optional secondary (weighted) overlay ----
  function barChart(container, rows, o = {}) {
    o = o || {}; const node = clear(container);
    const labelKey = o.label || 'label', valKey = o.value || 'value';
    if (!rows || !rows.length) { node.innerHTML = '<div class="empty">No data yet.</div>'; return; }
    const money = o.money !== false;
    const max = Math.max(1, ...rows.map(r => Number(r[valKey]) || 0));
    if (o.horizontal) {
      const holder = document.createElement('div');
      rows.forEach((r, i) => {
        const v = Number(r[valKey]) || 0;
        const line = document.createElement('div'); line.style.marginBottom = '11px';
        line.innerHTML =
          `<div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:4px"><span>${r[labelKey]}</span><span class="hint">${money ? inr(v) : num(v)}</span></div>` +
          `<div class="progress"><i style="width:${Math.round(v / max * 100)}%;background:${PALETTE[i % PALETTE.length]}"></i></div>`;
        holder.appendChild(line);
      });
      node.appendChild(holder); return;
    }
    const h = o.height || 220, w = 640, padL = 40, padB = 30, padT = 10;
    const s = svg(w, h); node.appendChild(s);
    const niceMax = niceCeil(max); const iw = w - padL - 10, ih = h - padT - padB;
    const bw = iw / rows.length; const barW = Math.min(46, bw * 0.6);
    for (let g = 0; g <= 4; g++) { const y = padT + ih - (g / 4) * ih; s.appendChild(el('line', { x1: padL, y1: y, x2: w - 10, y2: y, stroke: 'var(--line)' })); const t = el('text', { x: padL - 6, y: y + 4, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': '10' }); t.textContent = compact(niceMax * g / 4); s.appendChild(t); }
    rows.forEach((r, i) => {
      const v = Number(r[valKey]) || 0; const bh = (v / niceMax) * ih; const x = padL + i * bw + (bw - barW) / 2; const y = padT + ih - bh;
      s.appendChild(el('rect', { x, y, width: barW, height: Math.max(0, bh), rx: 5, fill: PALETTE[i % PALETTE.length] }));
      if (o.secondary && r[o.secondary] !== undefined) { const sh = (Number(r[o.secondary]) / niceMax) * ih; s.appendChild(el('rect', { x, y: padT + ih - sh, width: barW, height: Math.max(0, sh), rx: 5, fill: '#fff', 'fill-opacity': '0.18' })); }
      const t = el('text', { x: x + barW / 2, y: h - 10, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': '10' }); t.textContent = String(r[labelKey]).slice(0, 10); s.appendChild(t);
    });
    return s;
  }

  // ---- donut ----
  function donut(container, rows, o = {}) {
    o = o || {}; const node = clear(container);
    const labelKey = o.label || 'label', valKey = o.value || 'value';
    const data = (rows || []).filter(r => (Number(r[valKey]) || 0) > 0);
    if (!data.length) { node.innerHTML = '<div class="empty">No data yet.</div>'; return; }
    const total = data.reduce((a, r) => a + (Number(r[valKey]) || 0), 0) || 1;
    const R = 54, sw = 20, C = 2 * Math.PI * R; let acc = 0;
    const wrap = document.createElement('div'); wrap.style.display = 'flex'; wrap.style.alignItems = 'center'; wrap.style.gap = '18px'; wrap.style.flexWrap = 'wrap';
    const s = el('svg', { width: '150', height: '150', viewBox: '0 0 150 150' });
    s.appendChild(el('circle', { r: R, cx: 75, cy: 75, fill: 'none', stroke: 'var(--bg-2)', 'stroke-width': sw }));
    data.forEach((r, i) => {
      const frac = (Number(r[valKey]) || 0) / total;
      s.appendChild(el('circle', { r: R, cx: 75, cy: 75, fill: 'none', stroke: PALETTE[i % PALETTE.length], 'stroke-width': sw, 'stroke-dasharray': `${frac * C} ${C}`, 'stroke-dashoffset': `${-acc * C}`, transform: 'rotate(-90 75 75)', 'stroke-linecap': 'butt' }));
      acc += frac;
    });
    const cText = o.center || (o.money ? compact(total) : num(total));
    const t1 = el('text', { x: 75, y: 72, 'text-anchor': 'middle', fill: 'var(--ink)', 'font-size': '20', 'font-weight': '700' }); t1.textContent = cText;
    const t2 = el('text', { x: 75, y: 90, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': '10' }); t2.textContent = o.centerLabel || 'total';
    s.appendChild(t1); s.appendChild(t2); wrap.appendChild(s);
    const legend = document.createElement('div'); legend.className = 'legend'; legend.style.flexDirection = 'column';
    data.forEach((r, i) => { const pctv = Math.round((Number(r[valKey]) || 0) / total * 100); const sp = document.createElement('span'); sp.innerHTML = `<i class="dot" style="background:${PALETTE[i % PALETTE.length]}"></i> ${r[labelKey]} <b style="color:var(--ink);margin-left:4px">${o.money ? inr(r[valKey]) : num(r[valKey])}</b> <span class="hint">(${pctv}%)</span>`; legend.appendChild(sp); });
    wrap.appendChild(legend); node.appendChild(wrap);
  }

  // ---- radial gauge (0–100) ----
  function gauge(container, value, o = {}) {
    o = o || {}; const node = clear(container); const p = Math.max(0, Math.min(100, Number(value) || 0));
    const R = 52, sw = 14, C = Math.PI * R; // half circle
    const s = el('svg', { width: '160', height: '96', viewBox: '0 0 160 96' });
    const col = p >= 66 ? 'var(--ok)' : p >= 33 ? 'var(--warn)' : 'var(--bad)';
    s.appendChild(el('path', { d: arcPath(80, 82, R, 180, 360), fill: 'none', stroke: 'var(--bg-2)', 'stroke-width': sw, 'stroke-linecap': 'round' }));
    s.appendChild(el('path', { d: arcPath(80, 82, R, 180, 180 + (p / 100) * 180), fill: 'none', stroke: col, 'stroke-width': sw, 'stroke-linecap': 'round' }));
    const t = el('text', { x: 80, y: 78, 'text-anchor': 'middle', fill: 'var(--ink)', 'font-size': '22', 'font-weight': '700' }); t.textContent = p + '%'; s.appendChild(t);
    node.appendChild(s); if (o.label) { const l = document.createElement('div'); l.className = 'hint'; l.style.textAlign = 'center'; l.textContent = o.label; node.appendChild(l); }
  }

  // ---- 24h heat strip ----
  function heat(container, buckets, o = {}) {
    o = o || {}; const node = clear(container); const valKey = o.value || 'orders';
    if (!buckets || !buckets.length) { node.innerHTML = '<div class="empty">No data yet.</div>'; return; }
    const max = Math.max(1, ...buckets.map(b => Number(b[valKey]) || 0));
    const wrap = document.createElement('div'); wrap.style.display = 'grid'; wrap.style.gridTemplateColumns = `repeat(${buckets.length}, 1fr)`; wrap.style.gap = '3px';
    buckets.forEach(b => { const v = Number(b[valKey]) || 0; const intensity = v / max; const cell = document.createElement('div'); cell.title = `${b.label}: ${o.money ? inr(b.value) : v + ' orders'}`; cell.style.cssText = `height:34px;border-radius:5px;background:rgba(109,139,255,${0.08 + intensity * 0.85})`; wrap.appendChild(cell); });
    node.appendChild(wrap);
    const ax = document.createElement('div'); ax.className = 'hint'; ax.style.cssText = 'display:flex;justify-content:space-between;margin-top:5px'; ax.innerHTML = '<span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>11p</span>'; node.appendChild(ax);
  }

  // ---- toast ----
  function toast(msg, tone) {
    let host = document.getElementById('epic-toasts');
    if (!host) { host = document.createElement('div'); host.id = 'epic-toasts'; host.style.cssText = 'position:fixed;right:18px;bottom:18px;display:flex;flex-direction:column;gap:8px;z-index:9999'; document.body.appendChild(host); }
    const t = document.createElement('div');
    const col = tone === 'bad' ? 'var(--bad)' : tone === 'warn' ? 'var(--warn)' : tone === 'ok' ? 'var(--ok)' : 'var(--brand)';
    t.style.cssText = `background:var(--surface);border:1px solid var(--line-2);border-left:3px solid ${col};color:var(--ink);padding:11px 15px;border-radius:10px;box-shadow:var(--shadow);font-size:13px;max-width:320px;animation:sk .2s`;
    t.textContent = msg; host.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = '.4s'; setTimeout(() => t.remove(), 400); }, 3200);
  }

  // ---- shared sidebar nav (one definition for the whole app) ----
  const NAV = [
    ['Overview', [['/ui/', '📊', 'Dashboard']]],
    ['Sell', [['/ui/pos.html','🧾','POS Billing'],['/ui/invoices.html','📄','Invoices'],['/ui/crm.html','🤝','CRM'],['/ui/engage.html','💬','Engagement'],['/ui/selling.html','📈','Quotations & Orders']]],
    ['Stock', [['/ui/inventory.html','📦','Inventory'],['/ui/buying.html','📝','Buying'],['/ui/purchases.html','🛒','Purchases'],['/ui/manufacturing.html','🏭','Manufacturing']]],
    ['Money', [['/ui/accounting.html','📒','Accounting'],['/ui/banking.html','🏦','Banking'],['/ui/gst.html','🏛️','GST & e-Invoice'],['/ui/compliance.html','⚖️','Compliance'],['/ui/returns.html','↩','Returns']]],
    ['People', [['/ui/hr.html','👥','HR & Payroll'],['/ui/projects.html','📋','Projects'],['/ui/assets.html','🏗️','Assets']]],
    ['More', [['/ui/ai.html','✨','Epic AI'],['/ui/ops.html','⚙️','Operations'],['/ui/multi-entity.html','🌐','Multi-entity'],['/ui/migration.html','📥','Migration'],['/ui/ecosystem.html','🧩','Platform'],['/ui/portal.html','🔗','Portal']]],
  ];
  function sidebar(active) {
    let html = `<div class="brand"><span class="logo">⚡</span><div><b>Epic BOS</b><small>India Business OS</small></div></div>`;
    for (const [group, items] of NAV) {
      html += `<div class="nav-group">${group}</div><nav class="nav">`;
      for (const [href, ico, label] of items) {
        const on = (active && (href === active || (href !== '/ui/' && location.pathname.endsWith(href.replace('/ui/', ''))))) ? 'active' : '';
        html += `<a class="${on}" href="${href}"><span class="ico">${ico}</span>${label}</a>`;
      }
      html += `</nav>`;
    }
    return html;
  }

  // ---- helpers ----
  function niceCeil(v) { if (v <= 0) return 1; const mag = Math.pow(10, Math.floor(Math.log10(v))); const n = v / mag; const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10; return step * mag; }
  function hash(s) { s = String(s); let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
  function arcPath(cx, cy, r, a1, a2) { const p1 = polar(cx, cy, r, a1), p2 = polar(cx, cy, r, a2); const large = a2 - a1 <= 180 ? 0 : 1; return `M ${p1.x} ${p1.y} A ${r} ${r} 0 ${large} 1 ${p2.x} ${p2.y}`; }
  function polar(cx, cy, r, deg) { const a = (deg - 0) * Math.PI / 180; return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }; }

  global.Epic = { api, inr, inr1, num, pct, compact, kpi, sparkline, lineChart, barChart, donut, gauge, heat, toast, sidebar, PALETTE };
})(window);
