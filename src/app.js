/* Client half of the Pipe Atlas bundle.
 *
 * The build step prepends the vendored Pipe Atlas Web Component sources
 * (`icons.js`, `component-style.js`, `model.js`, `pipe-timeline.js`) and the
 * demo traces (`DEMO_DATA`); this file only owns the Harness panel shell.
 */

const PANEL_ID = 'dsh-pipe-atlas';
const NS = 'dsh-pipe-atlas';
const { useEffect, useRef, useState, useSyncExternalStore } = React;
const VIEWER_TAG = '__PIPE_ATLAS_VIEWER_TAG__';

const DEMOS = [
  { id: 'scheduling', icon: 'clock' },
  { id: 'network', icon: 'layers' },
  { id: 'earlyStart', icon: 'overlap' },
  { id: 'minimal', icon: 'file' },
];

const STILL_THEME = {
  get: () => 'light',
  subscribe: () => () => {},
};

const CSS = `
.pa-root{position:relative;display:flex;height:100%;min-height:0;width:100%;overflow:hidden;background:#f5f7fa;color:#28374c;font:13px/1.5 Inter,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;--pa-bg:#f5f7fa;--pa-surface:#fff;--pa-border:#e7ecf2;--pa-text:#28374c;--pa-muted:#8a96a6;--pa-green:#168f78;--pa-green-light:#ecf6f2;--pa-side:#142533;--pa-mono:"SFMono-Regular",Consolas,"Liberation Mono",monospace;color-scheme:light}
.pa-root[data-theme=dark]{--pa-bg:#0e1925;--pa-surface:#14212f;--pa-border:#293a4c;--pa-text:#dbe5ef;--pa-muted:#8a9caf;--pa-green:#65d7bb;--pa-green-light:#203e3d;--pa-side:#101c28;color-scheme:dark}
.pa-root *{box-sizing:border-box}
.pa-shell{display:flex;height:100%;min-height:0;width:100%;overflow:hidden}
.pa-glyph{display:inline-flex;align-items:center;justify-content:center;flex:none}
.pa-glyph svg{display:block}

/* rail */
.pa-rail{flex:none;width:208px;display:flex;flex-direction:column;min-height:0;overflow-x:hidden;overflow-y:auto;scrollbar-width:none;background:var(--pa-side);color:#9aafbd;padding:26px 15px 14px}
.pa-rail::-webkit-scrollbar{display:none}
.pa-brand{display:flex;align-items:center;gap:11px;padding:0 8px;color:#f3f9fc;flex:none}
.pa-brand-mark{width:28px;height:34px;position:relative;flex:none}
.pa-brand-mark i{position:absolute;left:0;width:21px;height:5px;border-radius:2px;background:#70dbb8}
.pa-brand-mark i:nth-child(1){top:2px}
.pa-brand-mark i:nth-child(2){top:14px;left:7px}
.pa-brand-mark i:nth-child(3){top:26px}
.pa-brand-name{font-size:20px;font-weight:600;letter-spacing:-.8px;line-height:1;white-space:nowrap}
.pa-brand-name b{font-weight:300;color:#b3c8cf}
.pa-brand small{display:block;font:7px var(--pa-mono);letter-spacing:1.8px;margin-top:5px;color:#829daa}
.pa-rail-label{display:flex;justify-content:space-between;align-items:center;font-size:8.5px;letter-spacing:1.7px;color:#607e8f;margin:28px 10px 9px;flex:none}
.pa-rail-label span{font:8.5px var(--pa-mono);color:#668493}
.pa-nav{display:grid;gap:4px;flex:none}
.pa-nav button{display:flex;align-items:center;gap:10px;width:100%;border:0;border-radius:7px;background:none;color:#a8bbc7;padding:10px 11px;font:inherit;font-size:11.5px;text-align:left;cursor:pointer}
.pa-nav button:hover{background:#ffffff08}
.pa-nav button.active{background:#274139;color:#8de2c3}
.pa-nav .pa-nav-dot{margin-left:auto;width:4px;height:4px;border-radius:50%;background:#79d9b6}
.pa-nav .pa-kbd{margin-left:auto;font:8px var(--pa-mono);opacity:.42;white-space:nowrap}
.pa-demos{display:grid;gap:5px;flex:none;margin-top:4px}
.pa-demo-card{display:flex;align-items:center;gap:9px;width:100%;padding:9px 8px;text-align:left;color:#a5b7c4;border:1px solid transparent;border-radius:7px;background:transparent;cursor:pointer}
.pa-demo-card:hover{background:#ffffff06}
.pa-demo-card[aria-pressed=true]{background:#1b303d;border-color:#2a4651}
.pa-demo-icon{width:26px;height:28px;border-radius:6px;background:#ffffff07;display:grid;place-items:center;flex:none;color:#70c3a8}
.pa-demo-card[aria-pressed=true] .pa-demo-icon{color:#8de2c3;background:#ffffff0a}
.pa-demo-text{min-width:0;flex:1}
.pa-demo-text strong{display:block;font-size:10px;font-weight:500;color:#d7e3e9;letter-spacing:.1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pa-demo-text small{display:block;font-size:8.5px;margin-top:3px;color:#718e9e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pa-demo-dot{width:4px;height:4px;border-radius:50%;background:#6cae97;opacity:0;flex:none}
.pa-demo-card[aria-pressed=true] .pa-demo-dot{opacity:1}
.pa-rail-bottom{margin-top:auto;padding-top:24px;flex:none}
.pa-rail-card{border:1px solid #2a414f;border-radius:9px;padding:13px;background:linear-gradient(145deg,#213a44,#192c39);font-size:9.5px;color:#97b2bf}
.pa-rail-card-title{display:flex;align-items:center;gap:6px;color:#d0e5e7;font-size:10.5px;font-weight:500}
.pa-rail-card-title .pa-glyph{color:#88c1b0}
.pa-rail-card p{line-height:1.85;margin:9px 0}
.pa-rail-card button{display:flex;align-items:center;justify-content:space-between;width:100%;border:0;border-top:1px solid #314d56;background:none;color:#8bd9bb;padding:9px 0 0;font:inherit;font-size:9.5px;cursor:pointer}
.pa-rail-version{display:flex;align-items:center;gap:6px;border-top:1px solid #293e4a;margin-top:13px;padding:13px 8px 0;color:#668291;font-size:9px;white-space:nowrap}
.pa-rail-version .pa-status-dot{width:4px;height:4px;border-radius:50%;background:#74b79b;flex:none}
.pa-rail-version span{margin-left:auto;font-family:var(--pa-mono)}
.pa-rail-version .pa-version-text{margin-left:0;font-family:inherit}

/* page */
.pa-page{flex:1;min-width:0;display:flex;flex-direction:column;background:var(--pa-bg);color:var(--pa-text)}
.pa-topbar{height:56px;flex:none;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 26px;background:var(--pa-surface);border-bottom:1px solid var(--pa-border)}
.pa-crumb{font-size:11px;color:var(--pa-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pa-crumb span{margin:0 11px;opacity:.5}
.pa-crumb strong{font-weight:500;color:var(--pa-text)}
.pa-topright{display:flex;align-items:center;gap:13px;flex:none}
.pa-local{display:flex;align-items:center;gap:6px;color:var(--pa-muted);font-size:9.5px;white-space:nowrap}
.pa-local i{width:5px;height:5px;border-radius:50%;background:#4daf90;flex:none}
.pa-src{color:var(--pa-muted);font-size:9.5px;text-decoration:none;white-space:nowrap}
.pa-src:hover{color:var(--pa-green)}
.pa-vdiv{width:1px;height:18px;background:var(--pa-border);flex:none}
.pa-avatar{width:26px;height:26px;border-radius:50%;background:var(--pa-green-light);border:1px solid var(--pa-border);color:var(--pa-green);display:grid;place-items:center;font:9px var(--pa-mono);flex:none}
.pa-topbtn{border:0;background:transparent;color:var(--pa-muted);padding:4px;border-radius:6px;display:inline-flex;cursor:pointer}
.pa-topbtn:hover{background:var(--pa-bg);color:var(--pa-green)}
.pa-scroll{flex:1;min-height:0;overflow:auto;padding:24px 28px 16px}
.pa-heading{display:flex;justify-content:space-between;align-items:center;gap:18px;margin-bottom:23px}
.pa-heading-main{min-width:0}
.pa-eyebrow{font:8.5px var(--pa-mono);letter-spacing:1.8px;color:var(--pa-green);margin-bottom:7px;white-space:nowrap}
.pa-heading h1{font-size:26px;font-weight:600;letter-spacing:-1.2px;margin:0;line-height:1.2;white-space:nowrap}
.pa-heading h1 span{color:var(--pa-green);margin-left:2px}
.pa-heading p{color:var(--pa-muted);font-size:10.5px;margin:7px 0 0;letter-spacing:.1px}
.pa-actions{display:flex;align-items:center;gap:8px;padding-top:11px;flex:none;position:relative}
.pa-button{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:34px;padding:0 13px;border:1px solid var(--pa-border);border-radius:7px;background:var(--pa-surface);color:var(--pa-text);font:inherit;font-size:11px;white-space:nowrap;cursor:pointer}
.pa-button:hover{border-color:var(--pa-green)}
.pa-button.primary{background:#188b75;border-color:#188b75;color:#fff;box-shadow:0 2px 3px #0d5a4610}
.pa-button.primary:hover{background:#11775f;border-color:#11775f}
.pa-button:focus-visible,.pa-demo-card:focus-visible,.pa-nav button:focus-visible,.pa-topbtn:focus-visible,.pa-drop:focus-visible,.pa-iconbtn:focus-visible{outline:2px solid var(--pa-green);outline-offset:2px}
.pa-export-wrap{position:relative;display:inline-flex}
.pa-menu{position:absolute;right:0;top:calc(100% + 7px);min-width:196px;padding:5px;display:flex;flex-direction:column;gap:1px;border:1px solid var(--pa-border);border-radius:8px;background:var(--pa-surface);box-shadow:0 12px 34px #11233322;z-index:40}
.pa-menu button{display:flex;align-items:center;justify-content:space-between;gap:14px;width:100%;border:0;border-radius:5px;background:none;color:var(--pa-text);padding:8px 9px;font:inherit;font-size:10.5px;text-align:left;cursor:pointer}
.pa-menu button:hover{background:var(--pa-green-light)}
.pa-menu small{color:var(--pa-muted);font-size:9px;white-space:nowrap}
.pa-dataset{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:13px;min-height:24px}
.pa-dataset-name{display:flex;align-items:center;gap:8px;min-width:0;color:var(--pa-muted)}
.pa-dataset-name strong{font-size:11px;font-weight:500;color:var(--pa-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pa-tag{font:8px var(--pa-mono);letter-spacing:.5px;color:var(--pa-green);padding:2px 5px;border:1px solid color-mix(in srgb,var(--pa-green) 25%,var(--pa-border));border-radius:4px;white-space:nowrap;background:var(--pa-green-light)}
.pa-dataset-meta{display:flex;align-items:center;gap:9px;color:var(--pa-muted);font:9px var(--pa-mono);white-space:nowrap;flex:none}
.pa-meta-dot{opacity:.4}
.pa-warnbtn{display:inline-flex;align-items:center;gap:4px;border:1px solid color-mix(in srgb,#c58a1c 32%,var(--pa-border));border-radius:4px;background:transparent;color:#b07a1c;padding:1px 5px;font:9px var(--pa-mono);cursor:pointer}
.pa-root[data-theme=dark] .pa-warnbtn{color:#e3b777}
.pa-warnings{margin:0 0 12px;padding:8px 11px;max-height:118px;overflow:auto;border:1px solid color-mix(in srgb,#c58a1c 30%,var(--pa-border));border-radius:7px;background:color-mix(in srgb,#c58a1c 6%,var(--pa-surface));color:var(--pa-muted);font-size:10.5px;line-height:1.65}
.pa-warnings ul{margin:0;padding-left:16px}
.pa-error{display:flex;align-items:flex-start;gap:8px;margin:0 0 12px;padding:9px 11px;border:1px solid #e5a3a3;border-radius:7px;background:#fdf0f0;color:#ab4545;font-size:10.5px;line-height:1.6}
.pa-root[data-theme=dark] .pa-error{border-color:#6d3b3b;background:#2a1a1c;color:#f0a8a8}
.pa-error span{flex:1;min-width:0;overflow-wrap:anywhere;white-space:pre-wrap}
.pa-error button{flex:none;border:0;background:transparent;color:inherit;padding:0 2px;line-height:1;cursor:pointer}
.pa-stage{position:relative;min-height:320px}
.pa-stage>.pa-viewer{display:block}
.pa-stage.is-dragging::after{content:"";position:absolute;inset:6px;border:1.5px dashed var(--pa-green);border-radius:10px;background:color-mix(in srgb,var(--pa-green) 6%,transparent);pointer-events:none;z-index:2}
.pa-drop-hint{position:absolute;left:50%;top:12px;transform:translateX(-50%);z-index:3;padding:5px 11px;border-radius:999px;background:var(--pa-surface);border:1px solid var(--pa-border);box-shadow:0 6px 18px #11233322;font-size:10.5px;color:var(--pa-muted);pointer-events:none;white-space:nowrap}
.pa-footer{display:flex;align-items:center;justify-content:space-between;gap:15px;color:var(--pa-muted);font-size:9px;padding:19px 1px 0}
.pa-footer>span{display:flex;align-items:center;gap:8px;min-width:0}
.pa-footer .pa-square{width:5px;height:5px;border:1px solid #9cbaa9;border-radius:1px;display:inline-block;flex:none}
.pa-footer .pa-footer-right{font-family:var(--pa-mono);font-size:8px;white-space:nowrap}
.pa-footer i{font-style:normal;color:#c3ccd2;margin:0 3px}
.pa-root[data-theme=dark] .pa-footer i{color:#4d6072}

/* dialogs */
.pa-scrim{position:fixed;inset:0;z-index:120;display:grid;place-items:center;padding:22px;background:#10263580;backdrop-filter:blur(3px)}
.pa-dialog{width:min(600px,100%);max-height:min(88vh,760px);overflow:auto;padding:25px;border:1px solid var(--pa-border);border-radius:14px;background:var(--pa-surface);color:var(--pa-text);box-shadow:0 20px 90px #07172140}
.pa-dialog.wide{width:min(760px,100%)}
.pa-dialog-head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}
.pa-dialog-head h2{font-size:21px;letter-spacing:-.7px;margin:0;font-weight:600;line-height:1.3}
.pa-dialog-head .pa-eyebrow{margin-bottom:7px}
.pa-dialog-desc{font-size:10.5px;color:var(--pa-muted);line-height:1.8;margin:12px 0 18px}
.pa-iconbtn{flex:none;border:0;background:transparent;color:var(--pa-muted);padding:5px;border-radius:6px;display:inline-flex;cursor:pointer}
.pa-iconbtn:hover{background:var(--pa-bg);color:var(--pa-green)}
.pa-drop{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;width:100%;border:1px dashed #9cbbb2;border-radius:10px;background:var(--pa-green-light);padding:22px;color:var(--pa-green);cursor:pointer;font:inherit}
.pa-drop:hover{border-style:solid;box-shadow:inset 0 0 0 1px var(--pa-green)}
.pa-drop strong{font-size:11.5px;font-weight:500}
.pa-drop small{font-size:9.5px;color:var(--pa-muted)}
.pa-or{display:flex;align-items:center;gap:11px;margin:16px 0;color:var(--pa-muted);font-size:9.5px}
.pa-or::before,.pa-or::after{content:"";flex:1;height:1px;background:var(--pa-border)}
.pa-textarea{width:100%;height:150px;resize:vertical;border:1px solid var(--pa-border);border-radius:7px;padding:11px;background:var(--pa-bg);color:var(--pa-text);font:10px/1.8 var(--pa-mono);outline:none}
.pa-textarea:focus{border-color:var(--pa-green)}
.pa-textarea::placeholder{color:var(--pa-muted);opacity:.7}
.pa-dialog-error{margin-top:11px;padding:9px 10px;border:1px solid #e5a3a3;border-radius:6px;background:#fdf0f0;color:#ab4545;font:10px/1.7 var(--pa-mono);white-space:pre-wrap;overflow-wrap:anywhere;max-height:130px;overflow:auto}
.pa-root[data-theme=dark] .pa-dialog-error{border-color:#6d3b3b;background:#2a1a1c;color:#f0a8a8}
.pa-dialog-actions{display:flex;align-items:center;gap:8px;margin-top:16px}
.pa-dialog-actions .pa-spacer{flex:1}
.pa-textbtn{border:0;background:none;color:var(--pa-green);padding:0;font:inherit;font-size:10.5px;cursor:pointer}
.pa-shortcuts{margin:16px 0 4px;border:1px solid var(--pa-border);border-radius:8px;overflow:hidden}
.pa-shortcut{display:flex;justify-content:space-between;gap:16px;padding:9px 11px;font-size:11px;border-bottom:1px solid var(--pa-border)}
.pa-shortcut:last-child{border-bottom:0}
.pa-shortcut span{color:var(--pa-muted);font-family:var(--pa-mono);font-size:10px}
.pa-shortcut strong{font-weight:500;text-align:right}
.pa-note{font-size:10.5px;color:var(--pa-muted);line-height:1.85;margin:12px 0 0}
.pa-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:140;max-width:min(460px,calc(100vw - 48px));padding:10px 18px;border:1px solid #42715f;border-radius:8px;background:#17392f;color:#c9f4e0;font-size:11.5px;box-shadow:0 10px 40px #0002;text-align:center}

.pa-root[data-layout=mid] .pa-rail{width:188px;padding-left:12px;padding-right:12px}
.pa-root[data-layout=mid] .pa-scroll{padding:22px 22px 15px}
.pa-root[data-layout=mid] .pa-brand-name{font-size:19px}
.pa-root[data-layout=mid] .pa-rail-card{padding:11px}
.pa-root[data-layout=mid] .pa-heading h1{font-size:24px}
.pa-root[data-layout=rail] .pa-rail{width:64px;padding:24px 7px 14px;align-items:center}
.pa-root[data-layout=rail] .pa-brand{padding:0}
.pa-root[data-layout=rail] .pa-brand-mark{width:26px;height:32px}
.pa-root[data-layout=rail] .pa-brand-name,.pa-root[data-layout=rail] .pa-brand small,.pa-root[data-layout=rail] .pa-rail-label,.pa-root[data-layout=rail] .pa-demo-text,.pa-root[data-layout=rail] .pa-rail-card,.pa-root[data-layout=rail] .pa-rail-version span,.pa-root[data-layout=rail] .pa-rail-version .pa-version-text,.pa-root[data-layout=rail] .pa-nav span.pa-nav-text,.pa-root[data-layout=rail] .pa-nav .pa-kbd{display:none}
.pa-root[data-layout=rail] .pa-nav{width:100%;margin-top:28px}
.pa-root[data-layout=rail] .pa-nav button{justify-content:center;padding:12px}
.pa-root[data-layout=rail] .pa-nav .pa-nav-dot{display:none}
.pa-root[data-layout=rail] .pa-demos{width:100%;margin-top:12px}
.pa-root[data-layout=rail] .pa-demo-card{justify-content:center;padding:8px}
.pa-root[data-layout=rail] .pa-demo-dot{display:none}
.pa-root[data-layout=rail] .pa-rail-bottom{padding-top:15px;width:100%}
.pa-root[data-layout=rail] .pa-rail-version{justify-content:center;padding-left:0;padding-right:0;border-top:0;margin-top:0}
.pa-root[data-layout=rail] .pa-rail-version .pa-status-dot{display:none}
.pa-root[data-layout=rail] .pa-scroll{padding:20px 20px 14px}
.pa-root[data-layout=rail] .pa-local,.pa-root[data-layout=rail] .pa-src{display:none}
.pa-root[data-layout=rail] .pa-heading h1{font-size:23px}
.pa-root[data-layout=narrow] .pa-rail,.pa-root[data-layout=tiny] .pa-rail{display:none}
.pa-root[data-layout=narrow] .pa-scroll,.pa-root[data-layout=tiny] .pa-scroll{padding:18px 16px 13px}
.pa-root[data-layout=narrow] .pa-topbar,.pa-root[data-layout=tiny] .pa-topbar{padding:0 16px}
.pa-root[data-layout=narrow] .pa-heading h1{font-size:22px}
.pa-root[data-layout=narrow] .pa-heading p{font-size:10px}
.pa-root[data-layout=narrow] .pa-heading{align-items:flex-start;gap:10px}
.pa-root[data-layout=narrow] .pa-actions{padding-top:16px}
.pa-root[data-layout=narrow] .pa-heading .pa-button span.pa-btn-label{display:none}
.pa-root[data-layout=narrow] .pa-button{padding:0 10px}
.pa-root[data-layout=narrow] .pa-dataset-meta .pa-device,.pa-root[data-layout=narrow] .pa-dataset-meta .pa-meta-dot{display:none}
.pa-root[data-layout=narrow] .pa-footer-right{display:none}
.pa-root[data-layout=tiny] .pa-eyebrow{font-size:7px;letter-spacing:1.2px}
.pa-root[data-layout=tiny] .pa-heading h1{font-size:21px}
.pa-root[data-layout=tiny] .pa-heading p{display:none}
.pa-root[data-layout=tiny] .pa-scroll{padding:16px 12px 12px}
.pa-root[data-layout=tiny] .pa-dataset-name strong{max-width:180px}
.pa-root[data-layout=tiny] .pa-actions .pa-button{font-size:10px;padding:0 8px}
.pa-root[data-layout=tiny] .pa-dialog{padding:18px}
.pa-root[data-layout=tiny] .pa-btn-label{display:none}
@media (prefers-reduced-motion:reduce){.pa-root *{transition:none!important}}
`;

