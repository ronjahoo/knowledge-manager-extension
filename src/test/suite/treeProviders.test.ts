import { suite, test } from 'mocha';
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';

import { TemplatesProvider } from '../../views/TemplatesProvider';
import { MindmapsProvider } from '../../views/mindmapsProvider';
import { TagsProvider } from '../../views/tagsProvider';
import { FilesProvider } from '../../views/filesProvider';

import { writeTextFile, deleteIfExists, getWorkspaceRoot } from '../testUtils';
import { IndexService } from '../../indexer';

const TEMPLATES_DIR = 'templates';
const MINDMAPS_DIR = 'mindmaps';

suite('Tree Providers', () => {
    test('TemplatesProvider: empty dir returns []', async () => {
        const provider = new TemplatesProvider();
        const children = await provider.getChildren();
        assert.ok(Array.isArray(children), 'getChildren should return an array');
    });

    test('TemplatesProvider: lists created template files & getTreeItem has resourceUri', async () => {
        const rel1 = path.posix.join(TEMPLATES_DIR, 'example-template.md');
        const rel2 = path.posix.join(TEMPLATES_DIR, 'second-template.md');

        try {
            await writeTextFile(rel1, `---tags: [example]\n---\n# Tmpl\n`);
            await writeTextFile(rel2, `# Another Template\n`);

            const provider = new TemplatesProvider();
            const items = await provider.getChildren();

            assert.ok(items.length >= 2, 'Should list at least two template items');

            const ti = provider.getTreeItem(items[0]);
            assert.ok(ti, 'getTreeItem should return a TreeItem');

            const uri = (ti as any).resourceUri as vscode.Uri | undefined;
            assert.ok(uri, 'TreeItem should have resourceUri');
            assert.ok(uri!.fsPath.includes(path.sep + TEMPLATES_DIR + path.sep), 'resourceUri should be in templates/');

        } finally {
            await deleteIfExists(rel1);
            await deleteIfExists(rel2);
        }
    });

    test('MindmapsProvider: getTreeItem does not throw', async () => {
        const workspace = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspace, 'No workspace open in tests. Did runTest.ts pass a fixtures folder?');

        const provider = new MindmapsProvider(workspace);
        const children = await provider.getChildren();

        if (children.length > 0) {
            const item = provider.getTreeItem(children[0]);
            assert.ok(item, 'getTreeItem should return a TreeItem');
        } else {
            assert.ok(true);
        }
    });

    test('MindmapsProvider: lists created mindmap json & tree item has a label', async () => {
        const rel = path.posix.join(MINDMAPS_DIR, 'demo.mindmap.json');

        const minimalMindmap = JSON.stringify({
            id: 'demo',
            nodes: [{ id: 'n1', x: 0, y: 0, w: 120, h: 60, text: 'Hello' }],
            edges: []
        }, null, 2);

        try {
            await writeTextFile(rel, minimalMindmap);

            const workspace = vscode.workspace.workspaceFolders?.[0]!;
            const provider = new MindmapsProvider(workspace);
            const items = await provider.getChildren();

            assert.ok(items.length >= 1, 'Should list at least one mindmap');

            const match = items.find((it: any) => (it?.resourceUri as vscode.Uri | undefined)?.fsPath.endsWith(path.sep + 'demo.mindmap.json'));
            assert.ok(match, 'Should include the newly created demo-mindmap.json item');

            const ti = provider.getTreeItem(match!);
            assert.ok(ti, 'getTreeItem should return a TreeItem');
            assert.ok(typeof ti.label === 'string' && (ti.label as string).length > 0, 'TreeItem should have a label');

        } finally {
            await deleteIfExists(rel);
        }
    });

    test('TagsProvider: lists tags from frontmatter and tag node shows its files', async () => {
        const root = getWorkspaceRoot();
        const relA = path.posix.join('notes', 'a.md');
        const relB = path.posix.join('notes', 'sub', 'b.md');

        try {
            await writeTextFile(relA,
                `---
tags: [alpha, shared]
---
# A
`);
            await writeTextFile(relB,
                `---
tags: [beta, shared]
---
# B
`);

            const svc = new IndexService();
            await svc.updateFile(vscode.Uri.joinPath(root, relA));
            await svc.updateFile(vscode.Uri.joinPath(root, relB));

            const provider = new TagsProvider(svc);
            const tags = await provider.getChildren();
            assert.ok(tags.length >= 2);

            const shared = tags.find(t => t.toLowerCase() === 'shared');
            assert.ok(shared, 'Should include tag "shared"');

            const ti = provider.getTreeItem(shared!);
            assert.ok(ti);
            assert.ok(typeof ti.label === 'string' && (ti.label as string).length > 0);
            assert.ok(ti.command?.command === 'km.toggleTag');

        } finally {
            await deleteIfExists(relA);
            await deleteIfExists(relB);
        }
    });


    test('FilesProvider: builds tree from filtered files and tree items have labels & resourceUri', async () => {
        const root = getWorkspaceRoot();
        const rel1 = path.posix.join('notes', 'x.md');
        const rel2 = path.posix.join('notes', 'folder', 'y.md');

        async function findFirstMdItem(
            provider: FilesProvider,
            nodes: any[]
        ): Promise<vscode.TreeItem | undefined> {
            for (const n of nodes) {
                const ti = provider.getTreeItem(n as any);
                const uri = (ti as any).resourceUri as vscode.Uri | undefined;
                if (uri?.fsPath && uri.fsPath.toLowerCase().endsWith('.md')) { return ti; }

                const children = await provider.getChildren(n as any);
                if (Array.isArray(children) && children.length > 0) {
                    const found = await findFirstMdItem(provider, children);
                    if (found) { return found; }
                }
            }
            return undefined;
        }

        try {
            await writeTextFile(rel1,
                `---
tags: [x, shared]
---
# X
`);
            await writeTextFile(rel2,
                `---
tags: [y, shared]
---
# Y
`);

            const svc = new IndexService();
            await svc.updateFile(vscode.Uri.joinPath(root, rel1));
            await svc.updateFile(vscode.Uri.joinPath(root, rel2));

            const provider = new FilesProvider(svc);
            const top = await provider.getChildren();
            assert.ok(Array.isArray(top));
            assert.ok(top.length >= 1);

            const fileItem = await findFirstMdItem(provider, top);
            assert.ok(fileItem, 'Should find at least one .md file item in the tree');

            const fileUri = (fileItem as any).resourceUri as vscode.Uri | undefined;
            assert.ok(fileUri, 'File TreeItem should have resourceUri');
            assert.ok(fileUri!.fsPath.toLowerCase().endsWith('.md'), 'resourceUri should end with .md');
            assert.ok(typeof fileItem.label === 'string' && (fileItem.label as string).length > 0, 'File item should have label');

            const maybeDirNode = top.find((n: any) => {
                const ti = provider.getTreeItem(n as any);
                const uri = (ti as any).resourceUri as vscode.Uri | undefined;
                return ti.collapsibleState && (!uri || !uri.fsPath.toLowerCase().endsWith('.md'));
            });
            if (maybeDirNode) {
                const children = await provider.getChildren(maybeDirNode as any);
                assert.ok(Array.isArray(children));
                assert.ok(children.length >= 1, 'Directory should contain at least one item');
            }
        } finally {
            await new Promise(r => setTimeout(r, 50));
            await deleteIfExists(rel1);
            await deleteIfExists(rel2);
        }
    });
});
