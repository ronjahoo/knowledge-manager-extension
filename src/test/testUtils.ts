import * as vscode from 'vscode';
import * as path from 'path';

export function getWorkspaceRoot(): vscode.Uri {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (ws) { return ws.uri; }

    const fallbackFsPath =
        process.env.VSCODE_TEST_WORKSPACE ??
        path.resolve(__dirname, './fixtures');

    const uri = vscode.Uri.file(fallbackFsPath);
    vscode.workspace.updateWorkspaceFolders(0, 0, { uri, name: 'fixtures' });

    const ws2 = vscode.workspace.workspaceFolders?.[0];
    if (!ws2) {
        throw new Error('No workspace folder open for tests. Check runTest.ts launchArgs.');
    }
    return ws2.uri;
}

export async function writeTextFile(relPath: string, content: string): Promise<vscode.Uri> {
    const root = getWorkspaceRoot();
    const uri = vscode.Uri.joinPath(root, relPath);

    const dirRel = path.posix.dirname(relPath.replace(/\\/g, '/'));
    if (dirRel && dirRel !== '.') {
        const dirUri = vscode.Uri.joinPath(root, dirRel);
        await vscode.workspace.fs.createDirectory(dirUri);
    }

    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));

    await vscode.workspace.fs.stat(uri);

    return uri;
}

export async function deleteIfExists(relPath: string): Promise<void> {
    const root = getWorkspaceRoot();
    const uri = vscode.Uri.joinPath(root, relPath);
    try {
        await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: false });
    } catch { /* ignore */ }
}

export async function withTempFile<T>(
    relPath: string,
    content: string,
    fn: (uri: vscode.Uri) => Promise<T>
): Promise<T> {
    const uri = await writeTextFile(relPath, content);
    try {
        return await fn(uri);
    } finally {
        await deleteIfExists(relPath);
    }
}
