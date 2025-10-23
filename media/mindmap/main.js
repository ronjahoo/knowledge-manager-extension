const vscode = acquireVsCodeApi();

const initial = window.initial || { doc: { nodes: [], edges: [] }, relPath: '', imgMap: {} };
let doc = initial.doc;
const IMG_MAP = { ...(initial.imgMap || {}) };

const rel = document.getElementById('relpath');
if (rel) rel.textContent = initial.relPath ? `(${initial.relPath})` : "";

for (const n of doc.nodes) {
  if (!n.files) n.files = [];
  if (n.file) { if (!n.files.includes(n.file)) n.files.push(n.file); delete n.file; }
  if (typeof n.body !== 'string') n.body = '';
}

const wrap = document.getElementById('wrap');
const stage = document.getElementById('stage');
const svg = document.getElementById('edges');
const canvas = document.getElementById('canvas');
const modeHint = document.getElementById('modeHint');

let connectMode = false, connectFrom = null;
let selectedNodeId = null;
const stop = (e) => { e.stopPropagation(); e.preventDefault(); };

let clipboardNode = null, cutSourceId = null;
let lastMouse = { x: 200, y: 120 };

let zoom = 1, panX = 0, panY = 0;
function applyTransform() { stage.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ')'; }

function setMode(connect) {
  connectMode = connect;
  connectFrom = null;
  modeHint.textContent = connectMode ? 'Connect mode: click source node, then target node (Esc to cancel)' : '';
}

function basename(p) { return (p || '').split(/[/\\]/).pop() || p; }
function imgSrcFor(p) { return IMG_MAP[p] || p; }

function deleteNode(id) {
  if (cutSourceId === id) cutSourceId = null;
  doc.nodes = doc.nodes.filter(nn => nn.id !== id);
  doc.edges = doc.edges.filter(e => e.from !== id && e.to !== id);
  if (selectedNodeId === id) selectedNodeId = null;
  drawEdges();
}

function shallowCopy(n) {
  return { title: n.title, body: n.body || '', x: (n.x || 0) + 20, y: (n.y || 0) + 10, files: [...(n.files || [])] };
}

function pasteNodeAt(p) {
  if (!clipboardNode) return;
  if (cutSourceId) {
    const n = doc.nodes.find(nn => nn.id === cutSourceId);
    if (n) { n.x = p.x; n.y = p.y; selectedNodeId = n.id; }
    cutSourceId = null;
  } else {
    const id = 'n' + Math.random().toString(36).slice(2, 8);
    doc.nodes.push({ id, x: p.x, y: p.y, title: clipboardNode.title || 'Pasted', body: clipboardNode.body || '', files: [...(clipboardNode.files || [])] });
    selectedNodeId = id;
  }
  render();
}

const sizes = new Map();

function autosize(ta) {
  ta.style.height = 'auto';
  const h = Math.max(ta.scrollHeight, 28);
  ta.style.height = h + 'px';
}

