# Pipe Atlas · DeepSeek Harness sidebar plugin

[github.com/LXW-github/dsh-pipe-atlas-plugin](https://github.com/LXW-github/dsh-pipe-atlas-plugin)

A left-sidebar panel for **DeepSeek Harness** that renders **Ascend NPU execution pipelines** from a versioned JSON contract: multi-task, multi-core timelines; scheduling and instruction-fetch stages; overlap detection; event inspection; and SVG / PNG / JSON export.

The viewer itself is **Pipe Atlas** — an original, dependency-free Web Component (MIT). This repository packages it as a Harness **bundle**: a Host row plus one Client module that registers a sidebar icon and a full-height main panel.

The panel uses the Harness theme tokens; the timeline keeps Pipe Atlas's own light/dark palette and follows the active Harness theme.

## Features

- **Sidebar entry** — a dedicated icon in `sidebar.panellist`; clicking it opens the panel in the main column, next to Notes, Schedules and Plugins.
- **Three bundled traces plus a minimal sample** — shared scheduling → fetch → execute, a five-task / four-core network trace, the original Early Start demo, and a minimal three-stage pipeline.
- **Import** — drag a `.json` file anywhere onto the panel, use *Open JSON*, or paste JSON into the dialog. Supports the Pipe Atlas v1.0–v1.2 contract and Chrome Trace Event JSON; files up to 30 MB.
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

1. Click the **Pipe Atlas** icon in the left sidebar.
2. Pick a demo from the header, or open a JSON trace.
3. Hover an event for details, click to pin it in the inspector; double-click to zoom.
4. Drag to pan, `Ctrl/⌘ + wheel` to zoom, `Shift + drag` to measure, `/` to search.
5. Export the current viewport or the full trace from the header menu.

### Data contract

The accepted JSON is the Pipe Atlas schema (`vendor/model.js` validates at runtime; a JSON Schema lives upstream). The shape is:

```json
{
  "schemaVersion": "1.2",
  "metadata": { "title": "…", "timeUnit": "us", "source": { "kind": "synthetic" } },
  "devices": [{ "id": "npu0", "label": "NPU 0" }],
  "cores": [{ "id": "core-0", "label": "Core 0", "deviceId": "npu0" }],
  "lanes": [{ "id": "c0-v", "label": "VECTOR", "coreId": "core-0", "engine": "AIV", "pipe": "VECTOR" }],
  "kernels": [{ "id": "kernel0" }],
  "tasks": [{ "id": "task0", "kernelId": "kernel0" }],
  "scenarios": [{
    "id": "main",
    "events": [{ "id": "e0", "taskId": "task0", "laneId": "c0-v", "kind": "compute", "start": 10, "end": 42 }]
  }]
}
```

`devices → cores → lanes` describes the hardware topology; `kernels` describe operator implementations; `tasks` are operator invocations that own events. Scheduling events use `kind: "schedule"` and link to fetch events via `fetchIds`; fetch events use `kind: "fetch"`. Events are associated with a task through `taskId`. Time values are passed through from the upstream parser — the viewer never rewrites timings from dependencies.

See the upstream `docs/data-contract.md` and `docs/integration.md` for the complete contract and embedding API.

## Build

`client.js` is generated. The Harness client runner loads one plain-JS factory, while Pipe Atlas ships ES modules, so `scripts/build-client.mjs` strips module syntax from the vendor files, concatenates them in dependency order, embeds the demo traces and locale dictionaries, and wraps everything in `window.__ModuleLoader__.load(...)`.

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
