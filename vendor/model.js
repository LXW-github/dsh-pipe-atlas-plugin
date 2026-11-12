export class TraceValidationError extends Error {
  constructor(errors) {
    super(errors.join('\n'));
    this.name = 'TraceValidationError';
    this.errors = errors;
  }
}

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = value => typeof value === 'string' && value.trim().length > 0;
const time = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const kinds = ['compute', 'transfer', 'wait', 'marker', 'allocation'];

export function normalizeTrace(input) {
  if (!object(input)) return input;
  const document = structuredClone(input);
  const missingName = value => value == null || (typeof value === 'string' && !value.trim());
  if (document.schemaVersion === '1.2' && Array.isArray(document.tasks)) {
    const omittedKernels = document.kernels === undefined;
    if (omittedKernels) document.kernels = [];
    if (Array.isArray(document.kernels)) {
      const used = new Set(document.kernels.filter(object).map(k => k.id));
      for (const task of document.tasks.filter(object)) if (string(task.kernelId)) used.add(task.kernelId);
      let index = 0;
      for (const task of document.tasks.filter(object)) {
        if (missingName(task.label)) task.label = task.id;
        if (task.kernelId === undefined) {
          while (used.has(`kernel${index}`)) index++;
          task.kernelId = `kernel${index++}`;
          used.add(task.kernelId);
          document.kernels.push({ id: task.kernelId });
        } else if (omittedKernels && string(task.kernelId) && !document.kernels.some(k => k.id === task.kernelId)) document.kernels.push({ id: task.kernelId });
      }
    }
    const taskMap = new Map(document.tasks.filter(object).map(t => [t.id, t]));
    if (Array.isArray(document.scenarios)) for (const scenario of document.scenarios.filter(object)) {
      if (Array.isArray(scenario.events)) for (const event of scenario.events.filter(object)) {
        if (event.kernelId === undefined) event.kernelId = taskMap.get(event.taskId)?.kernelId;
        if (['schedule', 'fetch'].includes(event.kind) && missingName(event.name)) event.name = event.kind === 'schedule' ? 'Scheduling' : 'Instruction fetch';
      }
    }
  }
  if (Array.isArray(document.kernels)) {
    const labels = new Set(document.kernels.filter(object).map(k => k.label).filter(string));
    let index = 0;
    for (const kernel of document.kernels.filter(object)) if (missingName(kernel.label)) {
      while (labels.has(`kernel${index}`)) index++;
      kernel.label = `kernel${index++}`;
      labels.add(kernel.label);
    }
  }
  return document;
}

export function validateTrace(input) { return validateNormalizedTrace(normalizeTrace(input)); }

