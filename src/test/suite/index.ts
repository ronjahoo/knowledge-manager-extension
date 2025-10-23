import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';

export async function run(): Promise<void> {
    const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 10000 });
    const testsRoot = __dirname;

    const files = glob.sync('**/*.test.js', { cwd: testsRoot });

    for (const f of files) {
        mocha.addFile(path.resolve(testsRoot, f));
    }

    await new Promise<void>((resolve, reject) => {
        try {
            mocha.run((failures) => {
                if (failures && failures > 0) {
                    reject(new Error(`${failures} tests failed.`));
                } else {
                    resolve();
                }
            });
        } catch (e) {
            reject(e);
        }
    });
}
