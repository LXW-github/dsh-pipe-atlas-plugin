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
const schemaVersions = ['1.0', '1.1', '1.2', '1.3', '1.4'];
const engineTypes = ['AIC', 'AIV', 'TRACE'];
const pipeOrder = ['SCALAR', 'FLOWCTRL', 'MTE1', 'CUBE', 'FIXP', 'MTE2', 'VECTOR', 'MTE3', 'CACHEMISS'];
const diagnosticPipes = new Set(['CACHEMISS', 'ALL', 'EVENT', 'USEMASK', 'MTE Throughput', 'PUSHQ', 'RVECLP', 'RVECSU', 'RVECLD', 'RVECEX', 'RVECST']);
const pipeNames = new Map([...pipeOrder, ...diagnosticPipes].map(name => [name.toUpperCase(), name]));
const pipeAliases = new Map([
  ['FC', 'FLOWCTRL'], ['FIX_PIPE', 'FIXP'], ['FIXPIPE', 'FIXP'], ['ISSUE', 'EVENT'], ['USER_MARK', 'USEMASK'],
  ...['VEC', 'VEC0', 'VEC1', 'VECTOR0', 'VECTOR1'].map(name => [name, 'VECTOR']),
]);

function canonicalPipe(pipe) {
  const key = pipe.trim().toUpperCase();
  return pipeNames.get(key) ?? pipeAliases.get(key) ?? pipe;
}

export function laneRole(lane) {
  if (lane.engine === 'SCHEDULER') return 'schedule';
  return lane.role ?? (diagnosticPipes.has(lane.pipe) || /^WARP_\d+$/.test(lane.pipe) ? 'diagnostic' : 'execution');
}

export function isExecutionLane(lane) {
  return !!lane && laneRole(lane) === 'execution';
}

export function laneSortIndex(lane) {
  return Number.isFinite(lane.trace?.sortIndex) ? lane.trace.sortIndex : pipeOrder.indexOf(lane.pipe) + 1;
}

export function laneEngine(core, lane) {
  const legacyId = lane.engine === 'AIC' ? core?.cubeId : lane.engine === 'AIV' ? core?.vectorId : undefined;
  const id = string(lane.engineId) ? lane.engineId : string(legacyId) ? legacyId : lane.engine;
  const declared = Array.isArray(core?.engines) ? core.engines.find(engine => engine?.id === id) : undefined;
  return declared ?? { id, type: lane.engine };
}