function validateNormalizedTrace(input) {
  const errors = [], warnings = [];
  const fail = (path, message) => errors.push(`${path}: ${message}`);
  if (!object(input)) return { errors: ['$: expected a JSON object'], warnings };
  if (!['1.0', '1.1', '1.2'].includes(input.schemaVersion)) fail('schemaVersion', 'expected "1.0", "1.1" or "1.2"');
  const network = ['1.1', '1.2'].includes(input.schemaVersion), scheduling = input.schemaVersion === '1.2';
  const eventKinds = scheduling ? [...kinds, 'schedule', 'fetch'] : kinds;
  const meta = input.metadata;
  if (!object(meta)) fail('metadata', 'expected an object');
  else {
    if (!string(meta.title)) fail('metadata.title', 'required nonempty string');
    if (!['ns', 'us', 'ms', 'cycle'].includes(meta.timeUnit)) fail('metadata.timeUnit', 'expected ns, us, ms or cycle');
    if (!object(meta.source) || !['synthetic', 'simulator', 'hardware', 'compiler', 'imported'].includes(meta.source.kind)) fail('metadata.source.kind', 'expected synthetic, simulator, hardware, compiler or imported');
  }
  const lists = {};
  for (const key of ['cores', 'lanes', 'kernels', 'scenarios', ...(network ? ['devices', 'tasks'] : [])]) {
    const list = input[key];
    if (!Array.isArray(list) || list.length === 0) { fail(key, 'expected a nonempty array'); lists[key] = new Map(); continue; }
    const map = new Map();
    list.forEach((item, i) => {
      const path = `${key}[${i}]`;
      if (!object(item)) { fail(path, 'expected an object'); return; }
      if (!string(item.id)) fail(`${path}.id`, 'required nonempty string');
      else if (map.has(item.id)) fail(`${path}.id`, `duplicate id ${item.id}`);
      else map.set(item.id, item);
      if (!string(item.label)) fail(`${path}.label`, 'required nonempty string');
      if (['kernels', 'tasks'].includes(key) && item.color !== undefined && !/^#[0-9a-f]{6}$/i.test(item.color)) fail(`${path}.color`, 'expected #RRGGBB');
    });
    lists[key] = map;
  }
  if (network) {
    const engineIds = new Set();
    for (const [id, core] of lists.cores) {
      if (!lists.devices.has(core.deviceId)) fail(`cores.${id}.deviceId`, 'unknown device');
      for (const field of ['cubeId', 'vectorId']) {
        if (!string(core[field])) fail(`cores.${id}.${field}`, 'required nonempty string identifying one physical engine');
        else {
          const key = JSON.stringify([core.deviceId, field, core[field]]);
          if (engineIds.has(key)) fail(`cores.${id}.${field}`, 'physical engine already belongs to another core');
          engineIds.add(key);
        }
      }
    }
    const graph = new Map([...lists.tasks.keys()].map(id => [id, []]));
    const degrees = new Map([...graph.keys()].map(id => [id, 0]));
    for (const [id, task] of lists.tasks) {
      if (!lists.kernels.has(task.kernelId)) fail(`tasks.${id}.kernelId`, 'unknown kernel');
      if (task.dependsOn !== undefined && (!Array.isArray(task.dependsOn) || new Set(task.dependsOn).size !== task.dependsOn.length)) fail(`tasks.${id}.dependsOn`, 'expected an array of unique task IDs');
      for (const predecessor of Array.isArray(task.dependsOn) ? task.dependsOn : []) {
        if (!lists.tasks.has(predecessor)) fail(`tasks.${id}.dependsOn`, 'unknown task');
        else { graph.get(predecessor).push(id); degrees.set(id, degrees.get(id) + 1); }
      }
    }
    const queue = [...degrees].filter(([, d]) => !d).map(([id]) => id);
    for (let i = 0; i < queue.length; i++) for (const to of graph.get(queue[i])) {
      degrees.set(to, degrees.get(to) - 1); if (!degrees.get(to)) queue.push(to);
    }
    if (queue.length !== graph.size) fail('tasks.dependsOn', 'task dependency cycle detected');
  }
  for (const [id, lane] of lists.lanes) {
    const globalScheduler = scheduling && lane.engine === 'SCHEDULER' && lane.coreId === undefined;
    if (globalScheduler) { if (!lists.devices.has(lane.deviceId)) fail(`lanes.${id}.deviceId`, 'required known device for a shared scheduling lane'); }
    else if (!lists.cores.has(lane.coreId)) fail(`lanes.${id}.coreId`, 'unknown core');
    if (scheduling && lane.deviceId !== undefined && lane.coreId !== undefined && lists.cores.get(lane.coreId)?.deviceId !== lane.deviceId) fail(`lanes.${id}.deviceId`, 'does not match core deviceId');
    if (!string(lane.pipe)) fail(`lanes.${id}.pipe`, 'required nonempty string');
    if (!string(lane.engine)) fail(`lanes.${id}.engine`, 'required nonempty string');
    if (network && !(scheduling ? ['AIC', 'AIV', 'SCHEDULER'] : ['AIC', 'AIV']).includes(lane.engine)) fail(`lanes.${id}.engine`, 'expected AIC (Cube), AIV (Vector), or SCHEDULER in v1.2');
    if (lane.role !== undefined && !['execution', 'schedule', 'fetch'].includes(lane.role)) fail(`lanes.${id}.role`, 'expected execution, schedule or fetch');
    if (scheduling && lane.engine === 'SCHEDULER' && lane.role !== undefined && lane.role !== 'schedule') fail(`lanes.${id}.role`, 'SCHEDULER lanes have role schedule');
    if (scheduling && lane.role === 'schedule' && lane.engine !== 'SCHEDULER') fail(`lanes.${id}.engine`, 'role schedule requires engine SCHEDULER');
  }
  for (const [scenarioId, scenario] of lists.scenarios) {
    const base = `scenarios.${scenarioId}`;
    const events = new Map();
    if (!Array.isArray(scenario.events)) { fail(`${base}.events`, 'expected an array'); continue; }
    scenario.events.forEach((event, i) => {
      const path = `${base}.events[${i}]`;
      if (!object(event)) { fail(path, 'expected an object'); return; }
      if (!string(event.id)) fail(`${path}.id`, 'required nonempty string');
      else if (events.has(event.id)) fail(`${path}.id`, `duplicate id ${event.id}`);
      else events.set(event.id, event);
      if (!string(event.name)) fail(`${path}.name`, 'required nonempty string');
      if (!lists.lanes.has(event.laneId)) fail(`${path}.laneId`, 'unknown lane');
      if (!lists.kernels.has(event.kernelId)) fail(`${path}.kernelId`, 'unknown kernel');
      if (network) {
        const task = lists.tasks.get(event.taskId);
        if (!task) fail(`${path}.taskId`, 'required reference to a known task');
        else if (task.kernelId !== event.kernelId) fail(`${path}.kernelId`, 'must match the referenced task kernelId');
      }
      if (!eventKinds.includes(event.kind)) fail(`${path}.kind`, `expected ${eventKinds.join(', ')}`);
      if (!time(event.start)) fail(`${path}.start`, 'expected a finite, nonnegative, safe number');
      if (!time(event.duration)) fail(`${path}.duration`, 'expected a finite, nonnegative, safe number');
      if (time(event.start) && time(event.duration) && !time(event.start + event.duration)) fail(path, 'end time exceeds safe numeric range');
      if (event.kind === 'marker' && event.duration !== 0) fail(`${path}.duration`, 'a marker must have duration 0');
      if (!['marker', 'fetch'].includes(event.kind) && event.duration === 0) fail(`${path}.duration`, 'an interval must have positive duration');
      if (event.args !== undefined && !object(event.args)) fail(`${path}.args`, 'expected an object');
      for (const field of ['taskId', 'blockId']) if (event[field] !== undefined && typeof event[field] !== 'string') fail(`${path}.${field}`, 'expected a string');
      if (event.iteration !== undefined && (!Number.isSafeInteger(event.iteration) || event.iteration < 0)) fail(`${path}.iteration`, 'expected a nonnegative integer');
      if (event.source !== undefined) {
        if (!object(event.source)) fail(`${path}.source`, 'expected an object');
        else {
          for (const field of ['file', 'pc']) if (event.source[field] !== undefined && typeof event.source[field] !== 'string') fail(`${path}.source.${field}`, 'expected a string');
          if (event.source.line !== undefined && (!Number.isSafeInteger(event.source.line) || event.source.line < 1)) fail(`${path}.source.line`, 'expected a positive integer');
        }
      }
    });
    if (scheduling) for (const [id, event] of events) {
      const path = `${base}.events.${id}`, lane = lists.lanes.get(event.laneId);
      if (event.kind === 'schedule') {
        if (lane?.engine !== 'SCHEDULER') fail(`${path}.laneId`, 'schedule events require a SCHEDULER lane');
        if (!Array.isArray(event.fetchIds) || !event.fetchIds.length || new Set(event.fetchIds).size !== event.fetchIds.length) fail(`${path}.fetchIds`, 'required nonempty array of unique fetch event IDs');
      } else if (lane?.engine === 'SCHEDULER') fail(`${path}.laneId`, 'a SCHEDULER lane only contains schedule events');
      if (event.kind === 'fetch' && (!['AIC', 'AIV'].includes(lane?.engine) || lane?.role !== 'fetch')) fail(`${path}.laneId`, 'fetch events require an AIC/AIV lane with role fetch');
      if (event.kind !== 'fetch' && lane?.role === 'fetch') fail(`${path}.laneId`, 'a fetch lane only contains fetch events');
      if (event.kind !== 'schedule' && event.fetchIds !== undefined) fail(`${path}.fetchIds`, 'only schedule events use fetchIds');
      if (event.kind === 'schedule' && event.fetchId !== undefined) fail(`${path}.fetchId`, 'use fetchIds for schedule events');
      if (event.kind === 'fetch' && event.fetchId !== undefined) fail(`${path}.fetchId`, 'a fetch event cannot refer to another fetch');
      const references = event.kind === 'schedule' ? (Array.isArray(event.fetchIds) ? event.fetchIds : []) : event.fetchId === undefined ? [] : [event.fetchId];
      for (const ref of references) {
        const fetch = events.get(ref), targetLane = lists.lanes.get(fetch?.laneId);
        if (!fetch || fetch.kind !== 'fetch') { fail(`${path}.fetchId(s)`, 'unknown fetch event reference'); continue; }
        if (fetch.taskId !== event.taskId) fail(`${path}.fetchId(s)`, 'fetch must belong to the same destination task');
        if (event.blockId !== undefined && fetch.blockId !== undefined && event.blockId !== fetch.blockId) fail(`${path}.blockId`, 'does not match the referenced fetch block');
        if (lane?.coreId !== undefined && lane.coreId !== targetLane?.coreId) fail(`${path}.fetchId(s)`, 'fetch belongs to a different physical core');
        if (lane?.coreId === undefined && lane?.deviceId !== lists.cores.get(targetLane?.coreId)?.deviceId) fail(`${path}.fetchIds`, 'fetch belongs to a different NPU');
        if (event.kind === 'schedule' && event.start + event.duration > fetch.start) fail(path, 'scheduling must finish before instruction fetch starts');
        if (event.kind !== 'schedule' && event.start < fetch.start + fetch.duration) fail(path, 'execution cannot begin before its instruction fetch finishes');
      }
    }
    const dependencies = scheduling && Array.isArray(scenario.dependencies ?? []) ? phaseDependencies(scenario) : scenario.dependencies ?? [];
    if (!Array.isArray(dependencies)) fail(`${base}.dependencies`, 'expected an array');
    const ids = new Set(), graph = new Map([...events.keys()].map(id => [id, []]));
    const degrees = new Map([...events.keys()].map(id => [id, 0]));
    if (Array.isArray(dependencies)) dependencies.forEach((edge, i) => {
      const path = `${base}.dependencies[${i}]`;
      if (!object(edge)) { fail(path, 'expected an object'); return; }
      if (!string(edge.id) || ids.has(edge.id)) fail(`${path}.id`, 'missing or duplicate id');
      ids.add(edge.id);
      if (!events.has(edge.from) || !events.has(edge.to)) { fail(path, 'unknown event reference'); return; }
      if (edge.from === edge.to) fail(path, 'self dependency');
      if (!['data', 'sync', 'schedule'].includes(edge.type)) fail(`${path}.type`, 'expected data, sync or schedule');
      for (const key of ['fromAnchor', 'toAnchor']) if (edge[key] !== undefined && !['start', 'end'].includes(edge[key])) fail(`${path}.${key}`, 'expected start or end');
      graph.get(edge.from).push(edge.to);
      degrees.set(edge.to, degrees.get(edge.to) + 1);
      const from = events.get(edge.from), to = events.get(edge.to);
      const a = from.start + (edge.fromAnchor === 'start' ? 0 : from.duration);
      const b = to.start + (edge.toAnchor === 'end' ? to.duration : 0);
      if (a > b + 1e-9) warnings.push(`${path}: dependency anchor runs backward in time (${a} > ${b}); check streaming semantics or timestamps`);
    });
    const queue = [...degrees].filter(([, degree]) => degree === 0).map(([id]) => id);
    let visited = 0;
    for (let i = 0; i < queue.length; i++) {
      visited++;
      for (const to of graph.get(queue[i])) { degrees.set(to, degrees.get(to) - 1); if (degrees.get(to) === 0) queue.push(to); }
    }
    if (visited !== events.size) fail(`${base}.dependencies`, 'dependency cycle detected');
    const regions = scenario.regions ?? [];
    if (!Array.isArray(regions)) fail(`${base}.regions`, 'expected an array');
    const regionIds = new Set();
    if (Array.isArray(regions)) regions.forEach((region, i) => {
      const path = `${base}.regions[${i}]`;
      if (!object(region)) { fail(path, 'expected an object'); return; }
      if (!string(region.id) || regionIds.has(region.id)) fail(`${path}.id`, 'missing or duplicate id');
      regionIds.add(region.id);
      if (!string(region.label)) fail(`${path}.label`, 'required nonempty string');
      if (!time(region.start) || !time(region.end) || region.end <= region.start) fail(path, 'expected 0 <= start < end within safe numeric range');
      if (!['overlap', 'annotation'].includes(region.type)) fail(`${path}.type`, 'expected overlap or annotation');
      if (region.coreId !== undefined && !lists.cores.has(region.coreId)) fail(`${path}.coreId`, 'unknown core');
      if (network && region.taskIds !== undefined && (!Array.isArray(region.taskIds) || !region.taskIds.length || region.taskIds.some(id => !lists.tasks.has(id)))) fail(`${path}.taskIds`, 'expected known task IDs');
    });
  }
  return { errors, warnings };
}

export function parseTrace(input) {
  let document;
  try { document = typeof input === 'string' ? JSON.parse(input) : input; }
  catch (error) { throw new TraceValidationError([`JSON: ${error.message}`]); }
  document = normalizeTrace(document);
  const result = validateNormalizedTrace(document);
  if (result.errors.length) throw new TraceValidationError(result.errors);
  return { document, warnings: result.warnings };
}

export function mergeIntervals(intervals) {
  const sorted = intervals.filter(([a, b]) => b > a).map(i => [...i]).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [a, b] of sorted) {
    const previous = merged.at(-1);
    if (previous && a <= previous[1]) previous[1] = Math.max(b, previous[1]);
    else merged.push([a, b]);
  }
  return merged;
}

