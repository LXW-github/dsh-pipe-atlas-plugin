/* Client half of the Pipe Atlas bundle.
 *
 * The build step prepends the vendored Pipe Atlas Web Component sources
 * (`icons.js`, `component-style.js`, `model.js`, `pipe-timeline.js`) and the
 * demo traces (`DEMO_DATA`); this file only owns the Harness panel shell.
 */

const PANEL_ID = 'dsh-pipe-atlas';
const NS = 'dsh-pipe-atlas';
const { useEffect, useMemo, useRef, useState, useSyncExternalStore } = React;

const DEMOS = [
  { id: 'scheduling' },
  { id: 'network' },
  { id: 'earlyStart' },
  { id: 'minimal' },
];

const STILL_THEME = {
  get: () => 'light',
  subscribe: () => () => {},
};

const CSS = `
.pa-root{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:13px/1.5 Inter,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;container-type:inline-size}
.pa-root *{box-sizing:border-box}
.pa-top{flex:none;display:flex;align-items:center;gap:8px;padding:10px 16px;min-height:52px;border-bottom:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);position:relative;z-index:20}
.pa-brand{display:flex;align-items:center;gap:9px;min-width:0;flex:none}
.pa-logo{display:grid;place-items:center;width:30px;height:30px;flex:none;border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 13%,transparent);color:var(--dsw-alias-brand-primary)}
.pa-brand-text{display:flex;flex-direction:column;min-width:0;line-height:1.25}
.pa-brand-text strong{font-size:13px;font-weight:600;letter-spacing:-.01em;white-space:nowrap}
.pa-brand-text small{font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pa-spacer{flex:1;min-width:4px}
.pa-demos{display:flex;align-items:center;gap:2px;padding:2px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent);flex:none}
.pa-demo{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;line-height:1.2;padding:6px 9px;border-radius:6px;cursor:pointer;white-space:nowrap}
.pa-demo:hover{color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent)}
.pa-demo[aria-pressed=true]{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-brand-primary);box-shadow:0 1px 3px #0000001f}
.pa-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap;flex:none}
.pa-btn:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}
.pa-btn:focus-visible,.pa-demo:focus-visible,.pa-icon:focus-visible,.pa-menu button:focus-visible,.pa-drop:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.pa-btn.pa-primary{border-color:transparent;background:var(--dsw-alias-brand-primary);color:#fff}
.pa-btn.pa-primary:hover{filter:brightness(1.06)}
.pa-icon{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;flex:none;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer}
.pa-icon:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent);color:var(--dsw-alias-label-primary)}
.pa-export{position:relative;flex:none}
.pa-menu{position:absolute;right:0;top:calc(100% + 6px);width:200px;padding:5px;display:flex;flex-direction:column;gap:1px;border:.5px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base));box-shadow:0 14px 34px #00000038;z-index:60}
.pa-menu button{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;padding:7px 9px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer;text-align:left}
.pa-menu button:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent)}
.pa-menu button small{color:var(--dsw-alias-label-secondary);font-size:10px}
.pa-info{flex:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 16px;font-size:11px;color:var(--dsw-alias-label-secondary);border-bottom:.5px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-label-primary) 1.5%,transparent)}
.pa-info-title{max-width:330px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-weight:500}
.pa-state{display:inline-flex;align-items:center;gap:4px;padding:1px 6px;border:.5px solid var(--dsw-alias-border-l1);border-radius:5px;font-size:10px;line-height:16px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary)}
.pa-state.is-synthetic{color:var(--dsw-alias-brand-primary);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 28%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent)}
button.pa-warn{display:inline-flex;align-items:center;gap:4px;padding:1px 6px;border:.5px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 35%,transparent);border-radius:5px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 9%,transparent);color:var(--dsw-alias-state-warn-primary);font:inherit;font-size:10px;line-height:16px;cursor:pointer}
.pa-warnings{flex:none;position:relative;z-index:1;margin:8px 16px 0;padding:8px 11px;max-height:112px;overflow:auto;border:.5px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 30%,transparent);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 7%,transparent);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.6}
.pa-warnings ul{margin:0;padding-left:16px}
.pa-error{flex:none;display:flex;align-items:flex-start;gap:8px;margin:10px 16px 0;padding:9px 11px;border:.5px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 38%,transparent);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 9%,transparent);color:var(--dsw-alias-state-error-primary);font-size:11.5px;line-height:1.55}
.pa-error span{flex:1;min-width:0;overflow-wrap:anywhere;white-space:pre-wrap}
.pa-error button{flex:none;border:0;background:transparent;color:inherit;cursor:pointer;padding:0 2px;line-height:1}
.pa-stage{flex:1;min-height:0;overflow:auto;padding:0 18px 18px;scrollbar-gutter:stable}
.pa-stage>pipe-timeline{display:block}
.pa-stage.is-dragging{position:relative}
.pa-stage.is-dragging::after{content:"";position:absolute;inset:8px;border:1.5px dashed var(--dsw-alias-brand-primary);border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent);pointer-events:none;z-index:2}
.pa-drop-hint{position:absolute;left:50%;top:14px;transform:translateX(-50%);z-index:3;padding:5px 11px;border-radius:999px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base));border:.5px solid var(--dsw-alias-border-l1);box-shadow:0 6px 18px #00000024;font-size:11px;color:var(--dsw-alias-label-secondary);pointer-events:none}
.pa-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;height:100%;min-height:260px;color:var(--dsw-alias-label-secondary);text-align:center;padding:30px}
.pa-empty strong{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600}
.pa-empty p{margin:0;font-size:12px;max-width:360px;line-height:1.7}
.pa-scrim{position:fixed;inset:0;z-index:120;display:grid;place-items:center;padding:24px;background:#00000066;backdrop-filter:blur(2px)}
.pa-dialog{width:min(620px,100%);max-height:min(86vh,760px);overflow:auto;padding:18px;border:.5px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base));color:var(--dsw-alias-label-primary);box-shadow:0 26px 70px #00000059}
.pa-dialog-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:4px}
.pa-dialog-head h2{margin:0;font-size:15px;font-weight:600;line-height:1.4}
.pa-dialog-head p{margin:3px 0 0;font-size:11.5px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.pa-dialog-head .pa-icon{margin-left:auto}
.pa-drop{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;width:100%;margin:14px 0 10px;padding:20px 14px;border:1.5px dashed var(--dsw-alias-border-l2,var(--dsw-alias-border-l1));border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 2.5%,transparent);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.pa-drop:hover,.pa-drop.is-over{border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 7%,transparent);color:var(--dsw-alias-label-primary)}
.pa-drop strong{font-size:12.5px;font-weight:500}
.pa-drop small{font-size:10.5px}
.pa-or{display:flex;align-items:center;gap:10px;margin:12px 0 8px;font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.pa-or::before,.pa-or::after{content:"";flex:1;height:.5px;background:var(--dsw-alias-border-l1)}
.pa-textarea{width:100%;min-height:190px;max-height:42vh;resize:vertical;padding:11px 12px;border:.5px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base));color:var(--dsw-alias-label-primary);font:11.5px/1.65 "SFMono-Regular",Consolas,"Liberation Mono",monospace;outline:none}
.pa-textarea:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:inset 0 0 0 .5px var(--dsw-alias-brand-primary)}
.pa-textarea::placeholder{color:var(--dsw-alias-label-secondary)}
.pa-dialog-error{margin:10px 0 0;padding:8px 10px;border-radius:7px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 9%,transparent);border:.5px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 35%,transparent);color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;max-height:130px;overflow:auto}
.pa-dialog-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:14px}
.pa-dialog-actions .pa-spacer{flex:1}
.pa-shortcuts{display:flex;flex-direction:column;gap:1px;margin:12px 0 4px;border:.5px solid var(--dsw-alias-border-l1);border-radius:9px;overflow:hidden}
.pa-shortcut{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:8px 11px;font-size:11.5px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 2%,transparent)}
.pa-shortcut+.pa-shortcut{border-top:.5px solid var(--dsw-alias-border-l1)}
.pa-shortcut span{color:var(--dsw-alias-label-secondary)}
.pa-shortcut strong{font-weight:500;text-align:right}
.pa-note{margin:12px 0 0;font-size:11px;line-height:1.7;color:var(--dsw-alias-label-secondary)}
.pa-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:140;max-width:min(460px,calc(100vw - 48px));padding:8px 14px;border:.5px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base));color:var(--dsw-alias-label-primary);box-shadow:0 10px 30px #00000033;font-size:11.5px;line-height:1.5;text-align:center}
@container (max-width:1080px){.pa-info-title{display:none}.pa-brand-text small{display:none}}
@container (max-width:900px){.pa-demo{padding:6px 7px;font-size:11px}.pa-btn .pa-btn-label{display:none}.pa-btn{padding:0 8px}.pa-state.pa-hide{display:none}}
@container (max-width:720px){.pa-demos{display:none}}
@media (prefers-reduced-motion:reduce){.pa-root *{transition:none!important}}
`;

