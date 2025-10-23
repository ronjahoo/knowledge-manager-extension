import * as vscode from 'vscode';
import * as path from 'path';

export class MindmapsProvider implements vscode.TreeDataProvider<MindmapItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private workspace: vscode.WorkspaceFolder | undefined) { }

  refresh() { this._onDidChangeTreeData.fire(); }

  async getChildren(): Promise<MindmapItem[]> {
    if (!this.workspace) { return []; }
    const files = await vscode.workspace.findFiles('**/*.mindmap.json');
    return files.map(uri => new MindmapItem(uri));
  }

  getTreeItem(el: MindmapItem) { return el; }
}

class MindmapItem extends vscode.TreeItem {
  constructor(public readonly uri: vscode.Uri) {
    super(path.basename(uri.fsPath), vscode.TreeItemCollapsibleState.None);
    this.resourceUri = uri;
    this.description = vscode.workspace.asRelativePath(uri, false);
    this.contextValue = 'mindmapItem';
    this.command = {
      command: 'km.openMindmap',
      title: 'Open Mindmap',
      arguments: [uri]
    };
    this.iconPath = new vscode.ThemeIcon('graph');
  }
}