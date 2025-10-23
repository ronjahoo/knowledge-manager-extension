import * as vscode from 'vscode';
import { readFile } from 'fs/promises';
import { IndexService } from '../indexer';

function getNonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) {
    s += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return s;
}

async function renderGraphHtml(
  ctx: vscode.ExtensionContext,
  panel: vscode.WebviewPanel,
  initial: { graph: any }
) {
  const webview = panel.webview;
  const mediaRoot = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'graph');

  const indexHtmlUri = vscode.Uri.joinPath(mediaRoot, 'index.html');
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'main.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'styles.css'));
  const nonce = getNonce();

  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data:`,
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
    .replace(/{{BOOTSTRAP}}/g, `<script nonce="${nonce}">window.initial=${JSON.stringify(initial)};</script>`);

  return html;
}

export function openGraphWebview(ctx: vscode.ExtensionContext, index: IndexService) {
  const column = vscode.workspace.getConfiguration().get('km.twoPane', true)
    ? vscode.ViewColumn.Beside
    : vscode.ViewColumn.Active;

  const panel = vscode.window.createWebviewPanel('notesGraph', 'Notes Graph', column, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });

  const initialGraph = index.toGraph();

  renderGraphHtml(ctx, panel, { graph: initialGraph })
    .then(html => { panel.webview.html = html; });

  const sub = index.onIndexUpdated(() => {
    panel.webview.postMessage({ type: 'graph', data: index.toGraph() });
  });
  panel.onDidDispose(() => sub.dispose());

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (!msg || typeof msg !== 'object') { return; }

    if (msg.type === 'open' && typeof msg.key === 'string' && !msg.key.startsWith('tag:')) {
      const uri = vscode.Uri.parse(msg.key);
      vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.One });
    }

    if (msg.type === 'toggleTag' && typeof msg.tag === 'string') {
      (index as any).toggleTagFilter(msg.tag);
    }
  });
}
