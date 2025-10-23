import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { IndexService } from './indexer';
import { TagsProvider } from './views/tagsProvider';
import { FilesProvider } from './views/filesProvider';
import { MindmapsProvider } from './views/mindmapsProvider';
import { TemplatesProvider } from './views/TemplatesProvider';
import { openGraphWebview } from './webviews/graphWebview';
import { openMindmapWebview } from './webviews/mindmapWebview';

let indexService: IndexService;

type TemplateEntry = { uri: vscode.Uri; name: string };

export async function activate(ctx: vscode.ExtensionContext) {
  indexService = new IndexService();
  await indexService.buildIndex();

  const tagsProvider = new TagsProvider(indexService);
  const filesProvider = new FilesProvider(indexService);
  const mindmapsProvider = new MindmapsProvider(vscode.workspace.workspaceFolders?.[0]);
  const templatesProvider = new TemplatesProvider();

  vscode.window.createTreeView('km.tagsView', { treeDataProvider: tagsProvider });
  vscode.window.createTreeView('km.filesView', { treeDataProvider: filesProvider });
  vscode.window.createTreeView('km.mindmapsView', { treeDataProvider: mindmapsProvider });
  vscode.window.createTreeView('km.templatesView', { treeDataProvider: templatesProvider });

  tagsProvider.refresh();
  filesProvider.refresh();
  mindmapsProvider.refresh();
  templatesProvider.refresh();

  const idxSub = indexService.onIndexUpdated(() => {
    tagsProvider.refresh();
    filesProvider.refresh();
  });
  ctx.subscriptions.push(idxSub);

  const watcher = vscode.workspace.createFileSystemWatcher('**/*.md');
  watcher.onDidCreate(async (uri) => await indexService.updateFile(uri));
  watcher.onDidChange(async (uri) => await indexService.updateFile(uri));
  watcher.onDidDelete(async (uri) => await indexService.removeFile(uri));
  ctx.subscriptions.push(watcher);

  ctx.subscriptions.push(
    vscode.workspace.onDidRenameFiles(async (e) => {
      for (const f of e.files) {
        await indexService.removeFile(f.oldUri);
        await indexService.updateFile(f.newUri);
      }
    })
  );

  ctx.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      if (doc.uri.scheme === 'file' && doc.fileName.endsWith('.md')) {
        await indexService.updateFile(doc.uri);
      }
    })
  );

  ctx.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async () => await indexService.buildIndex())
  );

  function toTemplateEntry(arg: unknown): TemplateEntry | undefined {
    if (!arg) { return undefined; }
    const anyArg = arg as any;
    if (anyArg.uri instanceof vscode.Uri && typeof anyArg.name === 'string') { return anyArg as TemplateEntry; }
    if (anyArg.resourceUri instanceof vscode.Uri) {
      const uri: vscode.Uri = anyArg.resourceUri;
      return { uri, name: path.basename(uri.fsPath) };
    }
    if (arg instanceof vscode.Uri) { return { uri: arg, name: path.basename(arg.fsPath) }; }
    return undefined;
  }

  function getUriFromArg(arg?: unknown): vscode.Uri | undefined {
    if (!arg) { return undefined; }
    const a: any = arg;

    if (a?.type === 'file' && a.entry?.uri) { return a.entry.uri as vscode.Uri; }
    if (a?.type === 'dir' && a.uri) { return a.uri as vscode.Uri; }

    if (a?.type === 'mindmap' && a.uri) { return a.uri as vscode.Uri; }
    if (a?.contextValue === 'mindmapItem' && a.uri) { return a.uri as vscode.Uri; }

    if (a?.resourceUri instanceof vscode.Uri) { return a.resourceUri as vscode.Uri; }
    if (a?.uri instanceof vscode.Uri) { return a.uri as vscode.Uri; }
    if (a instanceof vscode.Uri) { return a as vscode.Uri; }

    return undefined;
  }

  async function confirmDelete(kind: 'file' | 'folder', uri: vscode.Uri) {
    const rel = vscode.workspace.asRelativePath(uri, false);
    const ok = await vscode.window.showWarningMessage(
      `Delete ${kind} "${rel}"?`,
      { modal: true },
      'Delete'
    );
    return ok === 'Delete';
  }

  async function confirmDeleteWithString(label: string) {
    const ok = await vscode.window.showWarningMessage(
      `Delete ${label}?`,
      { modal: true },
      'Delete'
    );
    return ok === 'Delete';
  }

  ctx.subscriptions.push(
    vscode.commands.registerCommand('km.openGraph', () =>
      openGraphWebview(ctx, indexService)
    ),
    vscode.commands.registerCommand('km.openMindmap', (uri?: vscode.Uri) => {
      if (uri) { openMindmapWebview(ctx, uri); }
      else { return pickAndOpenMindmap(); }
    }),
    vscode.commands.registerCommand('km.openMindmapQuickPick', () => pickAndOpenMindmap()),
    vscode.commands.registerCommand('km.newMindmap', () => openMindmapWebview(ctx)),
    vscode.commands.registerCommand('km.toggleTag', async (tag: string) => {
      indexService.toggleTagFilter(tag);
      tagsProvider.refresh();
      filesProvider.refresh();
    }),
    vscode.commands.registerCommand('km.clearFilter', () => {
      indexService.clearFilter();
      tagsProvider.refresh();
      filesProvider.refresh();
    }),
    vscode.commands.registerCommand('km.refreshMindmaps', () => {
      mindmapsProvider.refresh();
      vscode.window.showInformationMessage('Mindmaps list refreshed.');
    }),
    vscode.commands.registerCommand('km.deleteMindmap', async (arg?: unknown) => {
      const uri = getUriFromArg(arg);
      if (!uri) { return; }

      const rel = vscode.workspace.asRelativePath(uri, false);
      if (!(await confirmDeleteWithString(`mindmap "${rel}"`))) { return; }

      await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: true });
      mindmapsProvider.refresh();
    }),
    vscode.commands.registerCommand('km.addFile', async () => {
      const root = await getWorkspaceRoot();
      if (!root) { return; }

      const rel = await vscode.window.showInputBox({
        prompt: 'New file path (relative to workspace)',
        value: 'notes/new-note.md'
      });
      if (!rel) { return; }

      const relPosix = toPosixRelative(rel);
      const target = root.with({ path: path.posix.join(root.path, relPosix) });

      await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(target.fsPath)));
      await vscode.workspace.fs.writeFile(target, Buffer.from('', 'utf8'));

      await indexService.updateFile(target);
      filesProvider.refresh();
      tagsProvider.refresh();
      vscode.window.showTextDocument(target);
    }),

    vscode.commands.registerCommand('km.addFolder', async () => {
      const root = await getWorkspaceRoot();
      if (!root) { return; }

      const rel = await vscode.window.showInputBox({
        prompt: 'New folder path (relative to workspace)',
        value: 'notes/new-folder'
      });
      if (!rel) { return; }

      const relPosix = toPosixRelative(rel);
      const targetDir = root.with({ path: path.posix.join(root.path, relPosix) });

      await vscode.workspace.fs.createDirectory(targetDir);

      await indexService.buildIndex();
      filesProvider.refresh();
      tagsProvider.refresh();

      vscode.window.showInformationMessage(`Folder created: ${vscode.workspace.asRelativePath(targetDir, false)}`);
    }),
    vscode.commands.registerCommand('km.refreshFiles', async () => {
      await indexService.buildIndex();
      filesProvider.refresh();
      tagsProvider.refresh();
      vscode.window.showInformationMessage('Files list refreshed.');
    }),
    vscode.commands.registerCommand('km.deleteFile', async (arg?: unknown) => {
      const uri = getUriFromArg(arg);
      if (!uri) { return; }

      const rel = vscode.workspace.asRelativePath(uri, false);
      const ok = await vscode.window.showWarningMessage(
        `Delete file "${rel}"?`,
        { modal: true },
        'Delete'
      );
      if (ok !== 'Delete') { return; }

      await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: true });
      await indexService.removeFile(uri);
      filesProvider.refresh();
      tagsProvider.refresh();
    }),
    vscode.commands.registerCommand('km.deleteFolder', async (arg?: unknown) => {
      const uri = getUriFromArg(arg);
      if (!uri) { return; }

      if (!(await confirmDelete('folder', uri))) { return; }

      await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: true });

      await indexService.buildIndex();
      filesProvider.refresh();
      tagsProvider.refresh();
    }),

    vscode.commands.registerCommand('km.refreshTemplates', () => {
      templatesProvider.refresh();
      vscode.window.showInformationMessage('Templates list refreshed.');
    }),
    vscode.commands.registerCommand('km.newEmptyTemplate', async () => {
      const dir = await templatesProvider.ensureFolder();
      const name = await vscode.window.showInputBox({ prompt: 'Template file name', value: 'template.md' });
      if (!name) { return; }
      const target = vscode.Uri.joinPath(dir, name);
      await vscode.workspace.fs.writeFile(target, Buffer.from('# New Template\n', 'utf8'));
      templatesProvider.refresh();
      vscode.window.showTextDocument(target);
    }),
    vscode.commands.registerCommand('km.saveActiveAsTemplate', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }
      const dir = await templatesProvider.ensureFolder();
      const name = await vscode.window.showInputBox({
        prompt: 'Save as template name',
        value: path.basename(editor.document.fileName)
      });
      if (!name) { return; }
      const target = vscode.Uri.joinPath(dir, name);
      await vscode.workspace.fs.writeFile(target, Buffer.from(editor.document.getText(), 'utf8'));
      templatesProvider.refresh();
    }),
    vscode.commands.registerCommand('km.newFromTemplate', async (arg?: unknown) => {
      const chosen = toTemplateEntry(arg) ?? await pickTemplate(templatesProvider);
      if (!chosen) { return; }
      const bytes = await vscode.workspace.fs.readFile(chosen.uri);
      const raw = new TextDecoder('utf-8').decode(bytes);
      const content = await resolvePlaceholders(raw);
      const dest = await vscode.window.showInputBox({
        prompt: 'New file path (relative to workspace)',
        value: suggestName(chosen.name),
      });
      if (!dest) { return; }
      const root = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!root) { return; }
      const target = root.with({ path: path.posix.join(root.path, dest.replace(/\\/g, '/')) });
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(target.fsPath)));
      await vscode.workspace.fs.writeFile(target, Buffer.from(content, 'utf8'));
      vscode.window.showTextDocument(target);
    }),
    vscode.commands.registerCommand('km.rename', async (arg?: unknown) => {
      const entry = toTemplateEntry(arg);
      if (!entry) { return; }
      const newName = await vscode.window.showInputBox({ prompt: 'New name', value: entry.name });
      if (!newName) { return; }
      const newUri = vscode.Uri.joinPath(vscode.Uri.file(path.dirname(entry.uri.fsPath)), newName);
      await vscode.workspace.fs.rename(entry.uri, newUri, { overwrite: false });
      templatesProvider.refresh();
    }),
    vscode.commands.registerCommand('km.deleteTemplate', async (arg?: unknown) => {
      const entry = toTemplateEntry(arg);
      if (!entry) { return; }
      const ok = await vscode.window.showWarningMessage(
        `Delete template "${entry.name}"?`,
        { modal: true },
        'Delete'
      );
      if (ok === 'Delete') {
        await vscode.workspace.fs.delete(entry.uri, { recursive: false, useTrash: true });
        templatesProvider.refresh();
      }
    })
  );

  async function pickAndOpenMindmap() {
    const files = await vscode.workspace.findFiles('**/*.mindmap.json');
    if (!files.length) {
      vscode.window.showInformationMessage('No mindmaps found (*.mindmap.json).');
      return;
    }
    const picked = await vscode.window.showQuickPick(
      files.map(f => ({ label: vscode.workspace.asRelativePath(f, false), description: f.fsPath, uri: f })),
      { placeHolder: 'Open mindmap…' }
    );
    if (picked?.uri) { openMindmapWebview(ctx, picked.uri); }
  }

  async function pickTemplate(provider: TemplatesProvider): Promise<TemplateEntry | undefined> {
    const dir = await provider.ensureFolder();
    const files = await fs.readdir(dir.fsPath).catch(() => []);
    if (!files.length) {
      vscode.window.showInformationMessage('No templates found.');
      return;
    }
    const qp = await vscode.window.showQuickPick(files, { placeHolder: 'Pick a template' });
    if (!qp) { return; }
    return { uri: vscode.Uri.joinPath(dir, qp), name: qp };
  }
}

