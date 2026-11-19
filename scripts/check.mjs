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
import { layoutEvents, outstandingWindow, parseTrace, loadTrace, laneSortIndex, phaseStats, taskOverlaps, traceStats } from '../vendor/model.js';

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

for (const name of ['demo', 'minimal', 'network', 'outstanding', 'scheduling']) {
  parseTrace(read(`vendor/${name}.json`));
}
const scheduling = parseTrace(read('vendor/scheduling.json')).document;
assert.equal(scheduling.schemaVersion, '1.4');
assert.equal(scheduling.lanes.find(lane => lane.id === 'c0-fetch').engine, 'AIV');
assert.equal(scheduling.kernels[0].label, 'kernel0');
assert.ok(phaseStats(scheduling.scenarios[0].events).scheduleCount > 1);
const invalidEngine = structuredClone(scheduling);
invalidEngine.lanes.find(lane => lane.id === 'c0-fetch').engineId = 'vector-1';
assert.throws(() => parseTrace(invalidEngine), /engine instance in this core/);

// Match msopprof trace.json identities even when Chrome metadata supplies the names.
const msinsight = loadTrace({ profilingType: 'op', displayTimeUnit: 'ns', traceEvents: [
  { ph: 'M', pid: 7, name: 'process_name', args: { name: 'core2.veccore1' } },
  { ph: 'M', pid: 7, tid: 8, name: 'thread_name', args: { name: 'FC' } },
  { ph: 'M', pid: 7, tid: 8, name: 'thread_sort_index', args: { sort_index: 12 } },
  { ph: 'X', pid: 'core2.cubecore0', tid: 'MTE2', ts: 1, dur: 4, name: 'MOV_GM_L1', args: { task_id: 31, kernel: 'mix' } },
  { ph: 'X', pid: 7, tid: 'MTE2', ts: 3, dur: 1, name: 'cache_time', args: { task_id: 32 } },
  { ph: 'X', pid: 7, tid: 8, ts: 4, dur: 3, name: 'WAIT_FLAG_DEVI', args: { task_id: 32 } },
  { ph: 'X', pid: 7, tid: 'CACHEMISS', ts: 4, dur: 1, name: 'ICACHE_MISS', args: { task_id: 32 } },
  { ph: 'X', pid: 'core2.veccore0', tid: 'MTE2', ts: 4, dur: 4, name: 'MOV_GM_UB', args: { task_id: 32, kernel: 'mix' } },
  { ph: 'X', pid: 'core2.veccore0', tid: 'VEC', ts: 8, dur: 1, name: 'VADD', args: { task_id: 32 } },
  { ph: 'X', pid: 'core2.veccore0', tid: 'VECTOR', ts: 9, dur: 1, name: 'VSUB', args: { task_id: 32 } },
  { ph: 'X', pid: 'device1.core2.veccore0', tid: 'SCALAR', ts: 9, dur: 1, name: 'MOV_XD_IMM', args: { task_id: 32 } },
] }).document;
assert.equal(msinsight.schemaVersion, '1.4');
assert.equal(msinsight.metadata.timeUnit, 'us', 'the Chrome display unit does not rescale timestamps');
assert.equal(msinsight.cores.length, 2, 'devices are independent and subcores share their physical core');
assert.deepEqual(msinsight.cores[0].engines.map(e => e.type).sort(), ['AIC', 'AIV', 'AIV']);
const flow = msinsight.lanes.find(lane => lane.pipe === 'FLOWCTRL');
assert.deepEqual(flow.trace, { pid: 7, tid: 8, processName: 'core2.veccore1', threadName: 'FC', sortIndex: 12 });
assert.equal(laneSortIndex(flow), 12);
assert.equal(laneSortIndex(msinsight.lanes.find(lane => lane.pipe === 'MTE2')), 6);
assert.equal(new Set(msinsight.lanes.filter(lane => lane.pipe === 'MTE2').map(lane => lane.engineId)).size, 3);
assert.deepEqual(msinsight.lanes.filter(lane => lane.pipe === 'VECTOR').map(lane => lane.trace.tid), ['VEC', 'VECTOR']);
assert.equal(msinsight.kernels.length, 1, 'two invocations share their kernel');
assert.equal(msinsight.tasks.length, 2, 'two source task IDs stay distinct');
const [sim] = msinsight.scenarios;
assert.equal(sim.events.find(event => event.name === 'WAIT_FLAG_DEVI').kind, 'wait');
const cacheTime = sim.events.find(event => event.name === 'cache_time');
assert.equal(cacheTime.kind, 'diagnostic');
assert.equal(msinsight.lanes.find(lane => lane.id === cacheTime.laneId).pipe, 'MTE2');
const laneMap = new Map(msinsight.lanes.map(lane => [lane.id, lane]));
assert.equal(traceStats(sim.events, msinsight.lanes).laneBusy.get(cacheTime.laneId), 0);
assert.deepEqual(taskOverlaps(sim.events, laneMap).map(({ start, end }) => [start, end]), [[3, 4]]);
assert.deepEqual(parseTrace(JSON.stringify(msinsight)).document, msinsight);

const noTask = loadTrace([
  { ph: 'X', pid: 'core0.veccore0', tid: 'VECTOR', ts: 2, dur: 1, name: 'VADD', cat: 'compute-color' },
  { ph: 'X', pid: 'core0.veccore0', tid: 'CACHEMISS', ts: 3, dur: 1, name: 'MISS', cat: 'cache-color' },
]).document;
assert.deepEqual(noTask.tasks.map(task => [task.label, task.kernelId]), [['task0', 'kernel0']]);
assert.equal(noTask.kernels[0].label, 'kernel0');

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
