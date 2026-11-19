#!/usr/bin/env node
// Construiește o pagină autonomă (un singur fișier HTML, fără server):
//   node scripts/build.mjs                    -> dist/organism.html (se deschide direct în browser)
//   node scripts/build.mjs --fragment CALE    -> în plus, aceeași pagină fără schelet
//                                                html/head/body, pentru publicare
//
// Un mini-bundler pentru modulele ES ale proiectului: urmează importurile relative
// ({ a, b as c } from './x.js'), învelește fiecare modul într-o funcție și leagă
// exporturile. Proiectul folosește doar importuri și exporturi cu nume.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'src', 'ui', 'app.js');

const IMPORT_RE = /^import\s+\{([^}]*)\}\s+from\s+'(\.[^']+)';?[ \t]*$/gm;
const EXPORT_DECL_RE = /^export\s+(?:async\s+)?(function\s*\*?|class|const|let)\s+([A-Za-z_$][\w$]*)/gm;

function collect(file, seen = new Set(), order = []) {
  if (seen.has(file)) return order;
  seen.add(file);
  const source = readFileSync(file, 'utf8');
  if (/^\s*export\s+default\b/m.test(source) || /^\s*import\s+\*/m.test(source)) {
    throw new Error(`${relative(root, file)}: doar importuri/exporturi cu nume sunt acceptate`);
  }
  for (const m of source.matchAll(IMPORT_RE)) collect(resolve(dirname(file), m[2]), seen, order);
  order.push(file);
  return order;
}

function transform(file) {
  const id = relative(root, file);
  let code = readFileSync(file, 'utf8');
  code = code.replace(IMPORT_RE, (_, names, spec) => {
    const target = relative(root, resolve(dirname(file), spec));
    const bindings = names
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean)
      .map((n) => n.replace(/\s+as\s+/, ': '))
      .join(', ');
    return `const { ${bindings} } = __modules[${JSON.stringify(target)}];`;
  });
  const exported = [];
  code = code.replace(EXPORT_DECL_RE, (match, kind, name) => {
    exported.push(name);
    return match.replace(/^export\s+/, '');
  });
  if (/^export\s/m.test(code)) throw new Error(`${id}: formă de export nesuportată`);
  return `// ---- ${id}\n__modules[${JSON.stringify(id)}] = (() => {\n${code}\nreturn { ${exported.join(', ')} };\n})();\n`;
}

const modules = collect(entry);
const bundle = `(() => {\n'use strict';\nconst __modules = {};\n${modules.map(transform).join('\n')}\n})();\n`;

const html = readFileSync(join(root, 'index.html'), 'utf8');
const resultsPath = join(root, 'experiments', 'results', 'summary.json');
const precomputed = existsSync(resultsPath)
  ? `<script id="precomputed" type="application/json">${readFileSync(resultsPath, 'utf8').replace(/</g, '\\u003c')}</script>\n`
  : '';
const moduleTag = '<script type="module" src="./src/ui/app.js"></script>';
if (!html.includes(moduleTag)) throw new Error('index.html: nu găsesc scriptul modulului principal');
const inlineScript = `${precomputed}<script>\n${bundle.replace(/<\/script/gi, '<\\/script')}</script>`;
const standalone = html.replace(moduleTag, () => inlineScript);

// Varianta pentru publicare: fără doctype/html/head/body și fără meta charset/viewport.
const fragment = standalone
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<html[^>]*>\s*/i, '')
  .replace(/<\/html>\s*/i, '')
  .replace(/<head>\s*/i, '')
  .replace(/<\/head>\s*/i, '')
  .replace(/<body>\s*/i, '')
  .replace(/<\/body>\s*/i, '')
  .replace(/<meta charset="utf-8">\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '');

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'organism.html'), standalone);
const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} KB`;
console.log(`${modules.length} module · dist/organism.html ${kb(standalone)}`);
const fragmentAt = process.argv.indexOf('--fragment');
if (fragmentAt >= 0 && process.argv[fragmentAt + 1]) {
  const out = resolve(process.argv[fragmentAt + 1]);
  writeFileSync(out, fragment);
  console.log(`fragment ${out} ${kb(fragment)}`);
}