function suggestName(templateName: string): string {
  const base = templateName.replace(/\.[^.]+$/, '');
  const date = new Date().toISOString().slice(0, 10);
  return `notes/${base}-${date}.md`;
}

async function resolvePlaceholders(text: string): Promise<string> {
  const now = new Date();
  const table: Record<string, string> = {
    DATE: now.toISOString().slice(0, 10),
    TIME: now.toTimeString().slice(0, 8),
    YEAR: String(now.getFullYear()),
    USER: process.env['USERNAME'] || process.env['USER'] || 'user'
  };

  const inputRegex = /\$\{INPUT:([^}]+)\}/g;
  text = await replaceAsync(text, inputRegex, async (_, prompt) =>
    (await vscode.window.showInputBox({ prompt })) || ''
  );

  const pickRegex = /\$\{PICK:([^}]+)\}/g;
  text = await replaceAsync(text, pickRegex, async (_: string, opts: string) => {
    const options = opts.split('|').map((o: string) => o.trim());
    const pick = await vscode.window.showQuickPick(options, { placeHolder: 'Pick a value' });
    return pick || '';
  });

  text = text.replace(/\$\{([A-Z]+)\}/g, (_, key) => table[key] ?? '');
  return text;
}

async function replaceAsync(str: string, regex: RegExp, asyncFn: (...args: any[]) => Promise<string>) {
  const promises: Promise<string>[] = [];
  str.replace(regex, (...args) => { promises.push(asyncFn(...args)); return ''; });
  const data = await Promise.all(promises);
  let i = 0;
  return str.replace(regex, () => data[i++]);
}

async function getWorkspaceRoot(): Promise<vscode.Uri | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showErrorMessage('No workspace folder open.');
    return undefined;
  }
  if (folders.length === 1) { return folders[0].uri; }
  const pick = await vscode.window.showQuickPick(
    folders.map(f => ({ label: f.name, uri: f.uri })),
    { placeHolder: 'Select workspace folder' }
  );
  return pick?.uri;
}

function toPosixRelative(input: string): string {
  return input.trim().replace(/^[\\/]+/, '').replace(/\\/g, '/');
}

export function deactivate() { }