const SHORTCUTS = ['help.drag', 'help.zoom', 'help.measure', 'help.dblclick', 'help.keys'];

function Glyph({ name, size = 15 }) {
  return h('span', {
    className: 'pa-glyph',
    'aria-hidden': true,
    dangerouslySetInnerHTML: { __html: icon(name, size) },
  });
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

  const rootRef = useRef(null);
  const scrollRef = useRef(null);
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
  const [layout, setLayout] = useState('wide');

  const say = (text) => setNotice({ id: `${Date.now()}-${Math.random()}`, text });

  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const apply = (width) => {
      setLayout(width >= 1180 ? 'wide' : width >= 1000 ? 'mid' : width >= 760 ? 'rail' : width >= 520 ? 'narrow' : 'tiny');
    };
    const observer = new ResizeObserver((entries) => {
      apply(entries[0]?.contentRect?.width || node.clientWidth);
    });
    observer.observe(node);
    apply(node.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const viewer = document.createElement(VIEWER_TAG);
    viewer.className = 'pa-viewer';
    viewer.setAttribute('theme', themeStore.get() === 'dark' ? 'dark' : 'light');
    viewer.setAttribute('aria-label', 'Pipe Atlas execution timeline');
    const onLoad = (event) => {
      const detail = event.detail || {};
      let trace = null;
      try { trace = viewerRef.current ? viewerRef.current.data : null; } catch { trace = null; }
      setInfo({
        title: detail.metadata?.title || trace?.metadata?.title || '',
        device: detail.metadata?.device || '',
        version: detail.schemaVersion || trace?.schemaVersion || '',
        kind: detail.metadata?.source?.kind || '',
        tasks: trace?.tasks?.length || 0,
        cores: trace?.cores?.length || 0,
        events: trace?.scenarios?.[0]?.events?.length || 0,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importOpen]);

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

  const focusTimeline = () => {
    if (scrollRef.current) scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    if (viewerRef.current) viewerRef.current.focus();
  };

  const sourceLabel = source.kind === 'demo'
    ? t(`demo.${source.id}`)
    : source.name;

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
      h('div', { className: 'pa-eyebrow' }, t('import.eyebrow')),
      h('h2', { id: 'pa-import-title' }, t('import.title'))),
    h('button', {
      type: 'button', className: 'pa-iconbtn', 'aria-label': t('action.close'),
      onClick: () => { setImportOpen(false); setImportError(''); },
    }, h(Glyph, { name: 'close', size: 14 }))),
  h('p', { className: 'pa-dialog-desc' }, t('import.description')),
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
  h(Glyph, { name: 'upload', size: 24 }),
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
      type: 'button', className: 'pa-textbtn',
      onClick: () => { setImportText(JSON.stringify(DEMO_DATA.minimal, null, 2)); setImportError(''); },
    }, t('action.loadDemo')),
    h('span', { className: 'pa-spacer' }),
    h('button', {
      type: 'button', className: 'pa-button',
      onClick: () => { setImportOpen(false); setImportError(''); },
    }, t('action.cancel')),
    h('button', {
      type: 'button', className: 'pa-button primary',
      onClick: () => applyImport(importText, ''),
    }, h(Glyph, { name: 'arrow', size: 13 }), h('span', null, t('action.parse')))))) : null;

  const helpDialog = helpOpen ? h('div', {
    className: 'pa-scrim',
    onMouseDown: (event) => { if (event.target === event.currentTarget) setHelpOpen(false); },
  },
  h('div', {
    className: 'pa-dialog wide', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pa-help-title',
  },
  h('div', { className: 'pa-dialog-head' },
    h('div', null,
      h('div', { className: 'pa-eyebrow' }, t('help.eyebrow')),
      h('h2', { id: 'pa-help-title' }, t('help.title'))),
    h('button', {
      type: 'button', className: 'pa-iconbtn', 'aria-label': t('action.close'),
      onClick: () => setHelpOpen(false),
    }, h(Glyph, { name: 'close', size: 14 }))),
  h('p', { className: 'pa-dialog-desc' }, t('help.body')),
  h('div', { className: 'pa-shortcuts' }, SHORTCUTS.map((key) => h('div', { className: 'pa-shortcut', key },
    h('span', null, t(`help.${key.split('.')[1]}.key`)),
    h('strong', null, t(key))))),
  h('p', { className: 'pa-note' }, t('help.data')),
  h('div', { className: 'pa-dialog-actions' },
    h('span', { className: 'pa-spacer' }),
    h('button', {
      type: 'button', className: 'pa-button primary',
      onClick: () => setHelpOpen(false),
    }, t('action.close'))))) : null;

  return h('div', { className: 'pa-root', 'data-theme': theme, 'data-layout': layout, ref: rootRef },
    h('style', null, CSS),
    h('div', { className: 'pa-shell' },
      h('aside', { className: 'pa-rail', 'aria-label': 'Pipe Atlas' },
        h('div', { className: 'pa-brand' },
          h('span', { className: 'pa-brand-mark', 'aria-hidden': true }, h('i'), h('i'), h('i')),
          h('span', { className: 'pa-brand-name' }, 'Pipe', h('b', null, 'Atlas'), h('small', null, 'EXECUTION EXPLORER'))),
        h('div', { className: 'pa-rail-label' }, t('rail.workspace'), h('span', null, '01')),
        h('nav', { className: 'pa-nav', 'aria-label': t('rail.workspace') },
          h('button', { type: 'button', className: 'active', 'aria-label': t('rail.timeline'), title: t('rail.timeline'), onClick: focusTimeline },
            h(Glyph, { name: 'activity', size: 15 }),
            h('span', { className: 'pa-nav-text' }, t('rail.timeline')),
            h('span', { className: 'pa-nav-dot', 'aria-hidden': true })),
          h('button', { type: 'button', 'aria-label': t('rail.import'), title: t('rail.import'), onClick: () => { setImportError(''); setImportOpen(true); } },
            h(Glyph, { name: 'upload', size: 15 }),
            h('span', { className: 'pa-nav-text' }, t('rail.import')),
            h('span', { className: 'pa-kbd' }, 'JSON')),
          h('button', { type: 'button', 'aria-label': t('rail.embed'), title: t('rail.embed'), onClick: () => setHelpOpen(true) },
            h(Glyph, { name: 'code', size: 15 }),
            h('span', { className: 'pa-nav-text' }, t('rail.embed')),
            h('span', { className: 'pa-kbd' }, '</>'))),
        h('div', { className: 'pa-rail-label' }, t('rail.section'), h('span', null, String(DEMOS.length))),
        h('div', { className: 'pa-demos' }, DEMOS.map((demo) => h('button', {
          key: demo.id,
          type: 'button',
          className: 'pa-demo-card',
          'aria-pressed': source.kind === 'demo' && source.id === demo.id,
          title: t(`demo.${demo.id}`),
          onClick: () => loadDemo(demo.id),
        },
        h('span', { className: 'pa-demo-icon' }, h(Glyph, { name: demo.icon, size: 14 })),
        h('span', { className: 'pa-demo-text' },
          h('strong', null, t(`demo.${demo.id}`)),
          h('small', null, t(`demo.${demo.id}.note`))),
        h('span', { className: 'pa-demo-dot', 'aria-hidden': true })))),
        h('div', { className: 'pa-rail-bottom' },
          h('div', { className: 'pa-rail-card' },
            h('div', { className: 'pa-rail-card-title' }, h(Glyph, { name: 'code', size: 14 }), t('rail.cardTitle')),
            h('p', null, t('rail.cardBody')),
            h('button', { type: 'button', 'aria-label': t('rail.embed'), title: t('rail.embed'), onClick: () => setHelpOpen(true) },
              t('rail.cardAction'),
              h(Glyph, { name: 'arrow', size: 13 }))),
          h('div', { className: 'pa-rail-version' },
            h('i', { className: 'pa-status-dot', 'aria-hidden': true }),
            h('span', { className: 'pa-version-text' }, 'Pipe Atlas'), h('span', null, 'v1.2')))),

      h('div', { className: 'pa-page' },
        h('header', { className: 'pa-topbar' },
          h('div', { className: 'pa-crumb' }, t('rail.workspace'), h('span', null, '/'), h('strong', null, t('rail.timeline'))),
          h('div', { className: 'pa-topright' },
            h('span', { className: 'pa-local' }, h('i'), t('topbar.local')),
            h('a', { className: 'pa-src', href: 'https://gitcode.com/Ascend/msinsight', target: '_blank', rel: 'noopener noreferrer' },
              t('topbar.source'), ' ↗'),
            h('span', { className: 'pa-vdiv', 'aria-hidden': true }),
            h('button', {
              type: 'button', className: 'pa-topbtn', 'aria-label': t('action.help'), title: t('action.help'),
              onClick: () => setHelpOpen(true),
            }, h(Glyph, { name: 'help', size: 16 })),
            h('span', { className: 'pa-avatar' }, 'PA'))),

        h('div', { className: 'pa-scroll', ref: scrollRef },
          h('div', { className: 'pa-heading' },
            h('div', { className: 'pa-heading-main' },
              h('div', { className: 'pa-eyebrow' }, t('heading.eyebrow')),
              h('h1', null, t('heading.title'), h('span', null, '.')),
              h('p', null, t('heading.subtitle'))),
            h('div', { className: 'pa-actions' },
              h('div', { className: 'pa-export-wrap', ref: exportRef },
                h('button', {
                  type: 'button', className: 'pa-button',
                  'aria-label': t('action.export'), 'aria-haspopup': 'menu', 'aria-expanded': exportOpen,
                  onClick: () => setExportOpen((value) => !value),
                }, h(Glyph, { name: 'download', size: 14 }),
                h('span', { className: 'pa-btn-label' }, t('action.export')),
                h('span', { 'aria-hidden': true }, '⌄')),
                exportOpen ? h('div', { className: 'pa-menu', role: 'menu' },
                  [['svg', 'SVG'], ['png', 'PNG'], ['json', 'JSON']].map(([kind, label]) => h('button', {
                    key: kind, type: 'button', role: 'menuitem',
                    onClick: () => doExport(kind),
                  }, h('span', null, label), h('small', null, t(`export.${kind}`))))) : null),
              h('button', {
                type: 'button', className: 'pa-button primary', 'aria-label': t('action.import'),
                onClick: () => { setImportError(''); setImportOpen(true); },
              }, h(Glyph, { name: 'upload', size: 14 }),
              h('span', { className: 'pa-btn-label' }, t('action.import'))))),

          h('div', { className: 'pa-dataset' },
            h('div', { className: 'pa-dataset-name' },
              h(Glyph, { name: 'cpu', size: 15 }),
              h('strong', null, info && info.title ? info.title : sourceLabel),
              h('span', { className: 'pa-tag' }, info && info.kind === 'synthetic' ? t('dataset.synthetic') : t('dataset.custom'))),
            h('div', { className: 'pa-dataset-meta' },
              h('span', { className: 'pa-device' }, info && info.device ? info.device : t('dataset.deviceFallback')),
              h('span', { className: 'pa-meta-dot' }, '·'),
              h('span', null, `${t('status.schema')} ${info && info.version ? info.version : '—'}`),
              warningCount ? h('button', {
                type: 'button', className: 'pa-warnbtn', 'aria-expanded': warningsOpen,
                onClick: () => setWarningsOpen((value) => !value),
              }, `${warningCount} ${t('status.warnings')}`) : null)),

          warningsOpen && warningCount ? h('div', { className: 'pa-warnings' },
            h('ul', null, info.warnings.map((warning, index) => h('li', { key: index }, warning)))) : null,

          error ? h('div', { className: 'pa-error', role: 'alert' },
            h(Glyph, { name: 'info', size: 14 }),
            h('span', null, error),
            h('button', {
              type: 'button', 'aria-label': t('action.dismiss'), title: t('action.dismiss'),
              onClick: () => setError(''),
            }, h(Glyph, { name: 'close', size: 12 }))) : null,

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

          h('div', { className: 'pa-footer' },
            h('span', null, h('i', { className: 'pa-square', 'aria-hidden': true }), t('footer.left')),
            h('span', { className: 'pa-footer-right' },
              'SVG renderer', h('i', null, '·'), 'Framework independent', h('i', null, '·'), 'JSON v1.2'))))),

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
  return h('svg', {
    width: size, height: size, viewBox: '0 0 20 20', fill: 'none',
    'aria-hidden': true, style: { display: 'block' },
  },
  h('path', { d: 'M3 5.2h8M3 9.4h11M3 13.6h6', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
  h('path', { d: 'M15.5 3v14', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', opacity: .55 }),
  h('circle', { cx: 15.5, cy: 3.4, r: 1.4, fill: 'currentColor' }));
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
