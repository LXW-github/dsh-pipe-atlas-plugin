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
import { layoutEvents, outstandingWindow, parseTrace } from '../vendor/model.js';

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

// Outstanding packing: one pipe keeps several instructions in flight, so rows
// follow the issue → complete window rather than the execution window.
const event = (id, start, duration, issue, complete) => ({
  id, laneId: 'p', taskId: 't', kernelId: 'k', kind: 'transfer', start, duration,
  ...(issue === undefined ? {} : { issue }), ...(complete === undefined ? {} : { complete }),
});
const sequential = [event('e1', 0, 2), event('e2', 4, 2), event('e3', 8, 2)];
assert.equal(layoutEvents(sequential).laneDepth.get('p'), 1, 'sequential execution without outstanding data stays one row');
const inFlight = [event('a', 0, 2, 0, 10), event('b', 2, 2, 2, 12), event('c', 4, 2, 4, 14)];
const packed = layoutEvents(inFlight);
assert.equal(packed.laneDepth.get('p'), 3, 'three overlapping outstanding windows need three rows');
assert.deepEqual([...packed.positions.values()], [0, 1, 2]);
assert.equal(packed.rowInfo.get('p').filter((row) => row.idle).length, 0, 'no idle rows without a declared capacity');
const padded = layoutEvents(inFlight, { capacity: new Map([['p', 5]]) });
assert.equal(padded.laneDepth.get('p'), 5, 'issueWidth pads the pipe up to its capacity');
assert.equal(padded.rowInfo.get('p').filter((row) => row.idle).length, 2, 'unused slots stay as idle rows');
assert.equal(layoutEvents(sequential, { capacity: new Map([['p', 4]]) }).laneDepth.get('p'), 1, 'capacity never pads a lane without outstanding data');
const executionOverlap = [event('x', 0, 5), event('y', 3, 5)];
assert.equal(layoutEvents(executionOverlap).laneDepth.get('p'), 2, 'execution overlap still splits without issue/complete');
assert.deepEqual(outstandingWindow({ start: 2, duration: 3 }), [2, 5], 'the execution window is the fallback');
assert.deepEqual(outstandingWindow({ start: 2, duration: 3, issue: 1, complete: 9 }), [1, 9], 'issue → complete wins');
const withMarker = [event('m', 30, 0, 30, 30), event('x', 0, 10, 0, 4)];
withMarker[0].kind = 'marker';
assert.equal(layoutEvents(withMarker).positions.get('m'), 0, 'a marker sits in the first row');

// Schema 1.3 accepts the new fields and warns when a pipe exceeds its capacity.
const trace13 = {
  schemaVersion: '1.3',
  metadata: { title: 't', timeUnit: 'us', source: { kind: 'synthetic' } },
  devices: [{ id: 'npu0', label: 'NPU 0' }],
  cores: [{ id: 'c0', label: 'Core 0', deviceId: 'npu0', cubeId: 'cube-0', vectorId: 'vector-0' }],
  lanes: [{ id: 'p', label: 'MTE2', coreId: 'c0', engine: 'AIV', pipe: 'MTE2', issueWidth: 2 }],
  kernels: [{ id: 'k', label: 'k' }],
  tasks: [{ id: 't', label: 'T', kernelId: 'k' }],
  scenarios: [{ id: 's', label: 'S', events: [
    { id: 'e1', taskId: 't', kernelId: 'k', laneId: 'p', name: 'dma', kind: 'transfer', start: 0, duration: 2, issue: 0, complete: 10 },
    { id: 'e2', taskId: 't', kernelId: 'k', laneId: 'p', name: 'dma', kind: 'transfer', start: 2, duration: 2, issue: 2, complete: 12 },
    { id: 'e3', taskId: 't', kernelId: 'k', laneId: 'p', name: 'dma', kind: 'transfer', start: 4, duration: 2, issue: 4, complete: 14 },
  ] }],
};
const parsed = parseTrace(trace13);
assert.equal(parsed.warnings.length, 1, 'a pipe above its issueWidth raises one warning');
assert.match(parsed.warnings[0], /3 outstanding instructions but issueWidth is 2/);
const outstandingOnly = structuredClone(trace13);
delete outstandingOnly.scenarios[0].events[0].start;
delete outstandingOnly.scenarios[0].events[0].duration;
const derived = parseTrace(outstandingOnly).document.scenarios[0].events[0];
assert.equal(derived.start, 0, 'start defaults to issue');
assert.equal(derived.duration, 10, 'duration defaults to complete - issue');
const invalid = structuredClone(trace13);
invalid.scenarios[0].events[0].issue = 5;
assert.throws(() => parseTrace(invalid), /must not be later than start/, 'issue after start is rejected');

const source = read('client.js');
assert.ok(!/^\s*import\s/m.test(source), 'client.js must not contain ESM imports');
assert.match(source, /window\.__ModuleLoader__\.load\(/);
assert.match(source, /customElements\.define\('pipe-atlas-[0-9a-f]{8}'/);
assert.match(source, /const VIEWER_TAG = 'pipe-atlas-[0-9a-f]{8}';/);
assert.ok(!/'pipe-timeline'/.test(source), 'the generic tag name is not registered');
assert.equal((source.match(/const esc = escapeHtml;/g) || []).length, 1, 'the esc alias is declared exactly once');
assert.ok(source.indexOf('const esc = escapeHtml;') < source.indexOf('// ---- vendor/pipe-timeline.js ----'), 'the esc alias is declared before its consumer');
assert.match(source, /id: '@local\/dsh-pipe-atlas'/);
assert.match(source, /data-row-toggle/);
assert.match(source, /data-group-toggle/);
assert.match(source, /class="swatch-flight"/);
assert.match(source, /outstanding/);
assert.match(source, /"outstanding":\{/);

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
const viewerTag = source.match(/const VIEWER_TAG = '([^']+)'/) && source.match(/const VIEWER_TAG = '([^']+)'/)[1];
assert.ok(viewerTag, 'the viewer tag is declared');
assert.ok(customElementsMap.has(viewerTag), 'the Web Component is registered once');

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