export const intervalLength = intervals => mergeIntervals(intervals).reduce((sum, [a, b]) => sum + b - a, 0);

export function eventCoreIds(event, laneMap, eventMap) {
  const lane = laneMap.get(event.laneId);
  if (lane?.coreId !== undefined) return [lane.coreId];
  return [...new Set((event.fetchIds ?? []).map(id => laneMap.get(eventMap.get(id)?.laneId)?.coreId).filter(id => id !== undefined))];
}

export function phaseDependencies(scenario) {
  const edges = [...(scenario.dependencies ?? [])], ids = new Set(edges.filter(object).map(e => e.id));
  const pairs = new Set(edges.filter(object).map(e => JSON.stringify([e.from, e.to])));
  let index = 0;
  const add = (from, to, label) => {
    const key = JSON.stringify([from, to]);
    if (pairs.has(key)) return;
    while (ids.has(`phase-link-${index}`)) index++;
    edges.push({ id: `phase-link-${index++}`, from, to, type: 'schedule', label, automatic: true });
    pairs.add(key);
  };
  for (const event of scenario.events.filter(object)) {
    if (event.kind === 'schedule') for (const fetchId of Array.isArray(event.fetchIds) ? event.fetchIds : []) add(event.id, fetchId, 'Scheduling → instruction fetch');
    else if (event.fetchId !== undefined) add(event.fetchId, event.id, 'Instruction fetch → execution');
  }
  return edges;
}

