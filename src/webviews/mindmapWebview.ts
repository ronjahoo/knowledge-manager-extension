import * as vscode from 'vscode';
import { readFile } from 'fs/promises';

type MindmapNode = {
  id: string;
  x: number; y: number;
  title: string;
  files?: string[];
  file?: string;
  body?: string;
  bodyH?: number;
  image?: {
    path: string;
    w?: number;
    h?: number;
    fit?: 'cover' | 'contain';
    caption?: string;
  };
};

type MindmapEdge = { id: string; from: string; to: string; label?: string };
type MindmapDoc = { version: 1; nodes: MindmapNode[]; edges: MindmapEdge[] };

function getNonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * Math.random() * chars.length));
  }
  return nonce;
}

async function renderMindmapHtml(
  ctx: vscode.ExtensionContext,
  panel: vscode.WebviewPanel,
  initial: { doc: MindmapDoc; relPath: string; imgMap: Record<string, string> }
) {
  const webview = panel.webview;
  const mediaRoot = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'mindmap');

  const indexHtmlUri = vscode.Uri.joinPath(mediaRoot, 'index.html');
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'main.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'styles.css'));

  const nonce = getNonce();

  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data: blob:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
    `connect-src ${webview.cspSource}`,
  ].join('; ');

  let html = await readFile(indexHtmlUri.fsPath, 'utf8');
  html = html
    .replace(/{{CSP}}/g, csp)
    .replace(/{{STYLE_URI}}/g, String(styleUri))
    .replace(/{{SCRIPT_URI}}/g, String(scriptUri))
    .replace(/{{NONCE}}/g, nonce)
    .replace(
      /{{BOOTSTRAP}}/g,
      `<script nonce="${nonce}">window.initial=${JSON.stringify(initial)};</script>`
    );

  return html;
}
export async function openMindmapWebview(ctx: vscode.ExtensionContext, uri?: vscode.Uri) {
  const target = uri ?? await pickOrCreateMindmap();
  if (!target) { return; }

  const doc = await readMindmapOrDefault(target);
  migrateLinks(doc);

  const column = vscode.workspace.getConfiguration().get('km.twoPane', true)
    ? vscode.ViewColumn.Beside
    : vscode.ViewColumn.Active;

  const ws = vscode.workspace.workspaceFolders?.[0]?.uri;

  const panel = vscode.window.createWebviewPanel(
    'notesMindmap',
    `Mindmap: ${vscode.workspace.asRelativePath(target)}`,
    column,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    }
  );

  function toWebSrc(p: string) {
    if (!ws) { return p; }
    const u = vscode.Uri.joinPath(ws, p);
    return panel.webview.asWebviewUri(u).toString();
  }

  const imgMap: Record<string, string> = Object.fromEntries(
    (doc.nodes || [])
      .filter(n => n.image?.path)
      .map(n => [n.image!.path!, toWebSrc(n.image!.path!)])
  );

  panel.webview.html = await renderMindmapHtml(ctx, panel, {
    doc,
    relPath: vscode.workspace.asRelativePath(target),
    imgMap,
  });

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (!msg || typeof msg !== 'object') { return; }

    if (msg.type === 'saveMindmap') {
      const payload: MindmapDoc = msg.data;
      await writeMindmap(target, payload);
      vscode.window.setStatusBarMessage('Mindmap saved', 1500);
    }

    if (msg.type === 'openFile' && typeof msg.path === 'string') {
      if (!ws) { return; }
      const md = vscode.Uri.joinPath(ws, msg.path);
      try { await vscode.window.showTextDocument(md, { viewColumn: vscode.ViewColumn.One }); }
      catch { vscode.window.showWarningMessage(`File not found: ${msg.path}`); }
    }

    if (msg.type === 'pickMarkdown') {
      const picked = await vscode.window.showOpenDialog({
        canSelectFolders: false, canSelectMany: false, filters: { Markdown: ['md'] }
      });
      const rel = picked?.[0] ? vscode.workspace.asRelativePath(picked[0]) : null;
      panel.webview.postMessage({ type: 'pickedMarkdown', for: msg.for, path: rel });
    }

    if (msg.type === 'pickImage' && typeof msg.for === 'string') {
      const picked = await vscode.window.showOpenDialog({
        canSelectFolders: false,
        canSelectMany: false,
        filters: { Images: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] }
      });
      if (!picked?.[0]) { panel.webview.postMessage({ type: 'pickedImage', for: msg.for }); return; }

      if (!ws) { panel.webview.postMessage({ type: 'pickedImage', for: msg.for }); return; }

      const assetsDir = vscode.Uri.joinPath(ws, 'mindmap-images');
      await ensureDir(assetsDir);

      const base = picked[0].path.split(/[/\\]/).pop()!;
      const t = vscode.Uri.joinPath(assetsDir, base);
      await vscode.workspace.fs.copy(picked[0], t, { overwrite: false });
      const rel = vscode.workspace.asRelativePath(t);
      const src = toWebSrc(rel);
      panel.webview.postMessage({ type: 'pickedImage', for: msg.for, path: rel, src });
    }
  });
}

async function pickOrCreateMindmap(): Promise<vscode.Uri | undefined> {
  const choice = await vscode.window.showQuickPick(
    [
      { label: '$(add) New mindmap', value: 'new' },
      { label: '$(folder-opened) Open existing', value: 'open' }
    ],
    { placeHolder: 'Mindmap file' }
  );
  if (!choice) { return; }

  const ws = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!ws) { vscode.window.showWarningMessage('Open a folder to use mindmaps.'); return; }

  const dir = vscode.Uri.joinPath(ws, 'mindmaps');
  await ensureDir(dir);

  if (choice.value === 'new') {
    const basename = await vscode.window.showInputBox({
      prompt: 'Name for the mindmap file',
      value: `map-${new Date().toISOString().slice(0, 10)}.mindmap.json`
    });
    if (!basename) { return; }
    const file = vscode.Uri.joinPath(dir, basename);
    const empty: MindmapDoc = { version: 1, nodes: [], edges: [] };
    await writeMindmap(file, empty);
    return file;
  } else {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false, canSelectFolders: false, defaultUri: dir,
      filters: { 'Mindmap JSON': ['json'] }
    });
    return picked?.[0];
  }
}

async function readMindmapOrDefault(uri: vscode.Uri): Promise<MindmapDoc> {
  const buf = await vscode.workspace.fs.readFile(uri);
  const text = Buffer.from(buf).toString('utf8');
  const parsed = JSON.parse(text);
  if (parsed && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
    return parsed as MindmapDoc;
  }
  return { version: 1, nodes: [], edges: [] };
}

async function writeMindmap(uri: vscode.Uri, doc: MindmapDoc) {
  const enc = new TextEncoder();
  await vscode.workspace.fs.writeFile(uri, enc.encode(JSON.stringify(doc, null, 2)));
}

async function ensureDir(uri: vscode.Uri) {
  await vscode.workspace.fs.createDirectory(uri);
}

function migrateLinks(doc: MindmapDoc) {
  for (const n of doc.nodes) {
    if (!n.files) { n.files = []; }
    if (n.file) {
      if (!n.files.includes(n.file)) {
        n.files.push(n.file);
      }
      delete (n as any).file;
    }
    if (typeof n.body !== 'string') { n.body = ''; }
    if (typeof n.bodyH !== 'number') { n.bodyH = undefined; }
    if (!n.image || typeof n.image !== 'object') { n.image = undefined; }
  }
}
