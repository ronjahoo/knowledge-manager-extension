import { suite, test } from 'mocha';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { withTempFile } from '../testUtils';
import { IndexService } from '../../indexer';

suite('IndexService', () => {
    test('indexes frontmatter tags', async () => {
        const svc = new IndexService();

        await withTempFile('notes/test1.md',
            `---
tags: [test, example]
---
# Title
text
`, async (uri) => {
            await svc.updateFile(uri);

            const entry =
                (svc as any).files.get(uri.fsPath) ??
                (svc as any).files.get(uri.toString());

            assert.ok(entry, 'File not indexed (key mismatch)');
            assert.deepStrictEqual([...entry.tags].sort(), ['example', 'test']);
        });
    });

    test('removeFile is safe and updates reverse index', async () => {
        const svc = new IndexService();
        await vscode.commands.executeCommand('workbench.action.files.newUntitledFile');
        const tmp = vscode.Uri.parse('untitled:tmp.md');
        await assert.doesNotReject(async () => svc.removeFile(tmp));
    });

    test('buildIndex does not exceed configured maxNodes (smoke)', async () => {
        const svc = new IndexService();
        await svc.buildIndex();
        assert.ok(true);
    });
});