export function phaseStats(events) {
  const phases = kind => events.filter(event => event.kind === kind);
  const schedule = phases('schedule'), fetch = phases('fetch');
  return {
    scheduleCount: schedule.length, fetchCount: fetch.length,
    scheduleDuration: intervalLength(schedule.map(e => [e.start, e.start + e.duration])),
    fetchDuration: intervalLength(fetch.map(e => [e.start, e.start + e.duration])),
  };
}

export function traceTasks(document) {
  return ['1.1', '1.2'].includes(document.schemaVersion) ? document.tasks : document.kernels.map((kernel, i) => ({ id: kernel.id, label: `task${i}`, kernelId: kernel.id, color: kernel.color, inferred: true }));
}

export function taskSummaries(events, tasks) {
  const grouped = new Map(tasks.map(task => [task.id, []]));
  for (const event of events) grouped.get(event.taskId)?.push(event);
  return tasks.map(task => {
    const list = grouped.get(task.id);
    if (!list.length) return { ...task, start: 0, end: 0, duration: 0, intervals: [], scheduleIntervals: [], fetchIntervals: [], count: 0 };
    let start = Infinity, end = -Infinity;
    for (const event of list) { start = Math.min(start, event.start); end = Math.max(end, event.start + event.duration); }
    const intervals = mergeIntervals(list.filter(e => ['compute', 'transfer'].includes(e.kind)).map(e => [e.start, e.start + e.duration]));
    const scheduleIntervals = mergeIntervals(list.filter(e => e.kind === 'schedule').map(e => [e.start, e.start + e.duration]));
    const fetchIntervals = mergeIntervals(list.filter(e => e.kind === 'fetch').map(e => [e.start, e.start + e.duration]));
    return { ...task, start, end, duration: end - start, intervals, scheduleIntervals, fetchIntervals, activeDuration: intervalLength(intervals), count: list.length };
  });
}

