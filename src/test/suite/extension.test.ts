import { describe, it } from 'mocha';
import * as assert from 'assert';
import * as vscode from 'vscode';

describe('Activation & Commands', () => {
    it('activates extension', async () => {
        const ext = vscode.extensions.getExtension('ronjalogia.knowledge-manager-extension');
        assert.ok(ext); await ext!.activate(); assert.ok(ext!.isActive);
    });

    it('commands are registered', async () => {
        const cmds = await vscode.commands.getCommands(true);
        for (const id of ['km.openGraph',
            'km.openMindmap',
            'km.openMindmapQuickPick',
            'km.newMindmap',
            'km.toggleTag',
            'km.clearFilter',
            'km.newFromTemplate',
            'km.saveActiveAsTemplate',
            'km.newEmptyTemplate',
            'km.deleteTemplate',
            'km.addFile',
            'km.addFolder',
            'km.refreshFiles',
            'km.deleteFile',
            'km.deleteFolder',
            'km.deleteMindmap',
            'km.rename',
            'km.refreshTemplates',
            'km.refreshMindmaps']) { assert.ok(cmds.includes(id)); }
    });
});
