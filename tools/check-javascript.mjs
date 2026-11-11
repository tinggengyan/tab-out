import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : /\.(?:js|mjs)$/.test(path) ? [path] : [];
  });
}
const sources = ['extension', 'server', 'tools'].flatMap(files).sort();
for (const source of sources) {
  const result = spawnSync(process.execPath, ['--check', source], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(source + '\n' + (result.stderr || result.error?.message || 'Syntax check failed') + '\n');
    process.exit(1);
  }
}
console.log(`PASS syntax: ${sources.length} JavaScript modules`);