export function taskOverlaps(events) {
  const perTask = new Map();
  for (const event of events) {
    if (!event.taskId || !['compute', 'transfer'].includes(event.kind) || event.duration <= 0) continue;
    if (!perTask.has(event.taskId)) perTask.set(event.taskId, []);
    perTask.get(event.taskId).push([event.start, event.start + event.duration]);
  }
  const boundaries = new Map();
  for (const [taskId, intervals] of perTask) for (const [start, end] of mergeIntervals(intervals)) {
    for (const [at, delta] of [[start, 1], [end, -1]]) {
      if (!boundaries.has(at)) boundaries.set(at, []);
      boundaries.get(at).push([taskId, delta]);
    }
  }
  const active = new Set(), segments = [];
  let previous;
  for (const at of [...boundaries.keys()].sort((a, b) => a - b)) {
    if (previous !== undefined && at > previous && active.size > 1) {
      const taskIds = [...active].sort(), last = segments.at(-1);
      if (last && last.end === previous && JSON.stringify(last.taskIds) === JSON.stringify(taskIds)) last.end = at;
      else segments.push({ id: `auto-overlap-${segments.length}`, type: 'overlap', start: previous, end: at, taskIds, label: taskIds.join(' ∥ '), automatic: true });
    }
    for (const [taskId, delta] of boundaries.get(at)) if (delta < 0) active.delete(taskId);
    for (const [taskId, delta] of boundaries.get(at)) if (delta > 0) active.add(taskId);
    previous = at;
  }
  return segments;
}