function iconButton(title, onClick) {
  const b = document.createElement('button');
  b.className = 'btn';
  b.type = 'button';
  b.title = title;
  b.textContent = title;
  b.setAttribute('aria-label', title);
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

function render() {
  canvas.innerHTML = '';
  sizes.clear();

  for (const n of doc.nodes) {
    const el = document.createElement('div');
    el.className = 'node' + (n.id === selectedNodeId ? ' selected' : '');
    el.style.left = (n.x || 100) + 'px';
    el.style.top = (n.y || 80) + 'px';
    el.dataset.id = n.id;

    const row = document.createElement('div');
    row.className = 'row';

    const h = document.createElement('div');
    h.className = 'title';
    h.textContent = n.title || 'Untitled';
    h.contentEditable = true;
    h.addEventListener('input', () => { n.title = h.textContent || ''; });
    h.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); } });

    const linkBtn = iconButton('Link', (e) => { stop(e); vscode.postMessage({ type: 'pickMarkdown', for: n.id }); });
    linkBtn.addEventListener('pointerdown', stop);

    const delBtn = iconButton('Delete', (e) => { stop(e); deleteNode(n.id); render(); });
    delBtn.addEventListener('pointerdown', stop);

    const imgBtn = iconButton('Image', (e) => { stop(e); vscode.postMessage({ type: 'pickImage', for: n.id }); });
    delBtn.addEventListener('pointerdown', stop);

    row.appendChild(h);
    row.appendChild(linkBtn);
    row.appendChild(delBtn);
    row.appendChild(imgBtn);
    el.appendChild(row);

    const bodyWrap = document.createElement('div');
    bodyWrap.className = 'body';
    const ta = document.createElement('textarea');
    ta.value = n.body || '';
    ta.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
    ta.addEventListener('input', () => { n.body = ta.value; if (n.bodyH == null) autosize(ta); });
    if (typeof n.bodyH === 'number') { ta.style.height = Math.max(n.bodyH, 28) + 'px'; } else { autosize(ta); }
    const ro = new ResizeObserver(entries => { const r = entries[0].target.getBoundingClientRect(); n.bodyH = Math.round(r.height); sizes.set(n.id, { w: el.offsetWidth, h: el.offsetHeight }); drawEdges(); });
    ro.observe(ta);
    bodyWrap.appendChild(ta);
    el.appendChild(bodyWrap);

    if (n.image && n.image.path) {
      const fig = document.createElement('figure');
      fig.className = 'imgBox';

      const img = document.createElement('img');
      img.draggable = false;
      img.src = imgSrcFor(n.image.path);
      img.style.objectFit = 'contain';

      const rmImg = document.createElement('button');
      rmImg.className = 'remove';
      rmImg.type = 'button';
      rmImg.title = 'Remove image';
      rmImg.textContent = '×';
      rmImg.style.position = 'absolute';
      rmImg.style.right = '4px';
      rmImg.style.top = '4px';
      rmImg.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); });
      rmImg.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); n.image = undefined; render(); });

      fig.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
      fig.appendChild(img);
      fig.appendChild(rmImg);
      el.appendChild(fig);

      const cap = document.createElement('figcaption');
      cap.className = 'caption';
      cap.contentEditable = 'true';
      cap.textContent = n.image.caption || '';
      cap.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
      cap.addEventListener('input', () => { n.image.caption = cap.textContent || ''; });
      el.appendChild(cap);
    }

    const list = document.createElement('div');
    list.className = 'links';
    (n.files || []).forEach((p, idx) => {
      const item = document.createElement('div'); item.className = 'link-item';
      const a = document.createElement('a'); a.href = '#'; a.textContent = basename(p); a.title = p;
      a.addEventListener('pointerdown', stop);
      a.addEventListener('click', e => { e.preventDefault(); stop(e); vscode.postMessage({ type: 'openFile', path: p }); });
      const rm = document.createElement('button'); rm.className = 'remove'; rm.type = 'button'; rm.title = 'Remove link'; rm.textContent = '×';
      rm.addEventListener('pointerdown', stop);
      rm.addEventListener('click', e => { stop(e); (n.files = n.files || []); n.files.splice(idx, 1); render(); });
      item.appendChild(a); item.appendChild(rm); list.appendChild(item);
    });
    el.appendChild(list);

    const roNode = new ResizeObserver(() => { sizes.set(n.id, { w: el.offsetWidth, h: el.offsetHeight }); drawEdges(); });
    roNode.observe(el);
    sizes.set(n.id, { w: el.offsetWidth, h: el.offsetHeight });

    el.addEventListener('mousedown', (e) => {
      const t = e.target;
      if (t instanceof Element && (t.closest('button') || t.closest('a'))) return;
      selectedNodeId = n.id;
      el.classList.add('selected');
    });

    let grabbing = false;
    el.addEventListener('pointerdown', e => {
      const target = e.target;
      if (target instanceof Element && (
        target.closest('button') ||
        target.closest('a') ||
        target.closest('textarea') ||
        target.closest('figure.imgBox') ||
        target.closest('figcaption')
      )) return;
      grabbing = true;
      el.setPointerCapture(e.pointerId);
      el.style.cursor = 'grabbing';
      el.classList.add('selected');
    });
    el.addEventListener('pointermove', e => {
      if (!grabbing) return;
      n.x += e.movementX / zoom;
      n.y += e.movementY / zoom;
      el.style.left = n.x + 'px';
      el.style.top = n.y + 'px';
      drawEdges();
    });
    el.addEventListener('pointerup', () => {
      grabbing = false;
      el.style.cursor = 'grab';
      el.classList.remove('selected');
    });

    el.addEventListener('click', (e) => {
      if (!connectMode) return;
      e.stopPropagation();
      if (!connectFrom) { connectFrom = n.id; el.classList.add('selected'); return; }
      if (connectFrom === n.id) { connectFrom = null; el.classList.remove('selected'); return; }
      const id = 'e' + Math.random().toString(36).slice(2, 8);
      doc.edges.push({ id, from: connectFrom, to: n.id });
      connectFrom = null;
      setMode(false);
      render();
    });

    canvas.appendChild(el);
  }
  drawEdges();
}

function drawEdges() {
  svg.setAttribute('width', wrap.clientWidth);
  svg.setAttribute('height', wrap.clientHeight);
  svg.innerHTML = '';
  const byId = new Map(doc.nodes.map(n => [n.id, n]));
  for (const e of doc.edges) {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b) continue;

    const as = sizes.get(a.id) || { w: 180, h: 80 };
    const bs = sizes.get(b.id) || { w: 180, h: 80 };

    const ax = (a.x || 0) + as.w / 2;
    const ay = (a.y || 0) + as.h / 2;
    const bx = (b.x || 0) + bs.w / 2;
    const by = (b.y || 0) + bs.h / 2;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', ax); line.setAttribute('y1', ay);
    line.setAttribute('x2', bx); line.setAttribute('y2', by);
    line.setAttribute('stroke', '#909399'); line.setAttribute('stroke-width', '2');
    svg.appendChild(line);

    const g = Math.atan2(by - ay, bx - ax);
    const hx = bx - Math.cos(g) * 10, hy = by - Math.sin(g) * 10;
    const p1x = bx, p1y = by;
    const p2x = hx + Math.cos(g + Math.PI / 2) * 5, p2y = hy + Math.sin(g + Math.PI / 2) * 5;
    const p3x = hx + Math.cos(g - Math.PI / 2) * 5, p3y = hy - Math.sin(g - Math.PI / 2) * 5;
    const tri = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    tri.setAttribute('points', `${p1x},${p1y} ${p2x},${p2y} ${p3x},${p3y}`);
    tri.setAttribute('fill', '#909399');
    svg.appendChild(tri);
  }
}

