(() => {
  const vs = acquireVsCodeApi?.();
  const DPR = Math.max(1, window.devicePixelRatio || 1);

  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');

  const view = { scale: 1, tx: 0, ty: 0 };

  function applyTransform() {
    ctx.setTransform(
      DPR * view.scale, 0,
      0, DPR * view.scale,
      DPR * view.tx, DPR * view.ty
    );
  }

  function screenToWorld(x, y) {
    return {
      x: (x - view.tx) / view.scale,
      y: (y - view.ty) / view.scale
    };
  }
  function worldToScreen(x, y) {
    return {
      x: x * view.scale + view.tx,
      y: y * view.scale + view.ty
    };
  }

  function getPointer(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  let graph = { nodes: [], links: [] };
  const state = {
    nodesByKey: new Map(),
    dragging: false,
    dragStart: { x: 0, y: 0 },
    viewStart: { tx: 0, ty: 0 }
  };

  function onResize() {
    const cssW = canvas.clientWidth || window.innerWidth;
    const cssH = canvas.clientHeight || (window.innerHeight - 48);

    canvas.width = Math.max(1, Math.floor(cssW * DPR));
    canvas.height = Math.max(1, Math.floor(cssH * DPR));

    render();
  }
  window.addEventListener('resize', onResize);

  function ensurePositions() {
    let i = 0;
    for (const n of graph.nodes) {
      if (typeof n.x === 'number' && typeof n.y === 'number') continue;
      if (n.kind === 'tag') {
        const k = i++;
        const angle = (k / Math.max(6, graph.nodes.length)) * Math.PI * 2;
        n.x = Math.cos(angle) * 380;
        n.y = Math.sin(angle) * 280;
      } else {
        const col = (i % 8);
        const row = Math.floor(i / 8);
        n.x = (col - 4) * 120 + (Math.random() * 10 - 5);
        n.y = (row - 4) * 80 + (Math.random() * 10 - 5);
        i++;
      }
    }
    state.nodesByKey.clear();
    for (const n of graph.nodes) state.nodesByKey.set(n.key, n);
  }

  function fitToView(padding = 60) {
    if (!graph.nodes.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of graph.nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x);
      maxY = Math.max(maxY, n.y);
    }
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || (window.innerHeight - 48);

    const w = (maxX - minX) + padding * 2;
    const h = (maxY - minY) + padding * 2;
    if (w <= 0 || h <= 0) return;

    const sx = width / w;
    const sy = height / h;
    view.scale = Math.max(0.2, Math.min(2.0, Math.min(sx, sy)));

    const cxWorld = (minX + maxX) / 2;
    const cyWorld = (minY + maxY) / 2;
    const cxScreen = width / 2;
    const cyScreen = height / 2;

    view.tx = cxScreen - cxWorld * view.scale;
    view.ty = cyScreen - cyWorld * view.scale;
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    applyTransform();

    ctx.lineWidth = 1 / view.scale;
    ctx.strokeStyle = '#c9d1d9';
    for (const e of graph.links) {
      const a = graph.nodes[e.source];
      const b = graph.nodes[e.target];
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    for (const n of graph.nodes) {
      const r = n.kind === 'tag' ? 12 : 8;
      ctx.beginPath();
      ctx.fillStyle = n.kind === 'tag' ? '#b47af7ff' : '#a1e3b1ff';
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.font = `${12 / view.scale}px Rubik, system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#444';
    for (const n of graph.nodes) {
      const r = n.kind === 'tag' ? 12 : 8;
      const label = String(n.label ?? '');
      if (!label) continue;
      ctx.fillText(label, n.x + r + 6, n.y);
    }
  }

  function hitNode(screenX, screenY) {
    const p = screenToWorld(screenX, screenY);
    const r2tag = (12 + 3) ** 2;
    const r2file = (8 + 3) ** 2;
    for (let i = graph.nodes.length - 1; i >= 0; i--) {
      const n = graph.nodes[i];
      const dx = p.x - n.x;
      const dy = p.y - n.y;
      const r2 = n.kind === 'tag' ? r2tag : r2file;
      if (dx * dx + dy * dy <= r2) return n;
    }
    return null;
  }

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const p = getPointer(e);
    state.dragging = true;
    canvas.style.cursor = 'grabbing';
    state.dragStart = { x: p.x, y: p.y };
    state.viewStart = { tx: view.tx, ty: view.ty };
  });

  window.addEventListener('mousemove', (e) => {
    if (!state.dragging) return;
    const p = getPointer(e);
    const dx = p.x - state.dragStart.x;
    const dy = p.y - state.dragStart.y;
    view.tx = state.viewStart.tx + dx;
    view.ty = state.viewStart.ty + dy;
    render();
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    if (!state.dragging) return;
    const p = getPointer(e);
    const moved = Math.hypot(p.x - state.dragStart.x, p.y - state.dragStart.y);
    state.dragging = false;
    canvas.style.cursor = 'grab';
    if (moved < 3) onClick(p.x, p.y);
  });

  function onClick(x, y) {
    const n = hitNode(x, y);
    if (!n) return;
    if (n.kind === 'tag') {
      vs?.postMessage?.({ type: 'toggleTag', tag: n.label });
    } else if (n.kind === 'file') {
      vs?.postMessage?.({ type: 'open', key: n.key });
    }
  }

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = getPointer(e);

    const zoomIntensity = 1.0015;
    const factor = Math.pow(zoomIntensity, -e.deltaY);

    const nextScale = Math.min(4, Math.max(0.2, view.scale * factor));
    const pre = screenToWorld(p.x, p.y);
    view.scale = nextScale;
    const post = worldToScreen(pre.x, pre.y);
    view.tx += p.x - post.x;
    view.ty += p.y - post.y;

    render();
  }, { passive: false });

  canvas.addEventListener('dblclick', () => { fitToView(); render(); });

  window.addEventListener('message', (event) => {
    const msg = event.data || {};
    if (msg.type === 'graph') {
      graph = msg.data || { nodes: [], links: [] };
      ensurePositions();
      if (!viewFittedOnce) {
        fitToView();
        viewFittedOnce = true;
      }
      render();
    }
  });

  let viewFittedOnce = false;

  function bootstrap() {
    const initial = (window).initial;
    if (initial && initial.graph) {
      graph = initial.graph;
      ensurePositions();
      fitToView();
      viewFittedOnce = true;
    }
    canvas.style.cursor = 'grab';
    onResize();
  }
  bootstrap();
})();