export function traceStats(events, lanes, regions = []) {
  if (!events.length) return { start: 0, end: 1, duration: 0, activeRate: 0, overlap: 0, count: 0, laneBusy: new Map() };
  let start = Infinity, end = -Infinity;
  for (const e of events) { start = Math.min(start, e.start); end = Math.max(end, e.start + e.duration); }
  const duration = end - start;
  const laneBusy = new Map(lanes.map(l => [l.id, intervalLength(events.filter(e => e.laneId === l.id && ['compute', 'transfer'].includes(e.kind)).map(e => [e.start, e.start + e.duration]))]));
  const busy = [...laneBusy.values()].reduce((a, b) => a + b, 0);
  const overlap = intervalLength(regions.filter(r => r.type === 'overlap').map(r => [Math.max(start, r.start), Math.min(end, r.end)]));
  const executionLanes = lanes.filter(lane => lane.engine !== 'SCHEDULER' && !['schedule', 'fetch'].includes(lane.role));
  return { start, end, duration, activeRate: duration && executionLanes.length ? busy / (duration * executionLanes.length) : 0, overlap, count: events.length, laneBusy };
}

export function layoutEvents(events) {
  const positions = new Map(), laneDepth = new Map(), perLane = new Map();
  for (const event of events) { if (!perLane.has(event.laneId)) perLane.set(event.laneId, []); perLane.get(event.laneId).push(event); }
  for (const [laneId, list] of perLane) {
    const ends = [];
    for (const event of [...list].sort((a, b) => a.start - b.start || b.duration - a.duration)) {
      if (event.kind === 'marker') { positions.set(event.id, 0); continue; }
      let level = ends.findIndex(end => end <= event.start + 1e-10);
      if (level === -1) level = ends.length;
      ends[level] = event.start + event.duration;
      positions.set(event.id, level);
    }
    laneDepth.set(laneId, Math.max(1, ends.length));
  }
  return { positions, laneDepth };
}

