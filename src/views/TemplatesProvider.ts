import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';

export type TemplateEntry = {
  uri: vscode.Uri;
  name: string;
};

export class TemplatesProvider implements vscode.TreeDataProvider<TemplateLeaf> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TemplateLeaf): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<TemplateLeaf[]> {
    try {
      const dir = await this.ensureFolder();
      const files = await fs.readdir(dir.fsPath).catch(() => []);
      return files
        .filter(f => !f.startsWith('.'))
        .map(f => new TemplateLeaf({ uri: vscode.Uri.joinPath(dir, f), name: f }));
    } catch {
      return [];
    }
  }

  async ensureFolder(): Promise<vscode.Uri> {
    const folder = vscode.workspace
      .getConfiguration()
      .get<string>('km.templates.workspaceFolder', 'templates');
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) {
      return vscode.Uri.file('');
    }
    const target = root.with({
      path: path.posix.join(root.path, folder.replace(/\\/g, '/')),
    });
    await vscode.workspace.fs.createDirectory(target);
    return target;
  }
}

class TemplateLeaf extends vscode.TreeItem {
  constructor(public readonly entry: TemplateEntry) {
    super(entry.name, vscode.TreeItemCollapsibleState.None);
    this.resourceUri = entry.uri;
    this.contextValue = 'template';
    this.command = {
      command: 'vscode.open',
      title: 'Open Template',
      arguments: [entry.uri],
    };
  }
}
