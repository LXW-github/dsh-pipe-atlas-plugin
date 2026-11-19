# Pipe Atlas · DeepSeek Harness sidebar plugin

[github.com/LXW-github/dsh-pipe-atlas-plugin](https://github.com/LXW-github/dsh-pipe-atlas-plugin)

A left-sidebar panel for **DeepSeek Harness** that renders **Ascend NPU execution pipelines** from a versioned JSON contract: multi-task, multi-core timelines; scheduling and instruction-fetch stages; overlap detection; event inspection; and SVG / PNG / JSON export.

The viewer itself is **Pipe Atlas** — an original, dependency-free Web Component (MIT). This repository packages it as a Harness **bundle**: a Host row plus one Client module that registers a sidebar icon and a full-height main panel.

The panel uses the Harness theme tokens; the timeline keeps Pipe Atlas's own light/dark palette and follows the active Harness theme.

## Features

- **Sidebar entry** — a dedicated icon in `sidebar.panellist`; clicking it opens the panel in the main column, next to Notes, Schedules and Plugins.
- **Outstanding instructions, one row per slot** — a pipe can keep several instructions in flight at once. Rows are packed from each event's `issue → complete` window, so two instructions that overlap in flight occupy different rows even when their execution windows do not. `issueWidth` on a lane declares the hardware depth: unused slots stay visible as `空闲` rows, and the pipe header carries an `N 行` badge.
- **In-flight backdrop** — when `complete` runs past the execution window, the outstanding range is drawn as a dashed backdrop behind the solid execution bar, with the exact window in the tooltip and inspector (plus in-flight duration and slot `O2 / 4`).
- **Collapse** — click the chevron next to a pipe name (or double-click the pipe's label gutter) to fold its slots into one compact row; the core header folds every pipe of that core, and the toolbar folds or expands all pipes at once. A collapsed pipe keeps drawing every event (still hoverable/selectable) and its badge reads `N 行 · 已折叠`.
- **Original workspace shell** — the dark demo rail, breadcrumb top bar, page heading, dataset strip and footer are rebuilt inside the panel, so the viewer keeps the layout of the standalone Pipe Atlas app while the viewer itself stays pixel-identical to upstream.
- **Bundled traces** — outstanding DMA instructions, shared scheduling → fetch → execute, a five-task / four-core network trace, the original Early Start demo, and a minimal three-stage pipeline.
- **Import** — drag a `.json` file anywhere onto the panel, use *Open JSON*, or paste JSON into the dialog. Supports Pipe Atlas v1.0–v1.4, msinsight operator `trace.json`, and Chrome Trace Event JSON; files up to 30 MB.
- **Inspect** — core multi-select, scenario switch, task/kernel filters, search, pan/zoom/measure, dependency lines, scheduling and fetch details, overlap analysis, per-pipe activity.
- **Export** — current viewport as SVG, 2× PNG, or the complete normalized trace as JSON.
- **Theme-aware** — the timeline switches between its light and dark palettes with the Harness theme (`theme/change`), and the shell uses `--dsw-alias-*` tokens.
- **Localized** — English and Simplified Chinese dictionaries for the panel chrome and display metadata.

## Install

Clone the bundle where the Harness profile can link it, then install it from a session:

```bash
git clone https://github.com/LXW-github/dsh-pipe-atlas-plugin.git /home/dsh-plugins/dsh-pipe-atlas-plugin
```

```text
plugin_manager action=install_bundle target=/home/dsh-plugins/dsh-pipe-atlas-plugin
```

`install_bundle` links the directory into the active profile and activates the bundle. Restart the Harness (or reload the page) if the profile does not pick it up through HMR; replacing an already-installed copy of this bundle requires a restart so the browser loads the new `client.js` generation.

Manual profile edits are intentionally not part of this repository — the plugin is a self-contained bundle (`package.json` → `dsh.bundle.patch` → `cordis.patch.yml`).

## Use

1. Click the **Pipe Atlas** icon in the left sidebar. The panel opens on the **Outstanding** demo, the sample that actually needs more than one row per pipe.
2. Pick a demo from the header, or open a JSON trace.
3. Hover an event for details, click to pin it in the inspector; double-click to zoom.
4. Drag to pan, `Ctrl/⌘ + wheel` to zoom, `Shift + drag` to measure, `/` to search.
5. Export the current viewport or the full trace from the header menu.
6. Pipes whose instructions stay outstanding get one row per in-flight slot (`O1`, `O2`, …); a lane with `issueWidth` also shows its unused slots as `空闲` rows.
7. Use the chevrons (`▸` / `▾`) in the pipe gutter, the chevron on a core header, or the two toolbar buttons to collapse and expand slots. Collapsing never hides events; it compresses them into a single row. A pipe only gets a chevron when it really needs more than one row, and the toolbar buttons stay disabled (with a hint) while every pipe is single-row — those demos have no outstanding windows.

### Data contract

The accepted JSON is the Pipe Atlas schema (`vendor/model.js` validates at runtime; a JSON Schema lives upstream). The shape is:

```json
{
  "schemaVersion": "1.4",
  "metadata": { "title": "…", "timeUnit": "us", "source": { "kind": "synthetic" } },
  "devices": [{ "id": "npu0", "label": "NPU 0" }],
  "cores": [{
    "id": "core-0", "label": "Core 0", "deviceId": "npu0",
    "engines": [{ "id": "cubecore0", "type": "AIC" }, { "id": "veccore0", "type": "AIV" }]
  }],
  "lanes": [{ "id": "c0-v", "coreId": "core-0", "engineId": "veccore0", "pipe": "VECTOR" }],
  "kernels": [{ "id": "kernel0" }],
  "tasks": [{ "id": "task0", "kernelId": "kernel0" }],
  "scenarios": [{
    "id": "main", "label": "Main",
    "events": [{ "id": "e0", "taskId": "task0", "laneId": "c0-v", "name": "VADD", "kind": "compute", "start": 10, "duration": 32 }]
  }]
}
```

### msinsight instruction tracks (schema 1.4)

Each lane references an engine instance within its core. A core can expose just the units captured by the trace, including multiple Vector units. Existing traces with `cubeId` / `vectorId` still load. A lane label defaults to its pipe name, and lanes with events or an explicit `issueWidth` are displayed for the selected scenario.

The importer groups recognized `coreN.cubecoreM` and `coreN.veccoreM` process names under the same physical core. It keeps each raw `pid` / `tid` pair separate, even when display aliases normalize to the same name. A lane's `trace` retains those IDs, the original names, and `sortIndex` from `thread_sort_index` when available. Within an engine, source ordering takes precedence over the [msinsight default pipe order](https://github.com/Ascend/msinsight/blob/93d5187c458871bae49ae6613e36cd56aa124068/server/src/modules/timeline/core/parser/EventDef.h#L79-L86).

`FLOWCTRL` can show control instructions and waits. `ALL`, `CACHEMISS`, `USEMASK`, `EVENT`, and VF/SIMT detail tracks such as `PUSHQ` and `RVEC*` are displayed when present. `cache_time` and `ccu_time` stay on the originating pipe. These diagnostic intervals are excluded from Pipe activity and task execution overlap.

Device-wide scheduling lanes still link to per-engine `IFETCH` phases. Those phases appear when provided in the Pipe Atlas JSON. For imported instruction traces, `args.taskId` or `args.task_id` identifies invocations and `args.kernel` or `args.kernel_name` provides the kernel name. A trace without either uses `task0` and `kernel0`.

### Outstanding windows (schema 1.3)

One pipe can have several instructions outstanding at the same time. Schema `1.3` adds three optional fields; everything older keeps validating unchanged:

| Field | Where | Meaning |
| --- | --- | --- |
| `issue` | event | Moment the pipe accepts the instruction. Defaults to `start`; must not be later than `start`. |
| `complete` | event | Moment the instruction retires. Defaults to `start + duration`; must not be earlier. |
| `issueWidth` | lane | Outstanding capacity of the pipe (`1…1024`). Rows are padded up to it; a trace that exceeds it gets an import warning. |
| `start` / `duration` | event | Required in `1.0`–`1.2`. From `1.3` onward, an outstanding-only event may omit them: `start` defaults to `issue` and `duration` to `complete - issue`, so the execution bar covers the whole in-flight window until you add real execution timings. |

```json
{
  "schemaVersion": "1.3",
  "lanes": [{ "id": "c0-mte2", "label": "MTE2", "coreId": "core-0", "engine": "AIV", "pipe": "MTE2", "issueWidth": 4 }],
  "scenarios": [{
    "id": "outstanding",
    "events": [
      { "id": "dma0", "taskId": "task0", "kernelId": "kernel0", "laneId": "c0-mte2", "name": "gm_to_l1", "kind": "transfer",
        "start": 0.2, "duration": 4.5, "issue": 0, "complete": 9 }
    ]
  }]
}
```

Rows are packed by `[issue, complete]` (first-fit, in start order); the execution bar still shows `[start, start + duration]` and the outstanding range is the dashed backdrop. The bundled **Outstanding** demo is a complete example.

`devices → cores → engines → lanes` describes the hardware topology. `kernels` describes operator implementations, and `tasks` describes individual invocations. Scheduling events use `kind: "schedule"` and link to fetch events via `fetchIds`. Fetch events use `kind: "fetch"`. Events associate with a task through `taskId`.

The bundled `vendor/outstanding.json` demo exercises the 1.3 fields end to end. See the upstream `docs/data-contract.md` and `docs/integration.md` for the complete contract and embedding API.

## Build

`client.js` is generated. The Harness client runner loads one plain-JS factory, while Pipe Atlas ships ES modules, so `scripts/build-client.mjs` strips module syntax from the vendor files, concatenates them in dependency order, re-declares aliased imports (`escapeHtml as esc`), embeds the demo traces and locale dictionaries, and wraps everything in `window.__ModuleLoader__.load(...)`. The alias step matters: without it the concatenated module throws `esc is not defined` on the first render. The component tag is content-addressed (`pipe-atlas-<hash>`) so a hot-reloaded Client module defines a fresh element instead of reusing a stale class from the custom-element registry.

```bash
npm run build   # regenerate client.js from src/app.js + vendor/
npm run check   # manifest, locale, icon, bundle and registration smoke checks
```

Edit `src/app.js` for panel behaviour and `vendor/` only when updating the upstream viewer. Both are checked in, so the installed bundle never runs a build step.

### Layout

| Path | Contents |
| --- | --- |
| `index.js` | Host half of the bundle (no runtime behaviour). |
| `cordis.patch.yml` | Loader row inserting `@local/dsh-pipe-atlas`. |
| `src/app.js` | Panel shell, import/export flows, slot registration, theme/locale wiring. |
| `vendor/` | Pipe Atlas viewer sources and demo traces (upstream MIT). |
| `client.js` | Generated browser module loaded by the Harness client runner. |
| `locale/*.json` | Plugin Manager metadata and panel dictionaries. |
| `icon.svg` | Sidebar and Plugin Manager artwork (original). |
| `scripts/` | Build and check scripts. |

## License

MIT. The vendored Pipe Atlas sources and demo data are MIT, copyright Pipe Atlas contributors; see `vendor/LICENSE`. The sidebar icon is original work for this plugin.