document.getElementById('add').addEventListener('click', () => {
  const id = 'n' + Math.random().toString(36).slice(2, 8);
  doc.nodes.push({ id, x: 120 + Math.random() * 80, y: 100 + Math.random() * 60, title: 'New block', body: '', files: [] });
  render();
});

document.getElementById('connect').addEventListener('click', () => { setMode(!connectMode); });

function save() { vscode.postMessage({ type: 'saveMindmap', data: doc }); }
document.getElementById('save').addEventListener('click', save);

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  if (e.key === 'Escape') setMode(false);
  if ((e.key === 'Delete') && selectedNodeId) { e.preventDefault(); deleteNode(selectedNodeId); render(); }
  const mod = (e.ctrlKey || e.metaKey);
  if (mod && e.key.toLowerCase() === 'c') { if (selectedNodeId) { const n = doc.nodes.find(nn => nn.id === selectedNodeId); if (n) { clipboardNode = shallowCopy(n); cutSourceId = null; } } }
  if (mod && e.key.toLowerCase() === 'x') { if (selectedNodeId) { const n = doc.nodes.find(nn => nn.id === selectedNodeId); if (n) { clipboardNode = shallowCopy(n); cutSourceId = selectedNodeId; } } }
  if (mod && e.key.toLowerCase() === 'v') { if (clipboardNode) { pasteNodeAt(lastMouse); } }
  if (mod && (e.key === '0')) { zoom = 1; panX = 0; panY = 0; applyTransform(); }
  if (mod && (e.key === '+' || e.key === '=')) {
    const rect = wrap.getBoundingClientRect(); const cx = rect.width / 2, cy = rect.height / 2;
    const wx = (cx - panX) / zoom, wy = (cy - panY) / zoom;
    const nz = Math.min(2.5, zoom * 1.1); panX = cx - wx * nz; panY = cy - wy * nz; zoom = nz; applyTransform();
  }
  if (mod && (e.key === '-')) {
    const rect = wrap.getBoundingClientRect(); const cx = rect.width / 2, cy = rect.height / 2;
    const wx = (cx - panX) / zoom, wy = (cy - panY) / zoom;
    const nz = Math.max(0.3, zoom / 1.1); panX = cx - wx * nz; panY = cy - wy * nz; zoom = nz; applyTransform();
  }
});

window.addEventListener('message', (ev) => {
  const msg = ev.data;
  if (msg?.type === 'pickedMarkdown' && msg.for) {
    const node = doc.nodes.find(n => n.id === msg.for);
    if (node && msg.path) { node.files = node.files || []; if (!node.files.includes(msg.path)) node.files.push(msg.path); }
    render();
  }
  if (msg?.type === 'pickedImage' && msg.for) {
    const node = doc.nodes.find(n => n.id === msg.for);
    if (node && msg.path) {
      node.image = node.image || {};
      node.image.path = msg.path;
      IMG_MAP[msg.path] = msg.src || msg.path;
      if (!node.image.fit) node.image.fit = 'contain';
    }
    render();
  }
});

canvas.addEventListener('mousedown', (e) => { if (e.target === canvas) { selectedNodeId = null; render(); } });
canvas.addEventListener('mousemove', (e) => { const rect = canvas.getBoundingClientRect(); lastMouse = { x: (e.clientX - rect.left) / zoom - panX / zoom, y: (e.clientY - rect.top) / zoom - panY / zoom }; });

let panning = false;
wrap.addEventListener('pointerdown', e => {
  const t = e.target;
  if (!(t === wrap || t === canvas || t === svg)) return;
  panning = true; wrap.setPointerCapture(e.pointerId);
});
wrap.addEventListener('pointermove', e => {
  if (!panning) return;
  panX += e.movementX; panY += e.movementY; applyTransform();
});
wrap.addEventListener('pointerup', () => { panning = false; });

wrap.addEventListener('wheel', (e) => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    const rect = wrap.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    const wx = (cx - panX) / zoom, wy = (cy - panY) / zoom;
    const factor = Math.pow(1.0015, -e.deltaY);
    const nz = Math.min(2.5, Math.max(0.3, zoom * factor));
    panX = cx - wx * nz; panY = cy - wy * nz; zoom = nz; applyTransform();
  } else {
    panX -= e.deltaX; panY -= e.deltaY; applyTransform();
  }
}, { passive: false });

setMode(false);
applyTransform();
render();
