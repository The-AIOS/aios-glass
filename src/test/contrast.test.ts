/**
 * Review 15 — Glass coral, measured from the CSS itself. The bright #ff5d4d under white text was
 * 3.03:1 on the light primary button (on the update path: it is the "Update" action), and as text
 * on paper 2.83:1. Both must clear WCAG AA 4.5:1 in both themes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.join(__dirname, '..', '..');
const css = (f: string) => fs.readFileSync(path.join(ROOT, 'media', f), 'utf8');

function block(src: string, sel: RegExp): Record<string, string> {
  const m = sel.exec(src);
  assert.ok(m, `block ${sel} not found`);
  const body = src.slice(m.index + m[0].length, src.indexOf('}', m.index));
  const out: Record<string, string> = {};
  for (const d of body.replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
    const i = d.indexOf(':');
    if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
  }
  return out;
}
function resolve(v: string, ...scopes: Record<string, string>[]): string {
  for (let n = 0; n < 5; n++) {
    const m = /^var\((--[\w-]+)\)$/.exec(v.trim());
    if (!m) return v.trim();
    const hit = scopes.find((s) => s[m[1]] !== undefined);
    assert.ok(hit, `unresolved ${m[1]}`);
    v = hit![m[1]];
  }
  return v;
}
const lum = (hex: string) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('the primary button (the Update action) passes 4.5:1 in both themes, at rest and on hover', () => {
  const s = css('home.css');
  const dark = block(s, /:root\s*\{/), light = { ...dark, ...block(s, /body\.light\s*\{/) };
  for (const [name, t] of [['dark', dark], ['light', light]] as const) {
    const fg = resolve('var(--on-accent)', t);
    for (const bg of ['var(--accent-fill)', 'var(--accent-fill-hover)']) {
      const r = ratio(fg, resolve(bg, t));
      assert.ok(r >= 4.5, `${name} ${bg}: ${r.toFixed(2)}:1`);
    }
  }
  assert.match(s, /\.btn\.primary\{background:var\(--accent-fill\)/, 'the button uses the fill token, not the bright accent');
});

test('coral TEXT ("update available", badges) passes 4.5:1 on every light surface', () => {
  for (const f of ['home.css', 'files.css']) {
    const s = css(f);
    const dark = block(s, /:root\s*\{/), light = { ...dark, ...block(s, /body\.light\s*\{/) };
    for (const surf of ['--canvas', '--surface-1', '--surface-2'].filter((k) => light[k])) {
      const r = ratio(resolve('var(--accent-ink)', light), light[surf]);
      assert.ok(r >= 4.5, `${f} light ink on ${surf}: ${r.toFixed(2)}:1`);
    }
    assert.doesNotMatch(s, /(?<![-\w])color:var\(--accent\)/, `${f}: coral text must use --accent-ink`);
  }
});
