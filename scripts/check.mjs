#!/usr/bin/env node
/**
 * Static and smoke checks for the generated bundle.
 *
 * The Client module is plain browser JavaScript, so a minimal DOM and React
 * stub is enough to execute the factory and the plugin apply function without
 * a browser.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (file) => readFileSync(join(root, file), 'utf8');

const pkg = JSON.parse(read('package.json'));
assert.equal(pkg.name, '@local/dsh-pipe-atlas');
assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
assert.equal(pkg.dsh.client.platform, 'web');
assert.ok(pkg.files.includes('client.js'));

const patch = read('cordis.patch.yml');
assert.match(patch, /id: dsh-pipe-atlas/);
assert.match(patch, /name: '@local\/dsh-pipe-atlas'/);

for (const locale of ['en', 'zh']) {
  const dictionary = JSON.parse(read(`locale/${locale}.json`));
  assert.ok(dictionary.meta.title, `${locale} meta.title`);
  assert.ok(dictionary.meta.description, `${locale} meta.description`);
  assert.ok(dictionary['panel.title'], `${locale} panel.title`);
}

const icon = read('icon.svg');
assert.match(icon, /^<svg[\s>]/);
assert.match(icon, /<\/svg>\s*$/);

const source = read('client.js');
assert.ok(!/^\s*import\s/m.test(source), 'client.js must not contain ESM imports');
assert.match(source, /window\.__ModuleLoader__\.load\(/);
assert.match(source, /customElements\.define\('pipe-timeline'/);
assert.match(source, /id: '@local\/dsh-pipe-atlas'/);

let registration = null;
const customElementsMap = new Map();
const sandbox = {
  console,
  window: {
    __ModuleLoader__: {
      load(entry) { registration = entry; },
    },
    setTimeout,
    clearTimeout,
  },
  document: {
    createElement: () => ({ setAttribute() {}, addEventListener() {}, removeEventListener() {}, remove() {} }),
    addEventListener() {},
    removeEventListener() {},
  },
  customElements: {
    get: (name) => customElementsMap.get(name),
    define: (name, ctor) => customElementsMap.set(name, ctor),
  },
  HTMLElement: class HTMLElement {},
  CustomEvent: class CustomEvent {},
  structuredClone,
  ResizeObserver: class ResizeObserver { observe() {} disconnect() {} },
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  URL,
  Intl,
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'client.js' });

assert.ok(registration, 'the client runner registration exists');
assert.equal(registration.id, '@local/dsh-pipe-atlas');
const React = {
  createElement: () => ({}),
  useEffect: () => {},
  useMemo: () => undefined,
  useRef: () => ({}),
  useState: () => [undefined, () => {}],
  useSyncExternalStore: () => 'light',
};
const api = registration.factory((name) => {
  if (name === 'react') return React;
  throw new Error(`unexpected require: ${name}`);
});
assert.equal(typeof api.apply, 'function');
assert.deepEqual([...api.inject].sort(), ['locale', 'slots']);
assert.ok(customElementsMap.has('pipe-timeline'), 'the Web Component is registered once');

const injections = [];
const ctx = {
  effect(callback) { const dispose = callback(); return typeof dispose === 'function' ? dispose : () => {}; },
  get() { return undefined; },
  on() { return () => {}; },
  locale: {
    register: () => () => {},
    bind: () => (key) => key,
  },
  slots: {
    inject(name, callback) { injections.push(name); callback(); return () => {}; },
    register(options) { return options; },
  },
};
api.apply(ctx);
assert.deepEqual(injections, ['main', 'sidebar.panellist']);

console.log('checks passed');
