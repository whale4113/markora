// Compatibility entry point. Test the production bridge and real Wordgard model.
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const cli=require.resolve('@playwright/test/cli');
const result=spawnSync(process.execPath,[cli,'test','bridge.spec.js'],{stdio:'inherit',cwd:new URL('..',import.meta.url)});
process.exit(result.status??1);
