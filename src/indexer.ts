import * as vscode from 'vscode';
import matter from 'gray-matter';
import * as path from 'path';

export type Tag = string;

export interface FileEntry {
  uri: vscode.Uri;
  tags: Tag[];
}

function resolveBaseUri(): vscode.Uri {
  const ws = vscode.workspace.workspaceFolders?.[0];
  if (ws) { return ws.uri; }

  const env = process.env.VSCODE_TEST_WORKSPACE;
  if (env) { return vscode.Uri.file(env); }

  return vscode.Uri.file(path.resolve(process.cwd()));
}

export class IndexService {
  private files: Map<string, FileEntry> = new Map();
  private tagToFiles: Map<Tag, Set<string>> = new Map();
  private activeFilter: Set<Tag> = new Set();
  private maxNodes = vscode.workspace.getConfiguration().get<number>('km.graph.maxNodes', 500);
  private _onIndexUpdated = new vscode.EventEmitter<void>();
  public readonly onIndexUpdated = this._onIndexUpdated.event;

  private getBaseUri(): vscode.Uri {
    return resolveBaseUri();
  }

  private fileKey(uri: vscode.Uri): string {
    return uri.toString();
  }

  private linkFileToTags(key: string, tags: Tag[]) {
    for (const t of tags) {
      if (!this.tagToFiles.has(t)) { this.tagToFiles.set(t, new Set()); }
      this.tagToFiles.get(t)!.add(key);
    }
  }

  private unlinkFileFromTags(key: string, tags: Tag[]) {
    for (const t of tags) {
      const set = this.tagToFiles.get(t);
      if (!set) { continue; }
      set.delete(key);
      if (set.size === 0) { this.tagToFiles.delete(t); }
    }
  }

  async buildIndex() {
    this.files.clear();
    this.tagToFiles.clear();

    const baseUri = this.getBaseUri();
    if (!baseUri) { return; }
    const pattern = new vscode.RelativePattern(baseUri, '**/*.md');
    const mdFiles = await vscode.workspace.findFiles(pattern);

    for (const uri of mdFiles) {
      await this.indexFile(uri);
    }
    this._onIndexUpdated.fire();
  }

  async updateFile(uri: vscode.Uri) {
    await this.indexFile(uri, true);
    this._onIndexUpdated.fire();
  }

  async removeFile(uri: vscode.Uri) {
    const key = this.fileKey(uri);
    const prev = this.files.get(key);
    if (!prev) {
      this._onIndexUpdated.fire();
      return;
    }
    this.unlinkFileFromTags(key, prev.tags);
    this.files.delete(key);
    this._onIndexUpdated.fire();
  }

  private async indexFile(uri: vscode.Uri, replace = false) {
    try {
      const buf = await vscode.workspace.fs.readFile(uri);
      const text = Buffer.from(buf).toString('utf-8');
      const fm = matter(text);

      const tags: Tag[] = Array.isArray(fm.data?.tags) ? fm.data.tags.map(String) : [];
      const key = this.fileKey(uri);

      if (replace) {
        const prev = this.files.get(key);
        if (prev) { this.unlinkFileFromTags(key, prev.tags); }
      }

      this.files.set(key, { uri, tags });
      this.linkFileToTags(key, tags);
    } catch (e) {
      console.error('Index error', e);
    }
  }

  getAllTags(): Tag[] {
    return [...this.tagToFiles.keys()].sort();
  }

  getActiveFilter(): Tag[] {
    return [...this.activeFilter];
  }

  getFilteredFiles(): FileEntry[] {
    if (this.activeFilter.size === 0) { return [...this.files.values()]; }
    const required = [...this.activeFilter];
    return [...this.files.values()].filter(f => required.every(t => f.tags.includes(t)));
  }

  toggleTagFilter(tag: Tag) {
    if (this.activeFilter.has(tag)) { this.activeFilter.delete(tag); }
    else { this.activeFilter.add(tag); }
    this._onIndexUpdated.fire();
  }

  clearFilter() {
    this.activeFilter.clear();
    this._onIndexUpdated.fire();
  }

  getCoOccurrence(): Array<[Tag, Tag, number]> {
    const counts = new Map<string, number>();
    for (const f of this.getFilteredFiles()) {
      const ts = [...new Set(f.tags)].sort();
      for (let i = 0; i < ts.length; i++) {
        for (let j = i + 1; j < ts.length; j++) {
          const key = ts[i] + '\u0000' + ts[j];
          counts.set(key, (counts.get(key) || 0) + 1);
        }
      }
    }
    return [...counts.entries()].map(([k, w]) => {
      const [a, b] = k.split('\u0000');
      return [a, b, w];
    });
  }

  toGraph() {
    const TAG_PREFIX = 'tag:';
    const filteredFiles = this.getFilteredFiles();
    const nodes: any[] = [];
    const links: any[] = [];

    const nodeId = new Map<string, number>();
    let nextId = 0;
    const pushNode = (id: string, label: string, kind: 'file' | 'tag') => {
      if (nodeId.has(id) || nodes.length >= this.maxNodes) { return; }
      nodeId.set(id, nextId++);
      nodes.push({ id: nodeId.get(id), key: id, label, kind });
    };

    for (const f of filteredFiles) {
      pushNode(f.uri.toString(), this.basename(f.uri), 'file');
      for (const t of f.tags) {
        const tid = TAG_PREFIX + t;
        pushNode(tid, t, 'tag');
        links.push({
          source: nodeId.get(f.uri.toString()),
          target: nodeId.get(tid),
          kind: 'file-tag'
        });
      }
    }

    for (const [a, b, w] of this.getCoOccurrence()) {
      const aid = TAG_PREFIX + a;
      const bid = TAG_PREFIX + b;
      pushNode(aid, a, 'tag');
      pushNode(bid, b, 'tag');
      links.push({ source: nodeId.get(aid), target: nodeId.get(bid), kind: 'tag-tag', weight: w });
    }

    return { nodes, links };
  }

  private basename(uri: vscode.Uri) {
    return uri.path.split('/').pop() || uri.path;
  }
}
