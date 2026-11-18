import { loadTrace, traceStats, layoutEvents, outstandingWindow, traceTasks, taskSummaries, taskOverlaps, intervalLength, eventCoreIds, phaseDependencies, phaseStats } from './model.js';
import { styles } from './component-style.js';
import { icon, escapeHtml as esc } from './icons.js';

const COLORS = ['#1b9c85', '#6d71d5', '#cb9353', '#438ac7', '#bb719e', '#6c9a46'];
const KIND = { transfer: '数据搬运', compute: '计算', wait: '同步等待', marker: '瞬时事件', allocation: '内存分配', schedule: '取指前调度', fetch: '指令取指' };
const fmt = value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(value);
const percent = value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
const clamp = (value, a, b) => Math.max(a, Math.min(b, value));
const textWidth = text => [...text].reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 11 : 6), 0);

export class PipeTimeline extends HTMLElement {
  static observedAttributes = ['theme'];
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.hiddenKernels = new Set();
    this.hiddenTasks = new Set();
    this.selectedCoreIds = new Set();
    this.showOverlaps = true;
    this.collapsedLanes = new Set();
    this.collapsedGroups = new Set();
    this.query = '';
    this.selectedId = null;
    this.showDependencies = false;
    this.measureMode = false;
    this.tab = 'events';
    this.view = [0, 1];
    this._resize = new ResizeObserver(() => this.scheduleDraw());
  }
  connectedCallback() {
    if (!this.hasAttribute('tabindex')) this.tabIndex = 0;
    if (!this._built) this.build();
    this._resize.observe(this);
    if (this._document) this.refresh();
  }
  disconnectedCallback() {
    this._resize.disconnect();
    cancelAnimationFrame(this._frame);
  }
  attributeChangedCallback() { if (this._built) { this.scheduleDraw(); this.drawOverview(); } }
  get data() { return this._document ? structuredClone(this._document) : null; }
  set data(value) { this.load(value); }
  get scenario() { return this._document?.scenarios.find(s => s.id === this.scenarioId); }
  get unit() { return this._document?.metadata.timeUnit === 'us' ? 'μs' : this._document?.metadata.timeUnit ?? ''; }
  get coreIds() { return [...this.selectedCoreIds]; }
  get coreId() { return this.coreIds[0]; }
  get network() { return ['1.1', '1.2', '1.3'].includes(this._document?.schemaVersion); }
  get coreTerm() { return this.network ? '物理核' : 'Core'; }
  get lanes() {
    if (!this._document) return [];
    const cores = this._document.cores.filter(c => this.selectedCoreIds.has(c.id)), devices = new Set(cores.map(c => c.deviceId));
    const rank = lane => lane.engine === 'SCHEDULER' ? 0 : lane.role === 'fetch' ? 1 : lane.engine === 'AIC' ? 2 : 3;
    return [...this._document.lanes.filter(l => l.coreId === undefined && devices.has(l.deviceId)), ...cores.flatMap(c => this._document.lanes.filter(l => l.coreId === c.id).sort((a,b) => rank(a)-rank(b)))];
  }
  get scenarioEvents() { return this.scenario?.events.map(e => this.network ? e : { ...e, taskId: e.kernelId }) ?? []; }
  get dependencies() { return phaseDependencies(this.scenario); }
  get taskEvents() { return this.coreEvents.filter(e => !this.hiddenTasks.has(e.taskId) && !this.hiddenKernels.has(e.kernelId)); }
  get overlaps() { return taskOverlaps(this.taskEvents); }
  get overlapEntries() {
    return [
      ...this.overlaps.map(region => ({ ...region, scope: '所选核合并' })),
      ...this._document.cores.filter(c => this.selectedCoreIds.has(c.id)).flatMap(core => taskOverlaps(this.taskEvents.filter(e => this.laneMap.get(e.laneId).coreId === core.id)).map(region => ({ ...region, coreId: core.id, scope: core.label }))),
    ];
  }
  eventColor(event) {
    if (event.kind === 'schedule') return this.getAttribute('theme') === 'dark' ? '#e3b777' : '#ae762e';
    if (event.kind === 'fetch') return this.getAttribute('theme') === 'dark' ? '#b4a2ee' : '#8771bb';
    return this.taskMap.get(event.taskId)?.color ?? this.kernelMap.get(event.kernelId)?.color ?? COLORS[0];
  }
  eventCoreLabel(event) {
    const ids = eventCoreIds(event, this.laneMap, this.eventMap);
    return this._document.cores.filter(c => ids.includes(c.id)).map(c => c.label).join(' + ');
  }
  get selectedCoreLabel() { return this._document.cores.filter(c => this.selectedCoreIds.has(c.id)).map(c => c.label).join(', '); }
  get coreEvents() {
    const events = this.scenarioEvents, map = new Map(events.map(e => [e.id,e]));
    return events.filter(e => eventCoreIds(e, this.laneMap, map).some(id => this.selectedCoreIds.has(id)));
  }
  get regions() { return this.scenario?.regions?.filter(r => (!r.coreId || this.selectedCoreIds.has(r.coreId)) && (!r.taskIds || r.taskIds.every(id => !this.hiddenTasks.has(id)))) ?? []; }
  get filteredEvents() { return this.taskEvents.filter(e => this.matches(e)); }
  /** Key of the core/device block a pipe belongs to; the group header collapses by this key. */
  groupKeyOf(lane) { return lane ? String(lane.coreId ?? `device:${lane.deviceId}`) : ''; }
  rowsOf(laneId) { return this.layout?.rowInfo.get(laneId) ?? []; }
  rowDepth(laneId) { return this.rowsOf(laneId).length || 1; }
  laneCollapsed(laneId) {
    const lane = this.laneMap?.get(laneId);
    return this.collapsedLanes.has(laneId) || (!!lane && this.collapsedGroups.has(this.groupKeyOf(lane)));
  }
  visibleRowCount(laneId) { return this.laneCollapsed(laneId) ? 1 : this.rowDepth(laneId); }
  visibleRowTotal() { return this.lanes.reduce((total, lane) => total + this.visibleRowCount(lane.id), 0); }
  collapsedLaneTotal() { return this.lanes.filter(lane => this.laneCollapsed(lane.id) && this.rowDepth(lane.id) > 1).length; }
  toggleLane(laneId) {
    if (!this.laneMap?.has(laneId)) return;
    if (this.collapsedLanes.has(laneId)) this.collapsedLanes.delete(laneId); else this.collapsedLanes.add(laneId);
    this.refresh();
    this.emit('lane-collapse', { laneId, collapsed: this.laneCollapsed(laneId) });
  }
  toggleGroup(groupKey) {
    if (!groupKey) return;
    if (this.collapsedGroups.has(groupKey)) this.collapsedGroups.delete(groupKey); else this.collapsedGroups.add(groupKey);
    this.refresh();
    this.emit('group-collapse', { groupKey, collapsed: this.collapsedGroups.has(groupKey) });
  }
  collapseAll() {
    if (!this.lanes.length) return;
    for (const lane of this.lanes) this.collapsedLanes.add(lane.id);
    this.refresh();
  }
  expandAll() {
    if (!this.collapsedLanes.size && !this.collapsedGroups.size) return;
    this.collapsedLanes.clear();
    this.collapsedGroups.clear();
    this.refresh();
  }
  laneAtY(y) {
    const rows = this.geometry?.rows;
    if (!rows) return null;
    for (const lane of this.lanes) {
      const row = rows.get(lane.id);
      if (row && y >= row.y && y < row.y + row.height) return lane;
    }
    return null;
  }
  matches(e) {
    if (!this.query) return true;
    const lane = this.laneMap.get(e.laneId), kernel = this.kernelMap.get(e.kernelId);
    return `${e.name} ${e.id} ${e.taskId ?? ''} ${this.taskMap.get(e.taskId)?.label ?? ''} ${e.blockId ?? ''} ${lane?.coreId} ${lane?.pipe} ${lane?.engine} ${kernel?.label} ${JSON.stringify(e.args ?? {})}`.toLowerCase().includes(this.query.toLowerCase());
  }
  emit(name, detail) { this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true })); }
  load(input, options) {
    try {
      const { document, warnings } = loadTrace(input, options);
      this._document = document;
      this.warnings = warnings;
      this.laneMap = new Map(document.lanes.map(l => [l.id, l]));
      this.kernelMap = new Map(document.kernels.map((k, i) => [k.id, { ...k, color: k.color ?? COLORS[i % COLORS.length] }]));
      this.scenarioId = document.scenarios[0].id;
      this.taskMap = new Map(traceTasks(document).map((task, i) => [task.id, { ...task, color: task.color ?? COLORS[i % COLORS.length] }]));
      this.laneCapacity = new Map(document.lanes.filter(lane => lane.issueWidth !== undefined).map(lane => [lane.id, lane.issueWidth]));
      this.selectedCoreIds = new Set(document.cores.map(c => c.id));
      this.hiddenTasks.clear();
      this.hiddenKernels.clear();
      this.collapsedLanes.clear();
      this.collapsedGroups.clear();
      this.query = '';
      this.selectedId = null;
      this.measurement = null;
      this.resetView(false);
      if (this._built) this.refresh();
      this.emit('trace-load', { metadata: structuredClone(document.metadata), schemaVersion: document.schemaVersion, warnings: [...warnings] });
      return { warnings: [...warnings] };
    } catch (error) {
      this.emit('trace-error', { message: error.message, errors: error.errors ?? [error.message] });
      throw error;
    }
  }
  async loadFromUrl(url, options) {
    const response = await fetch(url, { signal: options?.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    return this.load(await response.text(), options);
  }
  setScenario(id) {
    if (!this._document?.scenarios.some(s => s.id === id)) throw new Error(`Unknown scenario: ${id}`);
    this.scenarioId = id;
    this.selectedId = null;
    this.measurement = null;
    this.resetView(false);
    this.refresh();
    this.emit('scenario-change', { scenarioId: id });
  }
  setCore(id) { this.setCores([id]); }
  setCores(ids) {
    if (!Array.isArray(ids) || !ids.length || ids.some(id => !this._document?.cores.some(c => c.id === id))) throw new Error('setCores requires at least one known physical core ID');
    this.selectedCoreIds = new Set(ids);
    this.selectedId = null;
    this.measurement = null;
    this.resetView(false);
    this.refresh();
    this.emit('core-change', { coreId: this.coreId, coreIds: this.coreIds });
  }
  setTasks(ids) {
    if (!Array.isArray(ids) || ids.some(id => !this.taskMap.has(id))) throw new Error('setTasks requires known task IDs');
    this.hiddenTasks = new Set([...this.taskMap.keys()].filter(id => !ids.includes(id)));
    this.refresh();
    this.emit('task-change', { taskIds: [...this.taskMap.keys()].filter(id => !this.hiddenTasks.has(id)) });
  }
  focusRange(start, end) {
    const pad = Math.max((end - start) * .25, (this.extent[1] - this.extent[0]) / 100);
    this.setView(start - pad, end + pad);
  }
  resetView(notify = true) {
    const stats = traceStats(this.coreEvents, this.lanes, this.regions);
    const pad = (stats.duration || 1) * .025;
    this.extent = [Math.max(0, stats.start - pad), Math.max(stats.end + pad, stats.start + 1e-6)];
    this.view = [...this.extent];
    if (notify) { this.measurement = null; this.updateView(); }
  }
  setView(start, end) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    const total = this.extent[1] - this.extent[0];
    const width = clamp(end - start, Math.max(total / 1e6, Number.EPSILON * Math.max(1, this.extent[1]) * 8), total);
    const left = clamp(start, this.extent[0], this.extent[1] - width);
    this.view = [left, left + width];
    this.updateView();
  }
  zoom(factor, pivot = (this.view[0] + this.view[1]) / 2) {
    this.setView(pivot + (this.view[0] - pivot) * factor, pivot + (this.view[1] - pivot) * factor);
  }
  updateView() {
    this.scheduleDraw();
    this.drawOverview();
    this.updateFooter();
    this.emit('viewport-change', { start: this.view[0], end: this.view[1], timeUnit: this._document.metadata.timeUnit });
  }
  selectEvent(id, focus = false) {
    const event = this.scenarioEvents.find(e => e.id === id);
    if (id && !event) return;
    this.selectedId = id;
    if (event) {
      const lane = this.laneMap.get(event.laneId);
      const targets = eventCoreIds(event, this.laneMap, this.eventMap);
      if (!targets.some(id => this.selectedCoreIds.has(id))) {
        targets.forEach(id => this.selectedCoreIds.add(id)); this.resetView(false); this.refresh();
        this.emit('core-change', { coreId: this.coreId, coreIds: this.coreIds });
      }
      if (focus && (event.start < this.view[0] || event.start + event.duration > this.view[1])) {
        const span = Math.max(event.duration * 3, (this.view[1] - this.view[0]) / 2);
        this.setView(event.start - span * .2, event.start + span * .8);
      }
      if (focus) this._focusLaneId = event.laneId;
      if (this.hiddenTasks.has(event.taskId) || this.hiddenKernels.has(event.kernelId)) {
        this.hiddenTasks.delete(event.taskId);
        this.hiddenKernels.delete(event.kernelId);
        this.refresh();
      }
      this.emit('event-select', { event: structuredClone(event), lane: structuredClone(lane), scenarioId: this.scenarioId });
    }
    this.drawInspector();
    this.drawTable();
    this.scheduleDraw();
  }
  build() {
    this._built = true;
    this.shadowRoot.innerHTML = `<style>${styles}</style>
      <div class="empty-document">设置 data 属性或调用 load() 导入流水数据</div>
      <div class="application" hidden>
        <div class="stats"></div>
        <section class="panel">
          <div class="panel-head"><div class="panel-title"><span class="live"></span>执行时间线<small class="lane-count"></small></div><div class="scenarios" role="group" aria-label="选择场景"></div></div>
          <div class="warnings" hidden></div>
          <div class="toolbar">
            <details class="core-picker"><summary aria-label="选择多个物理核"><span class="core-summary"></span><span>⌄</span></summary><div class="core-popover"><div class="core-quick"><strong>Core</strong><button data-action="all-cores">全选</button><button data-action="one-core">仅当前核</button></div><div class="core-options"></div><p>每核 = 1 Cube + 1 Vector · 至少选择一核</p></div></details>
            <label class="search">${icon('search', 15)}<input type="search" placeholder="搜索事件、Pipe、参数…" aria-label="搜索事件"><span class="key">/</span></label>
            <span class="spacer"></span>
            <button data-action="overlaps" title="标注不同 task 的计算与搬运区间重叠" aria-pressed="true">${icon('overlap', 15)}<span class="tool-text">Task overlap</span></button><button data-action="dependencies" title="显示全部依赖连线；选中事件时始终显示其直接依赖" aria-pressed="false">${icon('link', 15)}<span class="tool-text">依赖连线</span></button>
            <button data-action="measure" title="测量时间：点击后拖动，或按住 Shift 拖动" aria-pressed="false">${icon('ruler', 15)}<span class="tool-text">测量</span></button>
            <div class="tool-group"><button data-action="collapse-all" aria-label="折叠全部 Pipe" title="折叠全部 Pipe 的多行">${icon('collapse', 15)}</button><button data-action="expand-all" aria-label="展开全部 Pipe" title="展开全部 Pipe">${icon('expand', 15)}</button></div>
            <span class="separator"></span>
            <div class="tool-group"><button data-action="zoom-out" aria-label="缩小" title="缩小 (S)">${icon('minus', 15)}</button><button data-action="zoom-in" aria-label="放大" title="放大 (W)">${icon('plus', 15)}</button><button data-action="fit" aria-label="适应全部" title="适应全部 (F)">${icon('fit', 15)}</button></div>
          </div>
          <div class="task-filters"></div><div class="filters"></div><div class="phase-summary" hidden></div>
          <div class="workspace"><div class="timeline-shell"><div class="network-overview" aria-label="整网 Task 与跨 Task 重叠概览"></div><div class="chart-scroll"><div class="chart" data-mode="pan"></div></div><div class="overview"><span class="overview-label">OVERVIEW</span><svg aria-label="时间轴概览，拖动调整视口" role="img"></svg></div><div class="chart-footer"><span>${icon('info', 12)}</span><span class="interaction-hint">拖动平移 · Ctrl + 滚轮缩放 · Shift + 拖动测量 · 双击 Pipe 名折叠</span><span class="window"></span></div></div><aside class="inspector" aria-label="事件详情"></aside></div>
        </section>
        <section class="lower"><div class="tabs"><button data-tab="events" class="active">${icon('table', 14)}事件列表 <span class="count"></span></button><button data-tab="overlaps">${icon('overlap', 14)}Task 重叠 <span class="overlap-count"></span></button><button data-tab="phases">${icon('clock',14)}调度 / 取指 <span class="phase-count"></span></button><button data-tab="pipes">${icon('activity', 14)}Pipe 概览</button><span class="spacer"></span><span class="muted" style="font-size:10px">完整场景统计 · 可点击事件定位</span></div><div class="table-scroll"></div></section>
      </div><div class="tooltip" hidden></div>`;
    this.$ = selector => this.shadowRoot.querySelector(selector);
    this.$('.core-options').addEventListener('change', e => {
      const ids = [...this.shadowRoot.querySelectorAll('[data-core]:checked')].map(el => el.dataset.core);
      if (!ids.length) { e.target.checked = true; return; }
      this.setCores(ids);
    });
    this.$('.search input').addEventListener('input', e => { this.query = e.target.value; this.scheduleDraw(); this.drawTable(); });
    this.shadowRoot.addEventListener('click', e => {
      if (!e.target.closest('.core-picker')) this.$('.core-picker').open = false;
      const rowToggle = e.target.closest('[data-row-toggle]');
      if (rowToggle) { if (e.detail > 1) return; this.toggleLane(rowToggle.dataset.rowToggle); return; }
      const groupToggle = e.target.closest('[data-group-toggle]');
      if (groupToggle) { if (e.detail > 1) return; this.toggleGroup(groupToggle.dataset.groupToggle); return; }
      const scenario = e.target.closest('[data-scenario]');
      if (scenario) this.setScenario(scenario.dataset.scenario);
      const chip = e.target.closest('[data-kernel]');
      if (chip) {
        const id = chip.dataset.kernel;
        if (this.hiddenKernels.has(id)) this.hiddenKernels.delete(id); else this.hiddenKernels.add(id);
        chip.setAttribute('aria-pressed', !this.hiddenKernels.has(id));
        this.refresh();
      }
      const task = e.target.closest('[data-task-filter]');
      if (task) {
        const id = task.dataset.taskFilter;
        if (this.hiddenTasks.has(id)) this.hiddenTasks.delete(id); else this.hiddenTasks.add(id);
        this.refresh();
        this.emit('task-change', { taskIds: [...this.taskMap.keys()].filter(id => !this.hiddenTasks.has(id)) });
      }
      const range = e.target.closest('[data-range-start]');
      if (range) this.focusRange(Number(range.dataset.rangeStart), Number(range.dataset.rangeEnd));
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'all-cores') this.setCores(this._document.cores.map(c => c.id));
      if (action === 'one-core') this.setCore(this.coreId);
      if (action === 'all-tasks') this.setTasks([...this.taskMap.keys()]);
      if (action === 'overlaps') { this.showOverlaps = !this.showOverlaps; this.$('[data-action=overlaps]').setAttribute('aria-pressed', this.showOverlaps); this.scheduleDraw(); }
      if (action === 'fit') this.resetView();
      if (action === 'zoom-in') this.zoom(.65);
      if (action === 'zoom-out') this.zoom(1.5);
      if (action === 'dependencies') { this.showDependencies = !this.showDependencies; this.$('[data-action=dependencies]').setAttribute('aria-pressed', this.showDependencies); this.scheduleDraw(); }
      if (action === 'measure') { this.measureMode = !this.measureMode; this.$('[data-action=measure]').setAttribute('aria-pressed', this.measureMode); this.$('.chart').dataset.mode = this.measureMode ? 'measure' : 'pan'; }
      if (action === 'collapse-all') this.collapseAll();
      if (action === 'expand-all') this.expandAll();
      if (action === 'deselect') this.selectEvent(null);
      const tab = e.target.closest('[data-tab]');
      if (tab) { this.tab = tab.dataset.tab; this.shadowRoot.querySelectorAll('[data-tab]').forEach(t => t.classList.toggle('active', t === tab)); this.drawTable(); }
      const select = e.target.closest('[data-select]');
      if (select) this.selectEvent(select.dataset.select, true);
    });
    this.addEventListener('keydown', e => {
      if (!this._document || /INPUT|TEXTAREA|SELECT/.test(e.composedPath()[0]?.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === '/') { e.preventDefault(); this.$('.search input').focus(); }
      if (key === 'f') { e.preventDefault(); this.resetView(); }
      if (key === 'w' || key === '+') { e.preventDefault(); this.zoom(.7); }
      if (key === 's' || key === '-') { e.preventDefault(); this.zoom(1.4); }
      if (['a', 'd', 'arrowleft', 'arrowright'].includes(key)) { e.preventDefault(); const d = (this.view[1]-this.view[0]) * (['a','arrowleft'].includes(key) ? -.2 : .2); this.setView(this.view[0]+d, this.view[1]+d); }
      if (key === 'escape') { this.measurement = null; this.selectEvent(null); this.updateFooter(); }
      if (key === 'enter' || key === ' ') {
        const element = e.composedPath().find(n => n?.dataset?.event);
        if (element) { e.preventDefault(); this.selectEvent(element.dataset.event); }
        const range = e.composedPath().find(n => n?.dataset?.rangeStart);
        if (range) { e.preventDefault(); this.focusRange(Number(range.dataset.rangeStart), Number(range.dataset.rangeEnd)); }
        const rowToggle = e.composedPath().find(n => n?.dataset?.rowToggle);
        if (rowToggle) { e.preventDefault(); this.toggleLane(rowToggle.dataset.rowToggle); }
        const groupToggle = e.composedPath().find(n => n?.dataset?.groupToggle);
        if (groupToggle) { e.preventDefault(); this.toggleGroup(groupToggle.dataset.groupToggle); }
      }
    });
    this.bindChart();
  }
  refresh() {
    if (!this._built || !this._document) return;
    this.$('.empty-document').hidden = true;
    this.$('.application').hidden = false;
    this.$('.search input').value = this.query;
    // Rows must be laid out before the header counts them.
    this.layout = layoutEvents(this.taskEvents, { capacity: this.laneCapacity });
    this.$('.core-summary').textContent = `${this.selectedCoreIds.size} / ${this._document.cores.length} ${this.coreTerm}`;
    this.$('.core-popover > p').textContent = this.network ? '每核 = 1 Cube + 1 Vector · 至少选择一核' : '旧版逻辑 Core 分组 · 至少选择一项';
    const devices = this._document.devices ?? [{ id: null, label: 'Cores' }];
    this.$('.core-options').innerHTML = devices.map(device => `<div class="device-name">${esc(device.label)}</div>${this._document.cores.filter(c => !device.id || c.deviceId === device.id).map(c => `<label class="core-option"><input type="checkbox" data-core="${esc(c.id)}" ${this.selectedCoreIds.has(c.id) ? 'checked' : ''}><span><strong>${esc(c.label)}</strong><small>${esc(this.network ? `${c.cubeId} + ${c.vectorId}` : 'Original trace grouping')}</small></span><span class="engine-ratio">${this.network ? '1:1' : 'TRACE'}</span></label>`).join('')}`).join('');
    this.$('.scenarios').innerHTML = this._document.scenarios.map(s => `<button data-scenario="${esc(s.id)}" class="${s.id === this.scenarioId ? 'active' : ''}" aria-pressed="${s.id === this.scenarioId}">${esc(s.label)}</button>`).join('');
    this.$('.lane-count').textContent = `${this.selectedCoreIds.size} ${this.coreTerm} · ${this.lanes.length} 条 Pipe · ${this.visibleRowTotal()} 行${this.collapsedLaneTotal() ? `（${this.collapsedLaneTotal()} 条已折叠）` : ''}${this.network ? ' · Cube / Vector 1:1' : ' · 旧版分组'}`;
    const collapsible = this.lanes.some(lane => this.rowDepth(lane.id) > 1);
    for (const action of ['collapse-all', 'expand-all']) {
      const button = this.$(`[data-action=${action}]`);
      if (!button) continue;
      button.disabled = !collapsible;
      button.title = collapsible
        ? action === 'collapse-all' ? '折叠全部 Pipe 的多行' : '展开全部 Pipe'
        : '当前数据每个 Pipe 只有 1 行，没有可折叠的槽位';
    }
    this.$('.task-filters').innerHTML = `<span class="hint">Task</span>${[...this.taskMap.values()].map(t => `<button class="chip" data-task-filter="${esc(t.id)}" aria-pressed="${!this.hiddenTasks.has(t.id)}" title="${esc(this.kernelMap.get(t.kernelId)?.label)}"><i class="dot" style="background:${t.color}"></i>${esc(t.label)} <span class="task-kernel">${esc(this.kernelMap.get(t.kernelId)?.label)}</span></button>`).join('')}<button class="chip" data-action="all-tasks">显示全部</button>`;
    this.$('.filters').innerHTML = `<span class="hint">Kernel</span>${[...this.kernelMap.values()].map(k => `<button class="chip" data-kernel="${esc(k.id)}" aria-pressed="${!this.hiddenKernels.has(k.id)}"><i class="dot" style="background:${k.color}"></i>${esc(k.label)}</button>`).join('')}<span class="tail"><span><i class="swatch-flight"></i>Outstanding</span><span><i class="swatch-wait"></i>等待</span><span><i class="diamond"></i>同步点</span></span>`;
    const warning = this.$('.warnings');
    warning.hidden = !this.warnings.length;
    warning.innerHTML = this.warnings.length ? `<details><summary>${this.warnings.length} 条导入提示</summary><pre>${esc(this.warnings.join('\n'))}</pre></details>` : '';
    this.stats = traceStats(this.coreEvents, this.lanes, this.overlaps);
    this.eventMap = new Map(this.scenarioEvents.map(e => [e.id, e]));
    this.drawStats();
    this.drawPhaseSummary();
    this.drawInspector();
    this.drawTable();
    this.scheduleDraw();
    this.drawOverview();
    this.updateFooter();
  }
  drawStats() {
    const s = this.stats, doc = this._document;
    const baseline = doc.scenarios.find(s => s.id === 'baseline');
    const baseStats = baseline ? traceStats(baseline.events.filter(e => this.selectedCoreIds.has(this.laneMap.get(e.laneId).coreId)), this.lanes) : null;
    const saving = baseStats?.duration > s.duration ? (1-s.duration/baseStats.duration)*100 : null;
    const values = [
      ['clock', '场景总时长', fmt(s.duration), this.unit, saving !== null ? `↘ ${percent(saving)}% · 相较 Baseline` : '所选物理核 · 完整时间跨度', saving !== null],
      ['activity', '平均 Pipe 活跃率', percent(s.activeRate*100), '%', '计算 / 搬运区间并集 · 不含等待'],
      ['overlap', '跨 Task 重叠', fmt(s.overlap), this.unit, '所选核 · 已显示 Task 的执行区间并集'],
      ['layers', '流水事件', fmt(s.count), 'events', `${this.selectedCoreIds.size} ${this.coreTerm} · ${this.taskMap.size} 个 Task`],
    ];
    this.$('.stats').innerHTML = values.map(([ic, label, value, unit, note, positive]) => `<div class="stat"><div class="stat-label">${label}${icon(ic, 16)}</div><div class="stat-value">${value}<small>${unit}</small></div><div class="stat-note ${positive ? 'positive' : ''}">${esc(note)}</div></div>`).join('');
  }
  drawPhaseSummary() {
    const stats = phaseStats(this.taskEvents), area = this.$('.phase-summary');
    area.hidden = !stats.scheduleCount && !stats.fetchCount;
    area.innerHTML = `<span class="phase-badge scheduling"><i></i>取指前调度 <strong>${fmt(stats.scheduleDuration)} ${this.unit}</strong><small>${stats.scheduleCount} 段</small></span><span class="phase-badge fetching"><i></i>指令取指 <strong>${fmt(stats.fetchDuration)} ${this.unit}</strong><small>${stats.fetchCount} 次</small></span><span class="phase-note">所选 Core / Task · 各阶段时间取并集，间隔不计入 · 不计入计算 Pipe 活跃时间</span>`;
  }
  palette() {
    return this.getAttribute('theme') === 'dark' ? { bg: '#14212f', row: '#172534', grid: '#263749', text: '#d9e6f0', muted: '#8a9caf', region: '#5ccdad', wait: '#233649', waitLine: '#5c7288' } : { bg: '#ffffff', row: '#fafbfc', grid: '#ecf0f4', text: '#344357', muted: '#8996a7', region: '#269d82', wait: '#f1f3f6', waitLine: '#b9c4d0' };
  }
  scheduleDraw() { cancelAnimationFrame(this._frame); this._frame = requestAnimationFrame(() => this.draw()); }
  draw() {
    if (!this._built || !this._document) return;
    const el = this.$('.chart'), width = el.clientWidth || 850, left = 148, right = 16, top = 38;
    const plotWidth = width-left-right;
    if (plotWidth <= 0) return;
    const [start, end] = this.view;
    const scale = t => left+(t-start)/(end-start)*plotWidth;
    let y = top;
    const rows = new Map(), groups = [];
    let previousEngine, previousCore;
    for (const lane of this.lanes) {
      const groupKey = this.groupKeyOf(lane);
      const coreChange = previousCore !== groupKey;
      if (coreChange) { groups.push({ y, coreId: lane.coreId, deviceId: lane.deviceId, key: groupKey }); y += 29; previousEngine = undefined; }
      const engineChange = previousEngine !== undefined && previousEngine !== lane.engine;
      if (engineChange) y += 13;
      const depth = this.rowDepth(lane.id), collapsed = this.laneCollapsed(lane.id);
      const visible = collapsed ? 1 : depth, pad = depth > 1 && !collapsed ? 17 : 12;
      const height = Math.max(43, pad+visible*29+2);
      rows.set(lane.id, { y, height, pad, depth, visible, collapsed, engineChange });
      y += height;
      previousEngine = lane.engine;
      previousCore = groupKey;
    }
    const height = y+14, p = this.palette();
    this.$('.workspace').style.setProperty('--pa-inspector-height', `${Math.min(height,585)+155+this.taskMap.size*24}px`);
    this.geometry = { width, height, left, right, plotWidth, top, rows, scale };
    const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(this._document.metadata.title)} · ${esc(this.scenario.label)}" font-family="Inter,Segoe UI,Microsoft YaHei,sans-serif"><defs><clipPath id="plot-clip"><rect x="${left}" y="0" width="${plotWidth}" height="${height}"/></clipPath><pattern id="wait-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(40)"><rect width="5" height="5" fill="${p.wait}"/><path d="M0 0v5" stroke="${p.waitLine}" stroke-width="1"/></pattern><pattern id="schedule-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="${p.bg}"/><rect width="6" height="6" fill="${this.eventColor({kind:'schedule'})}" fill-opacity=".1"/><path d="M0 0v6" stroke="${this.eventColor({kind:'schedule'})}" stroke-opacity=".35" stroke-width="1.2"/></pattern><marker id="arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto-start-reverse"><path d="M0 0L6 3L0 6" fill="none" stroke="${p.muted}" stroke-width="1.2"/></marker></defs><rect width="${width}" height="${height}" fill="${p.bg}"/>`];
    let index = 0;
    for (const lane of this.lanes) {
      const r = rows.get(lane.id), busy = this.stats.duration ? (this.stats.laneBusy.get(lane.id) ?? 0)/this.stats.duration : 0;
      out.push(`<rect x="0" y="${r.y}" width="${width}" height="${r.height}" fill="${index++%2 ? p.bg : p.row}"/><path d="M0 ${r.y+r.height}H${width}" stroke="${p.grid}"/>`);
      if (r.engineChange) out.push(`<path d="M0 ${r.y-6}H${width}" stroke="${p.grid}" stroke-dasharray="3 3"/>`);
      const detail = lane.engine === 'SCHEDULER' ? 'PRE-FETCH SCHEDULING' : lane.role === 'fetch' ? `${lane.engine} · INSTRUCTION FETCH` : `${lane.engine} · ${percent(busy*100)}%`;
      if (r.depth > 1) {
        const labelX = 26, arrow = `<path d="M0 -4.5 7 0 0 4.5Z" transform="translate(7 ${r.y+9}) rotate(${r.collapsed ? 0 : 90})" fill="${r.collapsed ? p.muted : p.text}"/>`;
        out.push(`<g class="lane-toggle" data-row-toggle="${esc(lane.id)}" role="button" tabindex="0" aria-expanded="${!r.collapsed}" aria-label="${r.collapsed ? '展开' : '折叠'} ${esc(lane.label)} 的 ${r.depth} 行"><title>${r.collapsed ? '展开' : '折叠'} ${esc(lane.label)} · ${r.depth} 行 · ${esc(detail)}</title><rect x="2" y="${r.y+1}" width="17" height="15" fill="transparent"/>${arrow}</g>`);
        const badge = r.collapsed ? `${r.depth} 行 · 已折叠` : `${r.depth} 行`;
        const available = left-12-labelX-8-textWidth(badge)*(8.5/10.5)-12;
        let label = lane.label;
        if (textWidth(label) > available) { const count = Math.max(0, Math.floor(available/6)-1); label = count > 2 ? [...label].slice(0, count).join('')+'…' : ''; }
        out.push(`<text x="${labelX}" y="${r.y+13}" fill="${p.text}" font-size="10.5" font-weight="600">${esc(label)}</text><text x="${left-10}" y="${r.y+13}" text-anchor="end" fill="${r.collapsed ? p.muted : p.region}" font-family="Consolas,monospace" font-size="8.5">${esc(badge)}</text>`);
        if (!r.collapsed) {
          this.rowsOf(lane.id).forEach((row, i) => {
            const centerY = r.y+r.pad+10+i*29;
            if (i > 0) out.push(`<path d="M${labelX} ${r.y+r.pad+i*29}H${left-12}" stroke="${p.grid}" stroke-dasharray="2 2"/>`);
            out.push(`<text x="${labelX}" y="${centerY+3}" fill="${p.muted}" font-size="8" font-family="Consolas,monospace" opacity="${row.idle ? .5 : 1}">O${i+1}</text>`);
            out.push(`<text x="${labelX+20}" y="${centerY+3}" fill="${p.muted}" font-size="8.5" opacity="${row.idle ? .5 : 1}">${esc(row.idle ? '空闲' : `${row.count} 条`)}</text>`);
          });
        }
      } else {
        let label = lane.label;
        if (textWidth(label) > left-28) { const count = Math.max(0, Math.floor((left-28)/6)-1); label = count > 2 ? [...label].slice(0, count).join('')+'…' : ''; }
        out.push(`<text x="16" y="${r.y+18}" fill="${p.text}" font-size="10.5" font-weight="600">${esc(label)}</text><text x="16" y="${r.y+32}" fill="${p.muted}" font-family="Consolas,monospace" font-size="7.8">${esc(detail)}</text>`);
      }
    }
    for (const group of groups) {
      const core = this._document.cores.find(c => c.id === group.coreId);
      const device = this._document.devices?.find(d => d.id === (core?.deviceId ?? group.deviceId));
      const context = !core ? '共享调度资源 · 调度阶段先于目标核取指' : this.network ? `${device?.label ?? 'NPU'} · ${core.cubeId} + ${core.vectorId} · Cube / Vector 1:1` : 'Imported / legacy Core grouping';
      const groupMulti = this.lanes.some(lane => this.groupKeyOf(lane) === group.key && this.rowDepth(lane.id) > 1), groupCollapsed = this.collapsedGroups.has(group.key);
      const toggle = groupMulti ? `<g class="lane-toggle" data-group-toggle="${esc(group.key)}" role="button" tabindex="0" aria-expanded="${!groupCollapsed}" aria-label="${groupCollapsed ? '展开' : '折叠'}该核全部 Pipe 的多行"><title>${groupCollapsed ? '展开' : '折叠'}该核全部 Pipe 的多行</title><path d="M0 -4.5 7 0 0 4.5Z" transform="translate(7 ${group.y+10}) rotate(${groupCollapsed ? 0 : 90})" fill="${groupCollapsed ? p.muted : p.text}"/><rect x="2" y="${group.y+3}" width="17" height="15" fill="transparent"/></g>` : '';
      out.push(`<rect x="0" y="${group.y}" width="${width}" height="27" fill="${p.row}"/><path d="M0 ${group.y}H${width}" stroke="${p.grid}"/><text x="${groupMulti ? 26 : 16}" y="${group.y+18}" fill="${p.text}" font-size="11" font-weight="600">${esc(core?.label ?? `${device?.label} 调度`)}</text><text x="${left+8}" y="${group.y+18}" fill="${p.muted}" font-size="9">${esc(context)}</text>${toggle}`);
    }
    out.push(`<path d="M${left-1} 0V${height}" stroke="${p.grid}"/><text x="16" y="22" fill="${p.muted}" font-family="Consolas,monospace" font-size="9">PIPE / ${esc(this.unit)}</text><g clip-path="url(#plot-clip)">`);
    const rawStep = (end-start)/Math.max(3, Math.floor(plotWidth/85));
    const magnitude = 10**Math.floor(Math.log10(rawStep));
    const step = [1,2,5,10].find(x => x*magnitude >= rawStep)*magnitude;
    const precision = Math.max(0, Math.min(10, -Math.floor(Math.log10(step))));
    let tickCount = 0;
    for (let tick = Math.ceil(start/step)*step; tick <= end+step*1e-6 && tickCount++ < 100; tick += step) {
      const x = scale(tick);
      out.push(`<path d="M${x} 32V${height}" stroke="${p.grid}" stroke-dasharray="2 4"/><text x="${x+2}" y="21" fill="${p.muted}" font-size="9" font-family="Consolas,monospace">${esc(Number(tick.toFixed(precision)))}</text>`);
    }
    for (const region of this.regions) {
      if (region.end < start || region.start > end) continue;
      if (region.type === 'overlap' && !this.showOverlaps) continue;
      const x = scale(region.start), w = scale(region.end)-x;
      const group = region.coreId ? groups.find(g => g.coreId === region.coreId) : null;
      const regionTop = group?.y ?? 32;
      const regionEnd = group ? groups[groups.indexOf(group)+1]?.y ?? height : height;
      out.push(`<g><title>${esc(region.label)} · JSON annotation</title><rect x="${x}" y="${regionTop}" width="${w}" height="${regionEnd-regionTop}" fill="${p.region}" opacity=".035"/></g>`);
    }
    if (this.showOverlaps) for (const group of groups) {
      if (group.coreId === undefined) continue;
      const next = groups[groups.indexOf(group)+1]?.y ?? height;
      const events = this.taskEvents.filter(e => this.laneMap.get(e.laneId).coreId === group.coreId);
      for (const region of taskOverlaps(events)) {
        if (region.end <= start || region.start >= end) continue;
        const x = scale(region.start), w = scale(region.end)-x;
        out.push(`<g class="core-overlap" role="button" tabindex="0" data-range-start="${region.start}" data-range-end="${region.end}"><title>${esc(group.coreId)} · ${esc(region.label)} · ${fmt(region.end-region.start)} ${esc(this.unit)}</title><rect x="${x}" y="${group.y+28}" width="${w}" height="${next-group.y-28}" fill="${p.region}" opacity=".065" pointer-events="none"/><rect x="${x}" y="${group.y+3}" width="${w}" height="21" rx="3" fill="${p.region}" fill-opacity=".17"/>${w>85?`<text x="${x+w/2}" y="${group.y+17}" fill="${p.region}" text-anchor="middle" font-size="8">${esc(region.label)}</text>`:''}</g>`);
      }
    }
    this.coordinates = new Map();
    let visible = 0, culled = 0;
    const coreEvents = this.coreEvents;
    for (const event of coreEvents) {
      if (this.hiddenKernels.has(event.kernelId) || this.hiddenTasks.has(event.taskId)) continue;
      const row = rows.get(event.laneId);
      if (!row) continue;
      const rawLevel = this.layout?.positions.get(event.id) ?? 0;
      const level = row.collapsed ? 0 : rawLevel;
      const stackOffset = row.collapsed ? Math.min(5, rawLevel*2.5) : 0;
      const centerY = row.y+row.pad+10+level*29+stackOffset;
      const x = scale(event.start), xEnd = scale(event.start+event.duration);
      this.coordinates.set(event.id, { x, xEnd, y: centerY });
      if (event.start+event.duration < start || event.start > end) continue;
      if (++visible > 12000) { culled++; continue; }
      const kernel = { ...this.kernelMap.get(event.kernelId), color: this.eventColor(event) }, selected = event.id === this.selectedId;
      const matches = this.matches(event), alpha = matches ? 1 : .13;
      const group = `<g class="event ${event.kind}" data-event="${esc(event.id)}" tabindex="0" role="button" aria-label="${esc(event.taskId)} · ${esc(event.name)}, ${fmt(event.start)} ${esc(this.unit)}, ${fmt(event.duration)} ${esc(this.unit)}" opacity="${alpha}">`;
      out.push(group);
      const [flightFrom, flightTo] = outstandingWindow(event);
      if (flightFrom < event.start - 1e-9 || flightTo > event.start + event.duration + 1e-9) {
        const flightLeft = Math.max(left, scale(flightFrom)), flightRight = Math.min(width-right, scale(flightTo));
        if (flightRight > flightLeft) out.push(`<rect x="${flightLeft}" y="${centerY-10}" width="${flightRight-flightLeft}" height="21" rx="3" fill="${kernel.color}" fill-opacity=".05" stroke="${kernel.color}" stroke-opacity=".3" stroke-dasharray="2 3"><title>Outstanding ${fmt(flightFrom)} → ${fmt(flightTo)} ${esc(this.unit)}</title></rect>`);
      }
      if ((event.kind === 'marker' || (event.kind === 'fetch' && event.duration === 0))) {
        out.push(`<path d="M${x} ${centerY-5}l5 5-5 5-5-5Z" fill="${kernel.color}" stroke="${selected ? p.text : p.bg}" stroke-width="${selected ? 2 : 1}"/><rect x="${x-6}" y="${centerY-10}" width="12" height="20" fill="transparent"/>`);
      } else {
        const eventLeft = Math.max(left, x), eventRight = Math.min(width-right, xEnd), w = Math.max(1, eventRight-eventLeft);
        const fill = event.kind === 'wait' ? 'url(#wait-hatch)' : event.kind === 'schedule' ? 'url(#schedule-hatch)' : kernel.color;
        const opacity = ['wait', 'schedule'].includes(event.kind) ? 1 : this.getAttribute('theme') === 'dark' ? .32 : .14;
        out.push(`<rect x="${eventLeft}" y="${centerY-10}" width="${w}" height="21" rx="3" fill="${fill}" fill-opacity="${opacity}" stroke="${selected ? kernel.color : event.kind === 'wait' ? p.waitLine : kernel.color}" stroke-opacity="${selected ? 1 : .4}" stroke-width="${selected ? 1.8 : .7}" ${['allocation', 'schedule'].includes(event.kind) ? 'stroke-dasharray="3 2"' : ''}/>`);
        if (event.kind !== 'wait') out.push(`<rect x="${eventLeft}" y="${centerY-7}" width="2" height="15" rx="1" fill="${kernel.color}" opacity=".7"/>`);
        const available = w-12;
        let label = `${this.taskMap.get(event.taskId)?.label ?? event.taskId} · ${event.name}`;
        if (textWidth(label) > available) { const count = Math.max(0, Math.floor(available/6)-2); label = count > 3 ? [...label].slice(0,count).join('')+'…' : ''; }
        if (label) out.push(`<text x="${eventLeft+7}" y="${centerY+3.5}" fill="${p.text}" font-size="9.5" pointer-events="none">${esc(label)}</text>`);
      }
      out.push('</g>');
    }
    let edgesDrawn = 0;
    for (const edge of this.dependencies) {
      const related = edge.from === this.selectedId || edge.to === this.selectedId;
      if (!related && !this.showDependencies) continue;
      const a = this.coordinates.get(edge.from), b = this.coordinates.get(edge.to);
      if (!a || !b || ++edgesDrawn > 1800) continue;
      const fromEvent = this.eventMap.get(edge.from), toEvent = this.eventMap.get(edge.to);
      if (!this.matches(fromEvent) || !this.matches(toEvent)) continue;
      const x1 = edge.fromAnchor === 'start' ? a.x : a.xEnd;
      const x2 = edge.toAnchor === 'end' ? b.xEnd : b.x;
      const bend = Math.max(9, Math.abs(x2-x1)*.45);
      let path = `M${x1} ${a.y}C${x1+bend} ${a.y},${x2-bend} ${b.y},${x2} ${b.y}`;
      if (Math.abs(x1-x2)<4) path = `M${x1} ${a.y}C${x1+14} ${a.y},${x2+14} ${b.y},${x2} ${b.y}`;
      out.push(`<path d="${path}" fill="none" stroke="${related ? this.eventColor(fromEvent) : p.muted}" stroke-width="${related ? 1.6 : 1}" opacity="${related ? .9 : .32}" ${edge.type === 'data' ? '' : 'stroke-dasharray="3 3"'} marker-end="url(#arrowhead)" pointer-events="none"/>`);
    }
    if (this.measurement) {
      const [a,b] = [...this.measurement].sort((a,b)=>a-b), x1=scale(a), x2=scale(b);
      out.push(`<rect x="${x1}" y="30" width="${Math.max(1,x2-x1)}" height="${height-30}" fill="${p.region}" opacity=".1"/><path d="M${x1} 29V${height}M${x2} 29V${height}" stroke="${p.region}" stroke-dasharray="3 3"/><rect x="${(x1+x2)/2-47}" y="28" width="94" height="18" rx="4" fill="${p.region}"/><text x="${(x1+x2)/2}" y="40.5" fill="#fff" font-family="Consolas,monospace" font-size="10" text-anchor="middle">Δ ${fmt(b-a)} ${esc(this.unit)}</text>`);
    }
    if (!this.filteredEvents.length) out.push(`<text x="${left+plotWidth/2}" y="${height/2}" fill="${p.muted}" text-anchor="middle" font-size="12">没有匹配事件，试试调整搜索或 Task 筛选</text>`);
    if (culled) out.push(`<text x="${left+8}" y="${height-1}" fill="${p.muted}" font-size="10">${culled} events omitted at this scale · zoom to inspect</text>`);
    out.push('</g></svg>');
    el.innerHTML = out.join('');
    if (this._focusLaneId) {
      const row = rows.get(this._focusLaneId);
      if (row) this.$('.chart-scroll').scrollTop = Math.max(0, row.y-120);
      this._focusLaneId = null;
    }
    this.drawTaskOverview();
    this.drawOverview();
  }
  drawTaskOverview() {
    if (!this.geometry) return;
    const { width, left, right, plotWidth } = this.geometry, p = this.palette();
    const scale = t => left + (t-this.view[0])/(this.view[1]-this.view[0])*plotWidth;
    const tasks = taskSummaries(this.taskEvents, [...this.taskMap.values()]);
    const height = 71 + tasks.length*24, ribbonY = height-44;
    const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Inter,Segoe UI,Microsoft YaHei,sans-serif" role="img" aria-label="Task 概览与所选核的执行重叠"><defs><clipPath id="task-clip"><rect x="${left}" width="${plotWidth}" height="${height}"/></clipPath></defs><rect width="${width}" height="${height}" fill="${p.bg}"/><text x="16" y="17" fill="${p.muted}" font-size="9" letter-spacing="1">NETWORK TASKS</text><text x="${width-right}" y="17" fill="${p.muted}" font-size="9" text-anchor="end">${['1.2','1.3'].includes(this._document.schemaVersion)?'琥珀：调度 · 紫色：取指 · 实线：执行':'所选核合并 · 浅色为跨度，实线为计算 / 搬运'}</text>`];
    tasks.forEach((task, i) => {
      const y = 26+i*24, hidden = this.hiddenTasks.has(task.id), kernel = this.kernelMap.get(task.kernelId);
      out.push(`<g opacity="${hidden ? .35 : 1}"><text x="16" y="${y+13}" fill="${task.color}" font-size="10" font-weight="600">${esc(task.label)}</text><text x="64" y="${y+13}" fill="${p.muted}" font-size="8">${esc(kernel?.label.slice(0,12))}</text>`);
      if (task.count) {
        const x=scale(task.start), w=Math.max(1,scale(task.end)-x);
        out.push(`<g clip-path="url(#task-clip)" class="task-span" role="button" tabindex="0" data-range-start="${task.start}" data-range-end="${task.end}"><title>${esc(task.label)} · ${esc(kernel?.label)} · ${fmt(task.start)}–${fmt(task.end)} ${esc(this.unit)}</title><rect x="${x}" y="${y+2}" width="${w}" height="15" rx="3" fill="${task.color}" fill-opacity=".1" stroke="${task.color}" stroke-opacity=".4"/>`);
        for (const [a,b] of task.intervals) out.push(`<rect x="${scale(a)}" y="${y+8}" width="${Math.max(1,scale(b)-scale(a))}" height="4" rx="1" fill="${task.color}" fill-opacity=".8"/>`);
        for (const [a,b] of task.scheduleIntervals) out.push(`<rect class="task-schedule" x="${scale(a)}" y="${y+2}" width="${Math.max(1,scale(b)-scale(a))}" height="5" rx="1" fill="${this.eventColor({kind:'schedule'})}" fill-opacity=".65"/>`);
        for (const [a,b] of task.fetchIntervals) out.push(`<rect class="task-fetch" x="${scale(a)}" y="${y+3}" width="${Math.max(1,scale(b)-scale(a))}" height="9" rx="1" fill="${this.eventColor({kind:'fetch'})}" fill-opacity=".7"/>`);
        out.push('</g>');
      }
      out.push('</g>');
    });
    out.push(`<text x="16" y="${ribbonY+15}" fill="${p.region}" font-size="9">TASK OVERLAP</text><path d="M${left} ${ribbonY+20}H${width-right}" stroke="${p.grid}"/><g clip-path="url(#task-clip)">`);
    if (this.showOverlaps) for (const region of this.overlaps) {
      const x=scale(region.start), w=scale(region.end)-x;
      out.push(`<g class="task-overlap" role="button" tabindex="0" data-range-start="${region.start}" data-range-end="${region.end}"><title>${esc(region.label)} · ${fmt(region.end-region.start)} ${esc(this.unit)} · 所选核上的同时执行</title><rect x="${x}" y="${ribbonY+1}" width="${Math.max(1,w)}" height="17" rx="3" fill="${p.region}" fill-opacity=".16" stroke="${p.region}" stroke-opacity=".45"/>${w>25?`<text x="${x+w/2}" y="${ribbonY+12}" fill="${p.region}" font-size="8" text-anchor="middle">${esc(region.label)}</text>`:''}</g>`);
    }
    if (!this.overlaps.length) out.push(`<text x="${left+8}" y="${ribbonY+14}" fill="${p.muted}" font-size="9">所选核和 Task 中没有同时执行的区间</text>`);
    out.push('</g>');
    const rawStep=(this.view[1]-this.view[0])/Math.max(3,Math.floor(plotWidth/85));
    const magnitude=10**Math.floor(Math.log10(rawStep));
    const step=[1,2,5,10].find(n=>n*magnitude>=rawStep)*magnitude;
    const precision=Math.max(0,Math.min(10,-Math.floor(Math.log10(step))));
    out.push(`<path d="M${left} ${height-20}H${width-right}" stroke="${p.grid}"/><text x="16" y="${height-6}" fill="${p.muted}" font-size="9">TIME / ${esc(this.unit)}</text><g clip-path="url(#task-clip)">`);
    let ticks=0;
    for(let tick=Math.ceil(this.view[0]/step)*step;tick<=this.view[1]&&ticks++<100;tick+=step) {
      const x=scale(tick);
      out.push(`<path d="M${x} ${height-20}v4" stroke="${p.grid}"/><text x="${x+2}" y="${height-6}" fill="${p.muted}" font-size="9" font-family="Consolas,monospace">${esc(Number(tick.toFixed(precision)))}</text>`);
    }
    out.push('</g></svg>');
    this.$('.network-overview').innerHTML = out.join('');
  }
  drawOverview() {
    if (!this._built || !this._document) return;
    const svg = this.$('.overview svg'), width = svg.clientWidth || 700, height=36, pad=3;
    const p = this.palette(), [a,b]=this.extent, scale=t=>pad+(t-a)/(b-a)*(width-pad*2);
    const chartRows = this.geometry?.rows, chartHeight = this.geometry?.height || 1;
    const yOf = laneId => { const row = chartRows?.get(laneId); return row ? 4+((row.y+row.height/2)/chartHeight)*(height-8) : 4; };
    const out=[`<rect width="${width}" height="${height}" fill="${p.row}" rx="4"/>`];
    for (const event of this.coreEvents) {
      if (event.duration===0 || this.hiddenKernels.has(event.kernelId) || this.hiddenTasks.has(event.taskId)) continue;
      const y=yOf(event.laneId);
      out.push(`<rect x="${scale(event.start)}" y="${y}" width="${Math.max(.6,scale(event.start+event.duration)-scale(event.start))}" height="2.2" fill="${this.eventColor(event)}" opacity=".6"/>`);
    }
    const x1=scale(this.view[0]),x2=scale(this.view[1]);
    out.push(`<rect x="0" y="0" width="${x1}" height="${height}" fill="${p.bg}" opacity=".7"/><rect x="${x2}" y="0" width="${width-x2}" height="${height}" fill="${p.bg}" opacity=".7"/><rect x="${x1}" y="1" width="${Math.max(2,x2-x1)}" height="${height-2}" rx="3" fill="none" stroke="${p.region}" stroke-opacity=".65"/><path d="M${x1+3} 12v12M${x2-3} 12v12" stroke="${p.region}" stroke-width="1.5"/>`);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.innerHTML=out.join('');
  }
  updateFooter() {
    if (!this._built) return;
    const range=this.measurement ? `Δ ${fmt(Math.abs(this.measurement[1]-this.measurement[0]))} ${this.unit}` : `${fmt(this.view[0])} — ${fmt(this.view[1])} ${this.unit}`;
    this.$('.window').textContent=range;
  }
  drawInspector() {
    if (!this._built || !this._document) return;
    const e=this.eventMap?.get(this.selectedId), area=this.$('.inspector');
    if (!e) {
      const cards = this.overlaps.slice(0, 12);
      const entries = this.overlapEntries;
      const coreTotals = this._document.cores.filter(c => this.selectedCoreIds.has(c.id)).map(c => ({ core:c, duration:intervalLength(entries.filter(r => r.coreId === c.id).map(r => [r.start,r.end])) }));
      area.innerHTML=`<div class="inspector-title">整网执行<span class="muted">NETWORK</span></div><div class="network-context"><h3>${this.taskMap.size} Tasks · ${this.selectedCoreIds.size} Cores</h3><p>Task 表示一次算子调用，可跨多个物理核。颜色按 Task 区分；同一 Kernel 的多次调用独立展示。</p></div><div class="detail-section">所选核上的 Task overlap</div>${cards.map(r=>`<button class="region-card" data-range-start="${r.start}" data-range-end="${r.end}"><strong>${esc(r.label)} · ${fmt(r.end-r.start)} ${this.unit}</strong><p>${fmt(r.start)} — ${fmt(r.end)} ${this.unit} · 点击定位</p></button>`).join('') || '<p class="muted" style="font-size:11px">没有跨 Task 同时执行的区间。</p>'}<div class="detail-section">同一物理核上的重叠</div>${coreTotals.map(({core,duration})=>`<div class="detail-row"><span>${esc(core.label)}</span><code>${fmt(duration)} ${this.unit}</code></div>`).join('')}<div class="source-note">重叠按计算 / 搬运区间并集自动计算，等待、调度、取指、内存分配和瞬时点不计入。所选核合并值可包含不同核之间的并行；Core 分组只标注本核上的重叠。${this._document.metadata.source.kind==='synthetic' ? '当前为合成数据，不代表实测性能。' : ''}</div>`;
      return;
    }
    const lane=this.laneMap.get(e.laneId), kernel={ ...this.kernelMap.get(e.kernelId), color:this.eventColor(e) }, connections=this.dependencies.filter(d=>d.from===e.id || d.to===e.id);
    const row=(label,value)=>`<div class="detail-row"><span>${esc(label)}</span><code>${esc(value)}</code></div>`;
    area.innerHTML=`<div class="inspector-title">事件详情<button data-action="deselect" aria-label="关闭事件详情">${icon('close',14)}</button></div><div class="inspector-name">${esc(e.name)}</div><span class="badge" style="color:${kernel.color}">${esc(kernel.label)}</span><span class="badge">${esc(KIND[e.kind])}</span><div class="detail-metrics"><div><span>开始时间</span><strong>${fmt(e.start)}</strong> <small>${this.unit}</small></div><div><span>持续时间</span><strong>${fmt(e.duration)}</strong> <small>${this.unit}</small></div></div><div class="detail-section">Execution</div>${row(lane.engine==='SCHEDULER'?'目标核':'物理核',this.eventCoreLabel(e))}${row(lane.engine==='SCHEDULER'?'调度资源':'Pipe',`${lane.engine} / ${lane.pipe}`)}${row('结束时间',`${fmt(e.start+e.duration)} ${this.unit}`)}${(() => { const [from, to] = outstandingWindow(e); return to > e.start+e.duration+1e-9 || from < e.start-1e-9 ? row('Outstanding',`${fmt(from)} → ${fmt(to)} ${this.unit}`) + row('在飞时长',`${fmt(to-from)} ${this.unit}`) : ''; })()}${this.rowDepth(lane.id) > 1 ? row('槽位',`O${(this.layout?.positions.get(e.id) ?? 0)+1} / ${this.rowDepth(lane.id)}`) : ''}${row('Task',e.taskId ?? '—')}${e.kind==='schedule'?row('后续取指',e.fetchIds.join(', ')):''}${e.fetchId?row('前置取指',e.fetchId):''}${e.blockId!==undefined?row('Block',e.blockId):''}${e.iteration!==undefined?row('Iteration',e.iteration):''}${e.source?.pc?row('PC',e.source.pc):''}${e.source?.file?row('Source',`${e.source.file}${e.source.line?':'+e.source.line:''}`):''}${Object.keys(e.args ?? {}).length?'<div class="detail-section">Arguments</div>':''}${Object.entries(e.args ?? {}).map(([key,value])=>row(key,typeof value==='string'?value:JSON.stringify(value))).join('')}<div class="detail-section">Dependencies · ${connections.length}</div>${connections.map(d=>{const incoming=d.to===e.id,other=this.eventMap.get(incoming?d.from:d.to);return `<button class="relation" data-select="${esc(other.id)}" title="${esc(d.label || d.type)}"><span>${incoming?'←':'→'} ${esc(other.name)}</span><small>${esc(d.type)}</small></button>`;}).join('') || '<span class="muted" style="font-size:11px">未声明依赖</span>'}`;
  }
  drawTable() {
    if (!this._built || !this._document) return;
    const area=this.$('.table-scroll'), events=this.filteredEvents;
    this.$('[data-tab=events] .count').textContent=events.length;
    this.$('.overlap-count').textContent=this.overlaps.length;
    const phases=events.filter(e=>['schedule','fetch'].includes(e.kind));
    this.$('.phase-count').textContent=phases.length;
    if(this.tab==='phases') {
      area.innerHTML=`<table><thead><tr><th>阶段</th><th>TASK / KERNEL</th><th>资源 / 目标核</th><th>开始 (${this.unit})</th><th>时长 (${this.unit})</th><th>后续取指</th></tr></thead><tbody>${[...phases].sort((a,b)=>a.start-b.start).map(e=>{const lane=this.laneMap.get(e.laneId);return `<tr data-select="${esc(e.id)}"><td><i class="dot" style="background:${this.eventColor(e)}"></i>${esc(KIND[e.kind])} · ${esc(e.name)}</td><td class="mono">${esc(this.taskMap.get(e.taskId)?.label)} / ${esc(this.kernelMap.get(e.kernelId)?.label)}</td><td>${esc(lane.label)} · ${esc(this.eventCoreLabel(e))}</td><td class="mono">${fmt(e.start)}</td><td class="mono">${fmt(e.duration)}</td><td class="mono">${esc((e.fetchIds??[]).join(', ') || '—')}</td></tr>`;}).join('')}</tbody></table>${phases.length?'':'<div class="empty-row">当前选择中没有调度或取指事件</div>'}<div class="table-note">调度事件关联目标 task 和一个或多个 fetchIds。共享调度事件只显示一次；每段调度必须在所有关联取指开始前完成。取指 duration=0 表示只知道取指时刻。</div>`;
      return;
    }
    if (this.tab==='overlaps') {
      const entries=this.overlapEntries;
      area.innerHTML=`<table><thead><tr><th>TASKS</th><th>统计范围</th><th>开始 (${this.unit})</th><th>结束 (${this.unit})</th><th>重叠 (${this.unit})</th></tr></thead><tbody>${entries.map(r=>`<tr data-range-start="${r.start}" data-range-end="${r.end}"><td class="mono">${esc(r.label)}</td><td>${esc(r.scope)}</td><td class="mono">${fmt(r.start)}</td><td class="mono">${fmt(r.end)}</td><td class="mono">${fmt(r.end-r.start)}</td></tr>`).join('')}</tbody></table>${entries.length?'':'<div class="empty-row">当前 Core 与 Task 选择中没有执行重叠</div>'}<div class="table-note">所选核合并行表示任意所选核上不同 Task 同时计算或搬运；Core 行表示同一个物理核的跨 Task 并行。区间采用 [start, end)，相接不计重叠；多个 Task 的重叠时间取并集，不累加成对时长。</div>`;
      return;
    }
    if (this.tab==='pipes') {
      area.innerHTML=`<table><thead><tr><th>物理核</th><th>PIPE</th><th>行</th><th>并发上限</th><th>执行单元</th><th>事件数</th><th>有效执行时间</th><th>活跃率</th></tr></thead><tbody>${this.lanes.map(l=>{const count=this.coreEvents.filter(e=>e.laneId===l.id).length,busy=this.stats.laneBusy.get(l.id)??0,rate=this.stats.duration?busy/this.stats.duration:0;return `<tr><td>${esc(this._document.cores.find(c=>c.id===l.coreId)?.label)}</td><td>${esc(l.label)}</td><td class="mono">${this.rowDepth(l.id)}${this.laneCollapsed(l.id)?' · 折叠':''}</td><td class="mono">${l.issueWidth ?? '—'}</td><td class="mono">${esc(l.engine==='SCHEDULER'?'调度资源':l.engine==='AIC'?'Cube / AIC':'Vector / AIV')}</td><td>${count}</td><td class="mono">${fmt(busy)} ${this.unit}</td><td><span class="bar-track"><span class="bar-fill" style="display:block;width:${rate*100}%"></span></span>${l.engine==='SCHEDULER'||l.role==='fetch'?'不参与计算活跃率':fmt(rate*100)+'%'}</td></tr>`;}).join('')}</tbody></table><div class="table-note">统计所选物理核的完整场景，不受搜索或 Task / Kernel 筛选影响。“行”为该 Pipe 的 outstanding 槽位数：指令按 issue → complete 的区间装箱，最多铺到 issueWidth；折叠时只显示 1 行。重叠事件取并集，等待、调度、取指、分配和瞬时标记不计入活跃时间。</div>`;
      return;
    }
    const sorted=[...events].sort((a,b)=>a.start-b.start || a.id.localeCompare(b.id));
    area.innerHTML=`<table><thead><tr><th>事件名称</th><th>TASK</th><th>KERNEL</th><th>物理核</th><th>PIPE</th><th>开始 (${this.unit})</th><th>耗时 (${this.unit})</th><th>类型</th></tr></thead><tbody>${sorted.slice(0,300).map(e=>{const kernel=this.kernelMap.get(e.kernelId),lane=this.laneMap.get(e.laneId);return `<tr data-select="${esc(e.id)}" class="${e.id===this.selectedId?'selected':''}"><td><i class="dot" style="background:${this.eventColor(e)}"></i>${esc(e.name)}</td><td class="mono">${esc(this.taskMap.get(e.taskId)?.label)}</td><td class="mono muted">${esc(kernel.label)}</td><td>${esc(this.eventCoreLabel(e))}</td><td><span class="track">${esc(lane.engine)} / ${esc(lane.pipe)}</span></td><td class="mono">${fmt(e.start)}</td><td class="mono">${fmt(e.duration)}</td><td class="muted">${esc(KIND[e.kind])}</td></tr>`;}).join('')}</tbody></table>${!sorted.length?'<div class="empty-row">没有匹配事件</div>':''}${sorted.length>300?`<div class="table-note">显示前 300 / ${sorted.length} 条事件，请搜索进一步定位。</div>`:''}`;
  }
  bindChart() {
    const chart=this.$('.chart'), tooltip=this.$('.tooltip');
    const localX=e=>e.clientX-chart.getBoundingClientRect().left;
    const timeAt=e=>{const g=this.geometry;return clamp(this.view[0]+(localX(e)-g.left)/g.plotWidth*(this.view[1]-this.view[0]),this.extent[0],this.extent[1]);};
    chart.addEventListener('pointerdown',e=>{
      if (e.button!==0 || !this.geometry || localX(e)<this.geometry.left) return;
      chart.setPointerCapture(e.pointerId);
      this.drag={ x:e.clientX, view:[...this.view], time:timeAt(e), measure:e.shiftKey||this.measureMode, moved:false, eventId:e.target.closest('[data-event]')?.dataset.event };
      if (this.drag.measure) { this.measurement=[this.drag.time,this.drag.time]; this.scheduleDraw(); }
      tooltip.hidden=true;
    });
    chart.addEventListener('pointermove',e=>{
      if (this.drag) {
        if (Math.abs(e.clientX-this.drag.x)>3) this.drag.moved=true;
        if (this.drag.measure) { this.measurement=[this.drag.time,timeAt(e)]; this.scheduleDraw(); this.updateFooter(); }
        else if (this.drag.moved) { chart.classList.add('dragging'); const delta=(e.clientX-this.drag.x)/this.geometry.plotWidth*(this.drag.view[1]-this.drag.view[0]); this.setView(this.drag.view[0]-delta,this.drag.view[1]-delta); }
        return;
      }
      const event=this.eventMap?.get(e.target.closest('[data-event]')?.dataset.event);
      if (!event) { tooltip.hidden=true; return; }
      const lane=this.laneMap.get(event.laneId);
      const flight = outstandingWindow(event), inFlight = flight[1] > event.start+event.duration+1e-9 || flight[0] < event.start-1e-9;
      tooltip.innerHTML=`<strong>${esc(event.taskId)} · ${esc(event.name)}</strong><span>${esc(this.eventCoreLabel(event))} · ${esc(lane.engine)} / ${esc(lane.pipe)} · ${esc(KIND[event.kind])}</span><br><code>${fmt(event.start)} → ${fmt(event.start+event.duration)} ${esc(this.unit)} · Δ ${fmt(event.duration)} ${esc(this.unit)}</code>${inFlight ? `<br><code>outstanding ${fmt(flight[0])} → ${fmt(flight[1])} ${esc(this.unit)} · Δ ${fmt(flight[1]-flight[0])} ${esc(this.unit)} · O${(this.layout?.positions.get(event.id) ?? 0)+1}</code>` : ''}`;
      tooltip.hidden=false;
      tooltip.style.left=`${Math.max(8,Math.min(e.clientX+14,window.innerWidth-330))}px`;
      tooltip.style.top=`${Math.max(8,Math.min(e.clientY+16,window.innerHeight-tooltip.offsetHeight-8))}px`;
    });
    chart.addEventListener('pointerup',e=>{
      if (!this.drag) return;
      const drag=this.drag;
      this.drag=null;
      chart.classList.remove('dragging');
      if (chart.hasPointerCapture(e.pointerId)) chart.releasePointerCapture(e.pointerId);
      if (drag.measure) {
        const [start,end]=[...this.measurement].sort((a,b)=>a-b);
        this.emit('range-select',{start,end,duration:end-start,timeUnit:this._document.metadata.timeUnit});
      } else if (!drag.moved) this.selectEvent(drag.eventId ?? null);
    });
    chart.addEventListener('pointercancel',()=>{this.drag=null;chart.classList.remove('dragging');});
    chart.addEventListener('pointerleave',()=>{tooltip.hidden=true;});
    chart.addEventListener('dblclick',e=>{ const id=e.target.closest('[data-event]')?.dataset.event;const event=this.eventMap?.get(id);if(event){const pad=Math.max(event.duration*.65,(this.extent[1]-this.extent[0])/100);this.setView(event.start-pad,event.start+event.duration+pad);return;}if(!this.geometry||e.target.closest('[data-row-toggle]')||e.target.closest('[data-group-toggle]'))return;if(localX(e)>=this.geometry.left)return;const lane=this.laneAtY(e.clientY-chart.getBoundingClientRect().top);if(lane&&this.rowDepth(lane.id)>1)this.toggleLane(lane.id);});
    chart.addEventListener('wheel',e=>{
      if (!this._document || !this.geometry) return;
      if (e.ctrlKey || e.metaKey) { e.preventDefault();this.zoom(Math.exp(clamp(e.deltaY,-100,100)*.008),timeAt(e)); }
      else if (Math.abs(e.deltaX)>Math.abs(e.deltaY) || e.shiftKey) { e.preventDefault();const d=(e.deltaX||e.deltaY)/this.geometry.plotWidth*(this.view[1]-this.view[0]);this.setView(this.view[0]+d,this.view[1]+d); }
    },{passive:false});
    const overview=this.$('.overview svg');
    const miniMove=e=>{
      const rect=overview.getBoundingClientRect(),ratio=clamp((e.clientX-rect.left)/rect.width,0,1),center=this.extent[0]+ratio*(this.extent[1]-this.extent[0]),span=this.view[1]-this.view[0];
      this.setView(center-span/2,center+span/2);
    };
    overview.addEventListener('pointerdown',e=>{if(!this._document)return;overview.setPointerCapture(e.pointerId);this.miniDrag=true;miniMove(e);});
    overview.addEventListener('pointermove',e=>{if(this.miniDrag)miniMove(e);});
    overview.addEventListener('pointerup',()=>{this.miniDrag=false;});
    overview.addEventListener('pointercancel',()=>{this.miniDrag=false;});
  }
  exportSVG() {
    if (!this._document) throw new Error('No trace loaded');
    this.draw();
    const original=this.$('.chart svg'), svg=original.cloneNode(true), ns='http://www.w3.org/2000/svg', g=document.createElementNS(ns,'g');
    while(svg.firstChild)g.appendChild(svg.firstChild);
    const overview=this.$('.network-overview svg').cloneNode(true), overviewHeight=Number(overview.getAttribute('height'));
    const width=this.geometry.width,height=this.geometry.height+58+overviewHeight,p=this.palette();
    svg.setAttribute('height',height);svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
    const bg=document.createElementNS(ns,'rect');bg.setAttribute('width',width);bg.setAttribute('height',height);bg.setAttribute('fill',p.bg);svg.append(bg);
    const title=document.createElementNS(ns,'text');title.setAttribute('x','16');title.setAttribute('y','23');title.setAttribute('fill',p.text);title.setAttribute('font-size','13');title.setAttribute('font-weight','600');title.textContent=`${this._document.metadata.title} · ${this.scenario.label}`;svg.append(title);
    const note=document.createElementNS(ns,'text');note.setAttribute('x','16');note.setAttribute('y','41');note.setAttribute('fill',p.muted);note.setAttribute('font-size','9');note.textContent=`${this.selectedCoreIds.size} ${this.network ? 'physical cores' : 'trace groups'} · ${this.taskMap.size} tasks · ${this._document.metadata.source.kind==='synthetic'?'SYNTHETIC DEMO · not measured performance':this._document.metadata.source.kind} · Pipe Atlas`;svg.append(note);
    const taskGroup=document.createElementNS(ns,'g');
    while(overview.firstChild)taskGroup.appendChild(overview.firstChild);
    taskGroup.setAttribute('transform','translate(0 58)');svg.append(taskGroup);
    g.setAttribute('transform',`translate(0 ${58+overviewHeight})`);svg.append(g);
    svg.querySelectorAll('[tabindex]').forEach(e=>e.removeAttribute('tabindex'));
    return new XMLSerializer().serializeToString(svg);
  }
  exportJSON() { return JSON.stringify(this._document,null,2); }
  async exportPNG() {
    const blob=new Blob([this.exportSVG()],{type:'image/svg+xml'}),url=URL.createObjectURL(blob);
    try {
      const image=new Image();image.src=url;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.naturalWidth*2;canvas.height=image.naturalHeight*2;
      const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,canvas.width,canvas.height);
      return await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('PNG export failed')),'image/png'));
    } finally { URL.revokeObjectURL(url); }
  }
}

if (!customElements.get('pipe-timeline')) customElements.define('pipe-timeline',PipeTimeline);