const SHORTCUTS = [
  ['help.drag', ''],
  ['help.zoom', ''],
  ['help.measure', ''],
  ['help.dblclick', ''],
  ['help.keys', ''],
];

function IconAtlas({ size = 20 }) {
  return h('svg', {
    width: size, height: size, viewBox: '0 0 20 20', fill: 'none',
    'aria-hidden': true, style: { display: 'block' },
  },
  h('path', { d: 'M3 5.2h8M3 9.4h11M3 13.6h6', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
  h('path', { d: 'M15.5 3v14', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', opacity: .55 }),
  h('circle', { cx: 15.5, cy: 3.4, r: 1.4, fill: 'currentColor' }));
}

function IconUpload({ size = 14 }) {
  return h('svg', {
    width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
    'aria-hidden': true, style: { display: 'block', flex: 'none' },
  },
  h('path', { d: 'M8 10.5V2.6m-3 3 3-3 3 3M2.6 10v2.4c0 .6.5 1.1 1.1 1.1h8.6c.6 0 1.1-.5 1.1-1.1V10', stroke: 'currentColor', strokeWidth: 1.35, strokeLinecap: 'round', strokeLinejoin: 'round' }));
}

function IconDownload({ size = 14 }) {
  return h('svg', {
    width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
    'aria-hidden': true, style: { display: 'block', flex: 'none' },
  },
  h('path', { d: 'M8 2.6v7.8m-3-3 3 3 3-3M2.6 10v2.4c0 .6.5 1.1 1.1 1.1h8.6c.6 0 1.1-.5 1.1-1.1V10', stroke: 'currentColor', strokeWidth: 1.35, strokeLinecap: 'round', strokeLinejoin: 'round' }));
}

function IconAlert({ size = 14 }) {
  return h('svg', {
    width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
    'aria-hidden': true, style: { display: 'block', flex: 'none', marginTop: 1 },
  },
  h('path', { d: 'M8 2.4 14 13H2L8 2.4Z', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' }),
  h('path', { d: 'M8 6.3v3.2', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
  h('circle', { cx: 8, cy: 11.3, r: .75, fill: 'currentColor' }));
}

function IconClose({ size = 13 }) {
  return h('svg', {
    width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
    'aria-hidden': true, style: { display: 'block' },
  },
  h('path', { d: 'm4 4 8 8M12 4l-8 8', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }));
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function PipeAtlasPanel(props) {
  const t = typeof props.t === 'function' ? props.t : (key) => key;
  const themeStore = props.themeStore && props.themeStore.subscribe ? props.themeStore : STILL_THEME;
  const theme = useSyncExternalStore(themeStore.subscribe, themeStore.get, themeStore.get);

  const stageRef = useRef(null);
  const viewerRef = useRef(null);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const exportRef = useRef(null);

  const [source, setSource] = useState({ kind: 'demo', id: 'scheduling' });
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [warningsOpen, setWarningsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState(null);

  const say = (text) => setNotice({ id: `${Date.now()}-${Math.random()}`, text });

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const viewer = document.createElement('pipe-timeline');
    viewer.setAttribute('theme', themeStore.get() === 'dark' ? 'dark' : 'light');
    viewer.setAttribute('aria-label', 'Pipe Atlas execution timeline');
    const onLoad = (event) => {
      const detail = event.detail || {};
      let document = null;
      try { document = viewerRef.current ? viewerRef.current.data : null; } catch { document = null; }
      setInfo({
        title: detail.metadata?.title || document?.metadata?.title || '',
        version: detail.schemaVersion || document?.schemaVersion || '',
        kind: detail.metadata?.source?.kind || '',
        tasks: document?.tasks?.length || 0,
        cores: document?.cores?.length || 0,
        events: document?.scenarios?.[0]?.events?.length || 0,
        warnings: Array.isArray(detail.warnings) ? detail.warnings : [],
      });
      setError('');
    };
    const onError = (event) => {
      setError(event.detail?.message || t('import.invalid'));
    };
    viewer.addEventListener('trace-load', onLoad);
    viewer.addEventListener('trace-error', onError);
    stage.appendChild(viewer);
    viewerRef.current = viewer;
    try {
      viewer.load(DEMO_DATA.scheduling);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
    return () => {
      viewer.removeEventListener('trace-load', onLoad);
      viewer.removeEventListener('trace-error', onError);
      viewer.remove();
      viewerRef.current = null;
    };
    // The viewer is created once; later loads go through its public API.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (viewerRef.current) viewerRef.current.setAttribute('theme', theme === 'dark' ? 'dark' : 'light');
  }, [theme]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!exportOpen) return undefined;
    const onPointer = (event) => {
      if (exportRef.current && !exportRef.current.contains(event.target)) setExportOpen(false);
    };
    const onKey = (event) => { if (event.key === 'Escape') setExportOpen(false); };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [exportOpen]);

  useEffect(() => {
    if (!importOpen && !helpOpen) return undefined;
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      setImportOpen(false);
      setHelpOpen(false);
      setImportError('');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [importOpen, helpOpen]);

  useEffect(() => {
    if (!importOpen) return undefined;
    const timer = window.setTimeout(() => {
      if (textareaRef.current && !importText) textareaRef.current.focus();
    }, 30);
    return () => window.clearTimeout(timer);
  }, [importOpen]);

  const sourceLabel = source.kind === 'demo'
    ? t(`demo.${source.id}`)
    : source.name;

  const loadDemo = (id) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    try {
      viewer.load(DEMO_DATA[id]);
      setSource({ kind: 'demo', id });
      setError('');
      say(t('notice.demo', { name: t(`demo.${id}`) }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const applyImport = (text, name) => {
    const viewer = viewerRef.current;
    if (!viewer) return false;
    if (!text || !text.trim()) {
      setImportError(t('import.empty'));
      return false;
    }
    try {
      viewer.load(text);
      setSource({ kind: 'file', name: name || t('status.imported') });
      setImportOpen(false);
      setImportText('');
      setImportError('');
      say(t('notice.imported'));
      return true;
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  };

  const readFile = async (file) => {
    if (!file) return;
    if (file.size > 30 * 1024 * 1024) {
      setImportOpen(true);
      setImportError(t('import.tooLarge'));
      return;
    }
    try {
      const text = await file.text();
      setImportText(text);
      applyImport(text, file.name);
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const fileStem = () => {
    const raw = info && info.title ? info.title : 'pipe-atlas';
    const stem = raw.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    return stem || 'pipe-atlas';
  };

  const doExport = async (kind) => {
    setExportOpen(false);
    const viewer = viewerRef.current;
    if (!viewer) return;
    try {
      if (kind === 'svg') {
        downloadBlob(new Blob([viewer.exportSVG()], { type: 'image/svg+xml;charset=utf-8' }), `${fileStem()}.svg`);
      } else if (kind === 'json') {
        downloadBlob(new Blob([viewer.exportJSON()], { type: 'application/json' }), `${fileStem()}.json`);
      } else if (kind === 'png') {
        downloadBlob(await viewer.exportPNG(), `${fileStem()}.png`);
      }
      say(t('notice.exported', { format: kind.toUpperCase() }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const warningCount = info ? info.warnings.length : 0;

  const importDialog = importOpen ? h('div', {
    className: 'pa-scrim',
    onMouseDown: (event) => {
      if (event.target === event.currentTarget) {
        setImportOpen(false);
        setImportError('');
      }
    },
  },
  h('div', {
    className: 'pa-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pa-import-title',
  },
  h('div', { className: 'pa-dialog-head' },
    h('div', null,
      h('h2', { id: 'pa-import-title' }, t('import.title')),
      h('p', null, t('import.description'))),
    h('button', {
      type: 'button', className: 'pa-icon', 'aria-label': t('action.close'),
      onClick: () => { setImportOpen(false); setImportError(''); },
    }, h(IconClose))),
  h('button', {
    type: 'button',
    className: 'pa-drop',
    onClick: () => fileInputRef.current && fileInputRef.current.click(),
    onDragOver: (event) => event.preventDefault(),
    onDrop: (event) => {
      event.preventDefault();
      readFile(event.dataTransfer.files && event.dataTransfer.files[0]);
    },
  },
  h(IconUpload, { size: 20 }),
  h('strong', null, t('import.drop')),
  h('small', null, 'JSON · ≤ 30 MB')),
  h('div', { className: 'pa-or' }, h('span', null, t('import.or'))),
  h('textarea', {
    ref: textareaRef,
    className: 'pa-textarea',
    spellCheck: false,
    value: importText,
    placeholder: t('import.placeholder'),
    'aria-label': t('import.or'),
    onChange: (event) => setImportText(event.target.value),
  }),
  importError ? h('div', { className: 'pa-dialog-error', role: 'alert' }, importError) : null,
  h('div', { className: 'pa-dialog-actions' },
    h('button', {
      type: 'button', className: 'pa-btn',
      onClick: () => { setImportText(JSON.stringify(DEMO_DATA.minimal, null, 2)); setImportError(''); },
    }, t('action.loadDemo')),
    h('span', { className: 'pa-spacer' }),
    h('button', {
      type: 'button', className: 'pa-btn',
      onClick: () => { setImportOpen(false); setImportError(''); },
    }, t('action.cancel')),
    h('button', {
      type: 'button', className: 'pa-btn pa-primary',
      onClick: () => applyImport(importText, ''),
    }, h(IconUpload), h('span', null, t('action.parse')))))) : null;

  const helpDialog = helpOpen ? h('div', {
    className: 'pa-scrim',
    onMouseDown: (event) => { if (event.target === event.currentTarget) setHelpOpen(false); },
  },
  h('div', {
    className: 'pa-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pa-help-title',
  },
  h('div', { className: 'pa-dialog-head' },
    h('div', null,
      h('h2', { id: 'pa-help-title' }, t('help.title')),
      h('p', null, t('help.body'))),
    h('button', {
      type: 'button', className: 'pa-icon', 'aria-label': t('action.close'),
      onClick: () => setHelpOpen(false),
    }, h(IconClose))),
  h('div', { className: 'pa-shortcuts' }, SHORTCUTS.map(([key]) => h('div', { className: 'pa-shortcut', key },
    h('span', null, t('help.title')),
    h('strong', null, t(key))))),
  h('p', { className: 'pa-note' }, t('help.data')),
  h('div', { className: 'pa-dialog-actions' },
    h('span', { className: 'pa-spacer' }),
    h('button', {
      type: 'button', className: 'pa-btn pa-primary',
      onClick: () => setHelpOpen(false),
    }, t('action.close'))))) : null;

  return h('div', { className: 'pa-root' },
    h('style', null, CSS),
    h('header', { className: 'pa-top' },
      h('div', { className: 'pa-brand' },
        h('span', { className: 'pa-logo' }, h(IconAtlas)),
        h('span', { className: 'pa-brand-text' },
          h('strong', null, 'Pipe Atlas'),
          h('small', null, t('panel.subtitle')))),
      h('span', { className: 'pa-spacer' }),
      h('div', { className: 'pa-demos', role: 'group', 'aria-label': t('demo.group') },
        DEMOS.map((demo) => h('button', {
          key: demo.id,
          type: 'button',
          className: 'pa-demo',
          'aria-pressed': source.kind === 'demo' && source.id === demo.id,
          onClick: () => loadDemo(demo.id),
        }, t(`demo.${demo.id}`)))),
      h('button', {
        type: 'button', className: 'pa-btn',
        onClick: () => { setImportError(''); setImportOpen(true); },
      }, h(IconUpload), h('span', { className: 'pa-btn-label' }, t('action.import'))),
      h('div', { className: 'pa-export', ref: exportRef },
        h('button', {
          type: 'button', className: 'pa-btn', 'aria-haspopup': 'menu', 'aria-expanded': exportOpen,
          onClick: () => setExportOpen((value) => !value),
        }, h(IconDownload), h('span', { className: 'pa-btn-label' }, t('action.export')), h('span', { 'aria-hidden': true }, '▾')),
        exportOpen ? h('div', { className: 'pa-menu', role: 'menu' },
          [['svg', 'SVG'], ['png', 'PNG'], ['json', 'JSON']].map(([kind, label]) => h('button', {
            key: kind, type: 'button', role: 'menuitem',
            onClick: () => doExport(kind),
          }, h('span', null, label), h('small', null, t(`export.${kind}`))))) : null),
      h('button', {
        type: 'button', className: 'pa-icon', 'aria-label': t('action.help'), title: t('action.help'),
        onClick: () => setHelpOpen(true),
      }, '?')),

    info ? h('div', { className: 'pa-info' },
      info.title ? h('span', { className: 'pa-info-title' }, info.title) : null,
      h('span', { className: 'pa-state' }, `${t('status.schema')} ${info.version}`),
      h('span', { className: 'pa-state pa-hide' }, `${info.tasks} ${t('status.tasks')}`),
      h('span', { className: 'pa-state pa-hide' }, `${info.cores} ${t('status.cores')}`),
      h('span', { className: 'pa-state pa-hide' }, `${info.events} ${t('status.events')}`),
      h('span', { className: `pa-state${info.kind === 'synthetic' ? ' is-synthetic' : ''}` },
        info.kind === 'synthetic' ? t('status.synthetic') : t('status.imported')),
      h('span', { className: 'pa-state' }, sourceLabel),
      warningCount ? h('button', {
        type: 'button', className: 'pa-warn', 'aria-expanded': warningsOpen,
        onClick: () => setWarningsOpen((value) => !value),
      }, `${warningCount} ${t('status.warnings')}`) : null) : null,

    warningsOpen && warningCount ? h('div', { className: 'pa-warnings' },
      h('ul', null, info.warnings.map((warning, index) => h('li', { key: index }, warning)))) : null,

    error ? h('div', { className: 'pa-error', role: 'alert' },
      h(IconAlert),
      h('span', null, error),
      h('button', {
        type: 'button', 'aria-label': t('action.dismiss'), title: t('action.dismiss'),
        onClick: () => setError(''),
      }, h(IconClose))) : null,

    h('div', {
      className: `pa-stage${dragging ? ' is-dragging' : ''}`,
      ref: stageRef,
      onDragOver: (event) => { event.preventDefault(); setDragging(true); },
      onDragLeave: (event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        setDragging(false);
      },
      onDrop: (event) => {
        event.preventDefault();
        setDragging(false);
        readFile(event.dataTransfer.files && event.dataTransfer.files[0]);
      },
    }, dragging ? h('span', { className: 'pa-drop-hint' }, t('import.drop')) : null),

    h('input', {
      ref: fileInputRef,
      type: 'file',
      accept: '.json,application/json',
      style: { display: 'none' },
      onChange: (event) => {
        readFile(event.target.files && event.target.files[0]);
        event.target.value = '';
      },
    }),

    importDialog,
    helpDialog,

    notice ? h('div', { className: 'pa-toast', role: 'status' }, notice.text) : null);
}

function PipeAtlasIcon({ size = 18 }) {
  return h(IconAtlas, { size });
}

function makeStore(read) {
  let value = read();
  const listeners = new Set();
  return {
    get: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    refresh() {
      const next = read();
      if (next === value) return;
      value = next;
      for (const listener of listeners) listener();
    },
  };
}

return {
  inject: ['slots', 'locale'],
  apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, {
      en: LOCALE_EN,
      zh: LOCALE_ZH,
    }), 'dsh-pipe-atlas: locale dictionaries');

    const t = ctx.locale.bind(NS);
    const themeService = ctx.get ? ctx.get('theme') : undefined;
    const themeStore = makeStore(() => {
      if (!themeService) return 'light';
      try {
        return themeService.getTheme().active.colorScheme === 'dark' ? 'dark' : 'light';
      } catch {
        return 'light';
      }
    });

    if (themeService) {
      ctx.effect(() => ctx.on('theme/change', () => themeStore.refresh()), 'dsh-pipe-atlas: theme sync');
    }

    ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main',
      key: PANEL_ID,
      locale: NS,
      inject: () => ({ themeStore }),
    }, PipeAtlasPanel));

    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist',
      id: PANEL_ID,
      order: 12,
      locale: NS,
      label: () => t('panel.title'),
    }, PipeAtlasIcon));
  },
};