export function normalizeTrace(input) {
  if (!object(input)) return input;
  const document = structuredClone(input);
  const missingName = value => value == null || (typeof value === 'string' && !value.trim());
  const aligned = document.schemaVersion === '1.4';
  if (Array.isArray(document.lanes)) {
    const cores = new Map((Array.isArray(document.cores) ? document.cores.filter(object) : []).map(core => [core.id, core]));
    for (const lane of document.lanes.filter(object)) {
      if (aligned && lane.engine === undefined) {
        const engines = cores.get(lane.coreId)?.engines;
        if (Array.isArray(engines)) lane.engine = engines.find(engine => object(engine) && engine.id === lane.engineId)?.type;
      }
      if (!string(lane.pipe)) continue;
      const pipe = canonicalPipe(lane.pipe);
      if (lane.label === lane.pipe || (aligned && missingName(lane.label))) lane.label = pipe;
      lane.pipe = pipe;
      if (aligned && lane.role === undefined) lane.role = laneRole(lane);
    }
  }
  if (['1.2', '1.3', '1.4'].includes(document.schemaVersion) && Array.isArray(document.tasks)) {
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
  if (['1.3', '1.4'].includes(document.schemaVersion) && Array.isArray(document.scenarios)) for (const scenario of document.scenarios.filter(object)) {
    if (!Array.isArray(scenario.events)) continue;
    for (const event of scenario.events.filter(object)) {
      // Outstanding-only traces may omit the execution window: it defaults to
      // the in-flight window, so upstream tools never write the same span twice.
      if (event.start === undefined && time(event.issue)) event.start = event.issue;
      if (event.duration === undefined && time(event.start) && time(event.complete)) event.duration = event.complete - event.start;
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
  if (!schemaVersions.includes(input.schemaVersion)) fail('schemaVersion', 'expected a supported version from 1.0 through 1.4');
  const aligned = input.schemaVersion === '1.4';
  const network = schemaVersions.slice(1).includes(input.schemaVersion), scheduling = schemaVersions.slice(2).includes(input.schemaVersion);
  const eventKinds = [...kinds, ...(scheduling ? ['schedule', 'fetch'] : []), ...(aligned ? ['diagnostic', 'control'] : [])];
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
  const coreEngines = new Map();
  if (network) {
    const engineIds = new Set();
    for (const [id, core] of lists.cores) {
      if (!lists.devices.has(core.deviceId)) fail(`cores.${id}.deviceId`, 'unknown device');
      if (aligned) {
        const engines = new Map();
        coreEngines.set(id, engines);
        if (!Array.isArray(core.engines) || !core.engines.length) fail(`cores.${id}.engines`, 'expected a nonempty array');
        else core.engines.forEach((engine, i) => {
          const path = `cores.${id}.engines[${i}]`;
          if (!object(engine)) { fail(path, 'expected an object'); return; }
          if (!string(engine.id) || engines.has(engine.id)) fail(`${path}.id`, 'expected a unique nonempty engine ID within the core');
          else engines.set(engine.id, engine);
          if (!engineTypes.includes(engine.type)) fail(`${path}.type`, 'expected AIC, AIV or TRACE');
          if (engine.label !== undefined && !string(engine.label)) fail(`${path}.label`, 'expected a nonempty string');
        });
        continue;
      }
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
    if (network && !(aligned ? [...engineTypes, 'SCHEDULER'] : scheduling ? ['AIC', 'AIV', 'SCHEDULER'] : ['AIC', 'AIV']).includes(lane.engine)) fail(`lanes.${id}.engine`, 'unknown engine type');
    if (aligned && lane.engine !== 'SCHEDULER') {
      const engine = coreEngines.get(lane.coreId)?.get(lane.engineId);
      if (!engine) fail(`lanes.${id}.engineId`, 'required reference to an engine instance in this core');
      else if (engine.type !== lane.engine) fail(`lanes.${id}.engine`, 'does not match the referenced engine type');
    }
    if (aligned && (lane.trace !== undefined)) {
      const path = `lanes.${id}.trace`;
      if (!object(lane.trace)) fail(path, 'expected an object');
      else {
        for (const field of ['pid', 'tid']) {
          if (typeof lane.trace[field] !== 'string' && !Number.isFinite(lane.trace[field])) fail(`${path}.${field}`, 'expected a string or finite number');
        }
        for (const field of ['processName', 'threadName']) {
          if (lane.trace[field] !== undefined && typeof lane.trace[field] !== 'string') fail(`${path}.${field}`, 'expected a string');
        }
        if (lane.trace.sortIndex !== undefined && !Number.isFinite(lane.trace.sortIndex)) fail(`${path}.sortIndex`, 'expected a finite number');
      }
    }
    if (lane.role !== undefined && !['execution', 'schedule', 'fetch', ...(aligned ? ['diagnostic'] : [])].includes(lane.role)) fail(`lanes.${id}.role`, 'unknown track role');
    if (scheduling && lane.engine === 'SCHEDULER' && lane.role !== undefined && lane.role !== 'schedule') fail(`lanes.${id}.role`, 'SCHEDULER lanes have role schedule');
    if (scheduling && lane.role === 'schedule' && lane.engine !== 'SCHEDULER') fail(`lanes.${id}.engine`, 'role schedule requires engine SCHEDULER');
    if (lane.issueWidth !== undefined && (!Number.isSafeInteger(lane.issueWidth) || lane.issueWidth < 1 || lane.issueWidth > 1024)) fail(`lanes.${id}.issueWidth`, 'expected an integer between 1 and 1024');
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
      for (const field of ['issue', 'complete']) {
        if (event[field] === undefined) continue;
        if (!time(event[field])) { fail(`${path}.${field}`, 'expected a finite, nonnegative, safe number'); continue; }
        if (field === 'issue' && time(event.start) && event[field] > event.start) fail(`${path}.issue`, 'must not be later than start');
        if (field === 'complete' && time(event.start) && time(event.duration) && event[field] < event.start + event.duration) fail(`${path}.complete`, 'must not be earlier than start + duration');
      }
      if (time(event.issue) && time(event.complete) && event.complete <= event.issue) fail(path, 'complete must be later than issue');
      if (event.issue !== undefined && event.complete === undefined && event.kind !== 'marker') warnings.push(`${path}: issue without complete; the outstanding window ends with the execution`);
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
    const laneWindows = new Map();
    for (const event of events.values()) {
      if (event.issue === undefined && event.complete === undefined) continue;
      if (!time(event.start)) continue;
      const [from, to] = outstandingWindow(event);
      if (!laneWindows.has(event.laneId)) laneWindows.set(event.laneId, []);
      laneWindows.get(event.laneId).push([from, to]);
    }
    for (const [laneId, windows] of laneWindows) {
      const width = lists.lanes.get(laneId)?.issueWidth;
      if (width === undefined) continue;
      const points = windows.flatMap(([from, to]) => [[from, 1], [to, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      let current = 0, peak = 0;
      for (const [, delta] of points) { current += delta; peak = Math.max(peak, current); }
      if (peak > width) warnings.push(`${base}.events: lane ${laneId} has ${peak} outstanding instructions but issueWidth is ${width}`);
    }
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
  return schemaVersions.slice(1).includes(document.schemaVersion) ? document.tasks : document.kernels.map((kernel, i) => ({ id: kernel.id, label: `task${i}`, kernelId: kernel.id, color: kernel.color, inferred: true }));
}

function isActiveEvent(event, laneMap) {
  return (event.kind === 'compute' || event.kind === 'transfer') && (!laneMap || isExecutionLane(laneMap.get(event.laneId)));
}

export function taskSummaries(events, tasks, laneMap) {
  const grouped = new Map(tasks.map(task => [task.id, []]));
  for (const event of events) grouped.get(event.taskId)?.push(event);
  return tasks.map(task => {
    const list = grouped.get(task.id);
    if (!list.length) return { ...task, start: 0, end: 0, duration: 0, intervals: [], scheduleIntervals: [], fetchIntervals: [], count: 0 };
    let start = Infinity, end = -Infinity;
    for (const event of list) { start = Math.min(start, event.start); end = Math.max(end, event.start + event.duration); }
    const intervals = mergeIntervals(list.filter(event => isActiveEvent(event, laneMap)).map(e => [e.start, e.start + e.duration]));
    const scheduleIntervals = mergeIntervals(list.filter(e => e.kind === 'schedule').map(e => [e.start, e.start + e.duration]));
    const fetchIntervals = mergeIntervals(list.filter(e => e.kind === 'fetch').map(e => [e.start, e.start + e.duration]));
    return { ...task, start, end, duration: end - start, intervals, scheduleIntervals, fetchIntervals, activeDuration: intervalLength(intervals), count: list.length };
  });
}

export function taskOverlaps(events, laneMap) {
  const perTask = new Map();
  for (const event of events) {
    if (!event.taskId || !isActiveEvent(event, laneMap) || event.duration <= 0) continue;
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
  const intervals = new Map(lanes.filter(isExecutionLane).map(lane => [lane.id, []]));
  for (const event of events) {
    const eventEnd = event.start + event.duration;
    start = Math.min(start, event.start);
    end = Math.max(end, eventEnd);
    if (isActiveEvent(event)) intervals.get(event.laneId)?.push([event.start, eventEnd]);
  }
  const duration = end - start;
  const laneBusy = new Map(lanes.map(lane => [lane.id, intervalLength(intervals.get(lane.id) ?? [])]));
  const busy = [...laneBusy.values()].reduce((a, b) => a + b, 0);
  const overlap = intervalLength(regions.filter(r => r.type === 'overlap').map(r => [Math.max(start, r.start), Math.min(end, r.end)]));
  return { start, end, duration, activeRate: duration && intervals.size ? busy / (duration * intervals.size) : 0, overlap, count: events.length, laneBusy };
}

/**
 * Pack a pipe's events into rows (visual tracks inside one lane).
 *
 * `mode` decides what owns a row group:
 * - `overlap` (default): one group, rows grow only where events overlap in time.
 * - `task` / `kernel`: every task (or kernel) gets its own row block, so a pipe
 *   that executes three tasks shows three rows even when they never overlap.
 *
 * Inside a group, events are packed first-fit by start time, so a long group
 * still splits into extra rows when two of its events really overlap.
 *
 * @param {Array} events - scenario events, all lanes.
 * @param {{mode?: 'overlap'|'task'|'kernel'}} [options]
 * @returns {{positions: Map<string, number>, laneDepth: Map<string, number>,
 *   rowInfo: Map<string, Array<{index: number, key: string, mode: string,
 *   count: number, start: number, end: number}>>}}
 */
/**
 * The in-flight window of one event: from the moment the pipe accepts the
 * instruction (`issue`) to the moment it retires it (`complete`). Both fields
 * are optional; without them the execution window is the outstanding window.
 *
 * @param {{start: number, duration: number, issue?: number, complete?: number}} event
 * @returns {[number, number]}
 */
export function outstandingWindow(event) {
  const from = event.issue === undefined ? event.start : Math.min(event.issue, event.start);
  const to = event.complete === undefined ? event.start + event.duration : Math.max(event.complete, event.start + event.duration);
  return [from, to];
}

/**
 * Pack events into the rows a pipe needs.
 *
 * A pipe can keep several instructions outstanding at once, so rows are packed
 * by the outstanding window rather than by execution time: two instructions
 * whose lifetimes overlap occupy different rows even when their execution does
 * not. `options.capacity` pads the rows up to a lane's declared `issueWidth`,
 * so idle slots stay visible; a lane without outstanding data keeps one row.
 *
 * @param {Array} events - scenario events.
 * @param {{capacity?: Map<string, number>}} [options]
 * @returns {{positions: Map<string, number>, laneDepth: Map<string, number>,
 *   rowInfo: Map<string, Array<{index: number, count: number, idle: boolean,
 *   start: number|null, end: number|null}>>}}
 */
export function layoutEvents(events, options = {}) {
  const capacity = options.capacity;
  const positions = new Map(), laneDepth = new Map(), rowInfo = new Map(), perLane = new Map();
  for (const event of events) { if (!perLane.has(event.laneId)) perLane.set(event.laneId, []); perLane.get(event.laneId).push(event); }
  for (const [laneId, list] of perLane) {
    const sorted = [...list].sort((a, b) => outstandingWindow(a)[0] - outstandingWindow(b)[0] || b.duration - a.duration || String(a.id).localeCompare(String(b.id)));
    const rows = [];
    for (const event of sorted) {
      if (event.kind === 'marker') {
        if (!rows.length) rows.push({ last: -Infinity, events: [] });
        rows[0].events.push(event);
        continue;
      }
      const [from, to] = outstandingWindow(event);
      let row = rows.find(candidate => candidate.last <= from + 1e-10);
      if (!row) { row = { last: -Infinity, events: [] }; rows.push(row); }
      row.last = to;
      row.events.push(event);
    }
    const info = [];
    for (const row of rows) {
      let start = Infinity, end = -Infinity;
      for (const event of row.events) { const [from, to] = outstandingWindow(event); start = Math.min(start, from); end = Math.max(end, to); }
      const index = info.length;
      info.push({ index, count: row.events.length, idle: false, start, end });
      for (const event of row.events) positions.set(event.id, index);
    }
    const declared = capacity?.get(laneId) ?? 0;
    const outstanding = list.some(event => event.issue !== undefined || event.complete !== undefined);
    const depth = Math.max(info.length, outstanding ? declared : 0, 1);
    for (let index = info.length; index < depth; index++) info.push({ index, count: 0, idle: true, start: null, end: null });
    laneDepth.set(laneId, depth);
    rowInfo.set(laneId, info);
  }
  return { positions, laneDepth, rowInfo };
}

function msinsightTopology(processIds, processNames) {
  const pattern = /^(?:(?:npu|device)[ _-]?(\d+)[./:])?core(\d+)\.((cube|vec)core\d+)$/i;
  const matches = new Map([...processIds].map(pid => [pid, pattern.exec(processNames.get(pid) ?? String(pid)) ?? pattern.exec(String(pid))]));
  if (![...matches.values()].some(Boolean)) return null;

  const devices = new Map(), cores = new Map(), processes = new Map();
  for (const [pid, match] of matches) {
    const deviceId = match ? `npu${Number(match[1] ?? 0)}` : 'other';
    if (!devices.has(deviceId)) devices.set(deviceId, { id: deviceId, label: match ? `NPU ${Number(match[1] ?? 0)}` : '其他 Trace 进程' });
    const coreKey = JSON.stringify(match ? [deviceId, Number(match[2])] : [deviceId, pid]);
    if (!cores.has(coreKey)) cores.set(coreKey, {
      id: `core-${cores.size}`,
      label: match ? `Core ${Number(match[2])}` : processNames.get(pid) || String(pid) || 'Trace process',
      deviceId,
      engines: [],
    });
    const core = cores.get(coreKey);
    const engine = {
      id: `engine-${core.engines.length}`,
      label: match ? match[3].toLowerCase() : core.label,
      type: !match ? 'TRACE' : match[4].toLowerCase() === 'cube' ? 'AIC' : 'AIV',
    };
    if (core.engines.some(other => other.label === engine.label)) engine.label += ` · pid ${String(pid)}`;
    core.engines.push(engine);
    processes.set(pid, { core, engine });
  }
  return { devices: [...devices.values()], cores: [...cores.values()], processes };
}

function importedEventKind(event, lane, msinsight) {
  if (event.marker || event.dur === 0) return 'marker';
  if (/wait|barrier|^bar$/i.test(event.name)) return 'wait';
  if (msinsight && (laneRole(lane) === 'diagnostic' || /^(cache_time|ccu_time)$/i.test(event.name))) return 'diagnostic';
  if (msinsight && lane.pipe === 'FLOWCTRL') return 'control';
  return /mte|fix|dma/i.test(lane.pipe) ? 'transfer' : 'compute';
}

export function importChromeTrace(input, options = {}) {
  const raw = typeof input === 'string' ? JSON.parse(input) : input;
  const trace = Array.isArray(raw) ? raw : raw?.traceEvents;
  if (!Array.isArray(trace)) throw new TraceValidationError(['traceEvents: expected an array']);
  const unit = options.timeUnit ?? 'us';
  if (!['ns', 'us', 'ms'].includes(unit)) throw new TraceValidationError(['timeUnit: Chrome trace import supports ns, us, ms']);
  const factor = { ns: 1000, us: 1, ms: 0.001 }[unit];
  const complete = [], warnings = [], stacks = new Map(), processNames = new Map();
  const threadNames = new Map(), threadOrder = new Map(), unsupported = new Map();
  const key = e => JSON.stringify([e.pid ?? 0, e.tid ?? 0]);
  for (const e of trace) {
    if (!object(e)) continue;
    if (e.ph === 'M' && e.name === 'process_name') processNames.set(e.pid ?? 0, String(e.args?.name ?? e.pid ?? 0));
    if (e.ph === 'M' && e.name === 'thread_name') threadNames.set(key(e), String(e.args?.name ?? e.tid));
    if (e.ph === 'M' && e.name === 'thread_sort_index' && Number.isFinite(e.args?.sort_index)) threadOrder.set(key(e), e.args.sort_index);
    if (e.ph === 'X') complete.push(e);
    else if (['i', 'I'].includes(e.ph)) complete.push({ ...e, dur: 0, marker: true });
    else if (e.ph === 'B') { if (!stacks.has(key(e))) stacks.set(key(e), []); stacks.get(key(e)).push(e); }
    else if (e.ph === 'E') {
      const begin = stacks.get(key(e))?.pop();
      if (begin) complete.push({ ...begin, ph: 'X', dur: e.ts - begin.ts, args: { ...begin.args, ...e.args } });
      else warnings.push(`Unmatched E event on ${key(e)}`);
    } else if (e.ph !== 'M') unsupported.set(e.ph, (unsupported.get(e.ph) ?? 0) + 1);
  }
  for (const [phase, count] of unsupported) warnings.push(`Unsupported Chrome phase ${String(phase)}: ${count} event(s) skipped`);
  for (const stack of stacks.values()) if (stack.length) warnings.push(`${stack.length} unclosed B event(s) skipped`);
  if (!complete.length) throw new TraceValidationError(['traceEvents: no supported X, B/E or instant events']);
  let origin = Infinity;
  for (const e of complete) if (Number.isFinite(e.ts)) origin = Math.min(origin, e.ts);
  const topology = msinsightTopology(new Set(complete.map(e => e.pid ?? 0)), processNames);
  if (topology) complete.sort((a, b) => a.ts - b.ts);
  const cores = new Map(), lanes = new Map(), kernels = new Map(), tasks = new Map(), conflictingTasks = new Set();
  const getKernel = label => {
    if (!kernels.has(label)) kernels.set(label, { id: `kernel-${kernels.size}`, label });
    return kernels.get(label).id;
  };
  const events = complete.map((e, i) => {
    const pid = e.pid ?? 0, tid = e.tid ?? 0, laneKey = key(e);
    const processName = processNames.get(pid) ?? String(pid), threadName = threadNames.get(laneKey) ?? String(e.tid ?? 'UNKNOWN');
    const pipe = canonicalPipe(threadName);
    if (!lanes.has(laneKey)) {
      const id = `lane-${lanes.size}`, trace = { pid, tid, processName, threadName };
      if (threadOrder.has(laneKey)) trace.sortIndex = threadOrder.get(laneKey);
      if (topology) {
        const { core, engine } = topology.processes.get(pid);
        lanes.set(laneKey, { id, coreId: core.id, engineId: engine.id, engine: engine.type, pipe, label: pipe, trace });
      } else {
        if (!cores.has(pid)) cores.set(pid, { id: `core-${cores.size}`, label: processName || 'Trace process' });
        const engine = /cube|aic\b/i.test(processName) ? 'AIC' : /vec|aiv\b/i.test(processName) ? 'AIV' : 'TRACE';
        lanes.set(laneKey, { id, coreId: cores.get(pid).id, engine, pipe, label: pipe, trace });
      }
    }
    const lane = lanes.get(laneKey), kind = importedEventKind(e, lane, !!topology);
    const event = {
      id: `event-${i}`, laneId: lane.id, name: String(e.name ?? 'Unnamed'), kind,
      start: (e.ts - origin) * factor,
      duration: kind === 'marker' ? 0 : e.dur * factor,
      args: object(e.args) ? e.args : {},
      source: { pc: String(e.args?.pc_addr ?? ''), file: String(e.args?.code ?? '') },
    };
    if (topology) {
      const kernelName = e.args?.kernel ?? e.args?.kernel_name;
      const taskId = e.args?.taskId ?? e.args?.task_id;
      const hasTaskId = string(taskId) || Number.isSafeInteger(taskId);
      // The trace category carries drawing metadata, independent of the kernel or invocation.
      const taskKey = JSON.stringify(hasTaskId ? ['task', String(taskId)] : ['kernel', string(kernelName) ? kernelName : null]);
      if (!tasks.has(taskKey)) tasks.set(taskKey, { id: `task${tasks.size}` });
      const task = tasks.get(taskKey);
      if (string(kernelName)) {
        if (task.kernelId === undefined) task.kernelId = getKernel(kernelName);
        else if (task.kernelId !== kernels.get(kernelName)?.id) conflictingTasks.add(task.id);
      }
      event.taskId = task.id;
    } else event.kernelId = getKernel(String(e.args?.kernel ?? e.cat ?? 'Imported trace'));
    return event;
  });
  for (const id of conflictingTasks) warnings.push(`${id}: multiple kernel names for one source task ID; using the first name`);
  const document = {
    schemaVersion: topology ? '1.4' : '1.0',
    metadata: {
      title: options.title ?? (topology ? 'Imported msinsight trace' : 'Imported Chrome trace'),
      timeUnit: unit,
      timestampOrigin: String(origin),
      source: { kind: 'imported', format: topology ? 'msinsight trace.json' : 'Chrome Trace Event', timestampUnit: 'us' },
    },
    ...(topology ? { devices: topology.devices, tasks: [...tasks.values()] } : {}),
    cores: topology?.cores ?? [...cores.values()],
    lanes: [...lanes.values()],
    kernels: [...kernels.values()],
    scenarios: [{ id: 'imported', label: 'Imported trace', events, dependencies: [], regions: [] }],
  };
  const parsed = parseTrace(document);
  return { document: parsed.document, warnings: [...warnings, ...parsed.warnings] };
}

export function loadTrace(input, options = {}) {
  let raw;
  try { raw = typeof input === 'string' ? JSON.parse(input) : input; }
  catch (error) { throw new TraceValidationError([`JSON: ${error.message}`]); }
  return Array.isArray(raw) || (object(raw) && 'traceEvents' in raw) ? importChromeTrace(raw, options) : parseTrace(raw);
}
