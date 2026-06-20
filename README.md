# esc-demo-delay

Vue 3 + Vite + Tailwind host for the **Suara SDK** — a VST3 audio effect whose GUI
is web and whose DSP runs in a TypeScript AudioWorklet. Built on
[Vite+](https://viteplus.dev/) — use `vp`, not npm/pnpm.

## Run

```sh
vp install
vp dev        # dev server (COOP/COEP on, port from suara.json)
vp build      # type-check + production build
vp check      # format + lint + typecheck
```

Suara plugin packaging needs the global `suara` CLI (`vp run build:dev`, `install:dev`, ...).

## How it's wired

- **`@suara/sdk`** — vendored in `src/sdk/`. `runtime` auto-detects VST vs web;
  `createDawInput` / `useMidi` / `useTransport` / `useParam` abstract the DAW so the
  same userland runs under the VST runtime and in the browser.
- **Web DAW simulator** — `SuaraHostPanel` / `VirtualKeyboard` (web runtime only) feed
  MIDI / transport / audio in. They use SharedArrayBuffer, hence the dev server's
  COOP/COEP headers (`crossOriginIsolated`).
- **DSP worklet** — `src/audio/worklets/distortion.ts`, plain TypeScript. Globals come
  from `@types/audioworklet` (scoped to `tsconfig.worklet.json`, no DOM lib). Loaded via
  `import url from '...?worker&url'` + `addModule(url)`; edits hot-reload
  (`import.meta.hot` rebuilds the graph). Currently a passthrough — write your DSP there.
- **Glue** — `src/App.vue` connects `createDawInput()` → `distortion` node → output.
