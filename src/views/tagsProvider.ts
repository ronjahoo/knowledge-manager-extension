import * as vscode from 'vscode';
import { IndexService } from '../indexer';

export class TagsProvider implements vscode.TreeDataProvider<string> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private index: IndexService) { }

  refresh() { this._onDidChangeTreeData.fire(); }

  getTreeItem(tag: string): vscode.TreeItem {
    const active = this.index.getActiveFilter().includes(tag);
    const item = new vscode.TreeItem(active ? `● ${tag}` : tag);
    item.command = { command: 'km.toggleTag', title: 'Toggle', arguments: [tag] };
    item.contextValue = active ? 'tag-active' : 'tag';
    item.tooltip = active ? 'In AND-filter (click to remove)' : 'Click to add to AND-filter';
    item.collapsibleState = vscode.TreeItemCollapsibleState.None;
    return item;
  }

  async getChildren(): Promise<string[]> {
    const tags = await this.index.getAllTags();
    return [...tags];
  }
}
