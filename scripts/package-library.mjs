// Rebuild web/library.json (the starter library bundled with the app) from the sibling
// Cheklst-Checklists folder. The app uses it only until it can reach your GitHub library.
import {execFileSync} from 'node:child_process';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const source=path.resolve(process.argv[2]||path.join(root,'../Cheklst-Checklists'));
execFileSync(process.execPath,[path.join(source,'.cheklst/build.mjs'),path.join(root,'web/library.json'),source],{stdio:'inherit'});
