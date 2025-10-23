import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
    try {
        const extensionDevelopmentPath = path.resolve(__dirname, '../../');
        const extensionTestsPath = path.resolve(__dirname, './suite');
        const testWorkspace = path.resolve(__dirname, './fixtures');

        process.env.VSCODE_TEST_WORKSPACE = testWorkspace;

        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [
                testWorkspace,
                '--disable-extensions',
                '--user-data-dir=' + path.resolve(__dirname, '.user-data'),
                '--extensions-dir=' + path.resolve(__dirname, '.exts'),
            ],
        });
    } catch (err) {
        console.error('Failed to run tests', err);
        process.exit(1);
    }
}

main();
