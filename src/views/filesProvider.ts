import * as vscode from 'vscode';
import * as path from 'path';
import { IndexService, FileEntry } from '../indexer';

export interface DirNode {
  type: 'dir';
  name: string;
  uri: vscode.Uri;
  children: Map<string, TreeNode>;
}
export interface FileNode {
  type: 'file';
  entry: FileEntry;
}
type TreeNode = DirNode | FileNode;

function isDir(node: TreeNode): node is DirNode {
  return node.type === 'dir';
}

export class FilesProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private index: IndexService) {
    this.index.onIndexUpdated(() => this.refresh());
  }

  refresh() { this._onDidChangeTreeData.fire(); }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (isDir(node)) {
      const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.resourceUri = node.uri;
      item.contextValue = 'dir';
      item.description = `${node.children.size} items`;
      return item;
    }
    const f = node.entry;
    const label = path.basename(f.uri.fsPath);
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.command = { command: 'vscode.open', title: 'Open', arguments: [f.uri] };
    item.resourceUri = f.uri;
    item.contextValue = 'file';
    item.description = f.tags.join(', ');
    item.tooltip = vscode.workspace.asRelativePath(f.uri, false);
    return item;
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (!vscode.workspace.workspaceFolders?.length) { return []; }

    if (element && isDir(element)) {
      return [...element.children.values()].sort(sortNodes);
    }

    const root = this.buildTree(this.index.getFilteredFiles());
    return [...root.children.values()].sort(sortNodes);
  }

  private buildTree(files: FileEntry[]): DirNode {
    const wsRoot = vscode.workspace.workspaceFolders![0].uri;
    const baseSetting = vscode.workspace.getConfiguration('notes').get<string>('defaultNotesDir', '');
    const baseUri = baseSetting ? vscode.Uri.joinPath(wsRoot, baseSetting) : wsRoot;

    const root: DirNode = {
      type: 'dir',
      name: baseSetting ? stripTrailingSlash(baseSetting) : vscode.workspace.workspaceFolders![0].name,
      uri: baseUri,
      children: new Map<string, TreeNode>(),
    };

    for (const file of files) {
      const rel = this.safeRelative(baseUri, file.uri) ?? this.safeRelative(wsRoot, file.uri);
      if (!rel) { continue; }
      const parts = rel.split('/').filter(Boolean);
      this.insertPath(root, parts, file);
    }

    return root;
  }

  private insertPath(node: DirNode, parts: string[], file: FileEntry) {
    if (parts.length === 0) { return; }

    if (parts.length === 1) {
      node.children.set('⚙' + file.uri.toString(), { type: 'file', entry: file });
      return;
    }

    const [head, ...tail] = parts;
    const nextUri = vscode.Uri.joinPath(node.uri, head);
    let child = node.children.get(head);
    if (!child || !isDir(child)) {
      child = { type: 'dir', name: head, uri: nextUri, children: new Map<string, TreeNode>() };
      node.children.set(head, child);
    }
    this.insertPath(child as DirNode, tail, file);
  }

  private safeRelative(base: vscode.Uri, target: vscode.Uri): string | null {
    const b = base.fsPath.replace(/\\/g, '/').replace(/\/+$/, '');
    const t = target.fsPath.replace(/\\/g, '/');
    if (!t.startsWith(b + '/') && t !== b) { return null; }
    return t === b ? '' : t.slice(b.length + 1);
  }
}

function stripTrailingSlash(s: string) {
  return s.replace(/[\\/]+$/, '');
}

function sortNodes(a: TreeNode, b: TreeNode): number {
  if (a.type !== b.type) { return a.type === 'dir' ? -1 : 1; }
  const an = a.type === 'dir' ? a.name : path.basename(a.entry.uri.fsPath);
  const bn = b.type === 'dir' ? b.name : path.basename(b.entry.uri.fsPath);
  return an.localeCompare(bn, undefined, { sensitivity: 'base' });
}