export function importChromeTrace(input, options = {}) {
  const raw = typeof input === 'string' ? JSON.parse(input) : input;
  const trace = Array.isArray(raw) ? raw : raw?.traceEvents;
  if (!Array.isArray(trace)) throw new TraceValidationError(['traceEvents: expected an array']);
  const unit = options.timeUnit ?? 'us';
  if (!['ns', 'us', 'ms'].includes(unit)) throw new TraceValidationError(['timeUnit: Chrome trace import supports ns, us, ms']);
  const factor = { ns: 1000, us: 1, ms: 0.001 }[unit];
  const complete = [], warnings = [], stacks = new Map(), processNames = new Map(), threadNames = new Map();
  const key = e => JSON.stringify([e.pid ?? 0, e.tid ?? 0]);
  for (const e of trace) {
    if (!object(e)) continue;
    if (e.ph === 'M' && e.name === 'process_name') processNames.set(String(e.pid ?? 0), String(e.args?.name ?? e.pid));
    if (e.ph === 'M' && e.name === 'thread_name') threadNames.set(key(e), String(e.args?.name ?? e.tid));
    if (e.ph === 'X') complete.push(e);
    else if (['i', 'I'].includes(e.ph)) complete.push({ ...e, dur: 0, marker: true });
    else if (e.ph === 'B') { if (!stacks.has(key(e))) stacks.set(key(e), []); stacks.get(key(e)).push(e); }
    else if (e.ph === 'E') {
      const begin = stacks.get(key(e))?.pop();
      if (begin) complete.push({ ...begin, ph: 'X', dur: e.ts - begin.ts, args: { ...begin.args, ...e.args } });
      else warnings.push(`Unmatched E event on ${key(e)}`);
    } else if (e.ph !== 'M') warnings.push(`Unsupported Chrome phase ${String(e.ph)} skipped (flows/counters are not inferred)`);
  }
  for (const stack of stacks.values()) if (stack.length) warnings.push(`${stack.length} unclosed B event(s) skipped`);
  if (!complete.length) throw new TraceValidationError(['traceEvents: no supported X, B/E or instant events']);
  let origin = Infinity;
  for (const e of complete) if (Number.isFinite(e.ts)) origin = Math.min(origin, e.ts);
  const cores = new Map(), lanes = new Map(), kernels = new Map();
  const events = complete.map((e, i) => {
    const pid = String(e.pid ?? 0), laneKey = key(e), kernelName = String(e.args?.kernel ?? e.cat ?? 'Imported trace');
    if (!cores.has(pid)) cores.set(pid, { id: `core-${cores.size}`, label: processNames.get(pid) ?? pid });
    const pipe = threadNames.get(laneKey) ?? String(e.tid ?? 'UNKNOWN');
    if (!lanes.has(laneKey)) lanes.set(laneKey, { id: `lane-${lanes.size}`, coreId: cores.get(pid).id, engine: /cube|aic\b/i.test(pid) ? 'AIC' : /vec|aiv\b/i.test(pid) ? 'AIV' : 'TRACE', pipe, label: pipe });
    if (!kernels.has(kernelName)) kernels.set(kernelName, { id: `kernel-${kernels.size}`, label: kernelName });
    const marker = e.marker || e.dur === 0;
    return { id: `event-${i}`, laneId: lanes.get(laneKey).id, kernelId: kernels.get(kernelName).id, name: String(e.name ?? 'Unnamed'), kind: marker ? 'marker' : /wait|barrier/i.test(e.name) ? 'wait' : /mte|fix|dma/i.test(pipe) ? 'transfer' : 'compute', start: (e.ts - origin) * factor, duration: marker ? 0 : e.dur * factor, args: object(e.args) ? e.args : {}, source: { pc: String(e.args?.pc_addr ?? ''), file: String(e.args?.code ?? '') } };
  });
  const document = { schemaVersion: '1.0', metadata: { title: options.title ?? 'Imported Chrome / msinsight trace', timeUnit: unit, timestampOrigin: String(origin), source: { kind: 'imported', format: 'Chrome Trace Event', timestampUnit: 'us' } }, cores: [...cores.values()], lanes: [...lanes.values()], kernels: [...kernels.values()], scenarios: [{ id: 'imported', label: 'Imported trace', events, dependencies: [], regions: [] }] };
  const parsed = parseTrace(document);
  return { document: parsed.document, warnings: [...warnings, ...parsed.warnings] };
}

export function loadTrace(input, options = {}) {
  let raw;
  try { raw = typeof input === 'string' ? JSON.parse(input) : input; }
  catch (error) { throw new TraceValidationError([`JSON: ${error.message}`]); }
  return Array.isArray(raw) || (object(raw) && 'traceEvents' in raw) ? importChromeTrace(raw, options) : parseTrace(raw);
}
