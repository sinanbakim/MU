import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync('legacy/dist_single_file.html', 'utf8');
const scriptMatch = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!scriptMatch) {
  console.error('no script');
  process.exit(1);
}

const script = scriptMatch[1];
const re =
  /\/\/ STEUERUNG - START MODUL: ([^\n]+)\n([\s\S]*?)\/\/ STEUERUNG - ENDE MODUL: [^\n]+/g;
const modules = [];
let m;
while ((m = re.exec(script)) !== null) {
  modules.push({ name: m[1].trim(), code: m[2].trim() });
}

const outDir = 'src/client/visualizer/_extracted';
fs.mkdirSync(outDir, { recursive: true });

for (const mod of modules) {
  const fileName = mod.name.replace(/\.js$/, '.ts');
  fs.writeFileSync(path.join(outDir, fileName), mod.code + '\n');
  console.log('Wrote', fileName, mod.code.length);
}

const lastEnd = script.lastIndexOf('// STEUERUNG - ENDE MODUL: visualizer.js');
const tail = script.slice(lastEnd).replace(/^[\s\S]*?\/\/ STEUERUNG - ENDE MODUL: visualizer.js\s*/, '');
fs.writeFileSync(path.join(outDir, '_tail.ts'), tail.trim() + '\n');
console.log('Tail length', tail.length);
