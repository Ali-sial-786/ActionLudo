// Builds the game as one self-contained HTML page for publishing as a claude.ai Artifact:
// the JS and CSS are inlined (Artifact pages only load scripts from a few CDNs), the service
// worker and install-app tags are left out (Artifact pages can't use them), and the page is
// written without <html>/<head>/<body>, which the Artifact host adds itself.
//   node scripts/build-artifact.mjs [out.html]      (default: dist-artifact/action-ludo.html)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.resolve(process.argv[2] ?? path.join(root, 'dist-artifact/action-ludo.html'));
const build = path.join(root, 'dist-artifact/build');

execFileSync('npx', ['vite', 'build', '--outDir', build, '--emptyOutDir'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, VITE_ARTIFACT: '1' },
});

const html = fs.readFileSync(path.join(build, 'index.html'), 'utf8');
const assets = path.join(build, 'assets');
const js = fs.readdirSync(assets).filter((f) => f.endsWith('.js'));
const css = fs.readdirSync(assets).filter((f) => f.endsWith('.css'));
if (js.length !== 1 || css.length !== 1) throw new Error(`expected one JS and one CSS bundle, got ${js} / ${css}`);

// Inline code must not close its own <script> or open an HTML comment early.
const script = fs
  .readFileSync(path.join(assets, js[0]), 'utf8')
  .replace(/<\/script/gi, '<\\/script')
  .replace(/<!--/g, '<\\!--');
const style = fs.readFileSync(path.join(assets, css[0]), 'utf8').replace(/<\/style/gi, '<\\/style');

const fonts = html.match(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>/)?.[0] ?? '';
const body = html
  .slice(html.indexOf('<body>') + '<body>'.length, html.lastIndexOf('</body>'))
  .trim();

const page = `<title>Action Ludo</title>
<meta name="theme-color" content="#0b0d14" />
<meta name="description" content="3D Ludo where every capture is a head-to-head animal clash. Brutal in Action mode, cute and bloodless in Kids mode." />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
${fonts}
<style>
${style}
</style>
${body}
<script type="module">
${script}
</script>
`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log(`wrote ${path.relative(process.cwd(), out)} (${(page.length / 1024).toFixed(0)} KB)`);
