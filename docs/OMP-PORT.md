# omp port

This port retargets the package from upstream Pi (`pi-antigravity-acp-provider`)
(`@earendil-works/*`) to **Oh My Pi / omp** (`@oh-my-pi/*`, verified against omp
18.8.9). The ACP backend — runtime discovery, the signed runtime catalog, the
supervisor, ACP v1 connection/session state, streaming, the loopback MCP tool
bridge, and the permission broker — is unchanged. Only the host-adapter layer
that talks to the coding-agent API was ported.

## Why a port was needed

Installing the published package into omp fails on two independent host-API
differences:

1. **`registerProvider` overloads.** Upstream Pi exposes both
   `registerProvider(provider: Provider)` and
   `registerProvider(name, config)`. omp exposes only the second, so the
   upstream call `pi.registerProvider(provider)` passes the object as `name`
   and crashes with `TypeError: undefined is not an object (evaluating
   't.streamSimple')` (omp issue #10188, "not a defect").
2. **Transcript helpers.** Upstream `@earendil-works/pi-ai` re-exports
   `normalizeContext`, `getCurrentSystemPrompt`, `getCurrentTools`, and
   `collapseSystemMessages`. omp forked before that module existed, so a
   static named-export check rejects the extension at load time.

## What changed

| Area | Upstream Pi | omp |
| --- | --- | --- |
| Host scope | `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent` | `@oh-my-pi/pi-ai`, `@oh-my-pi/pi-coding-agent` |
| Provider registration | `pi.registerProvider(provider: Provider)` | `pi.registerProvider(PROVIDER_ID, providerConfig)` |
| Model catalog | `getModels()` + `refreshModels({ publish })` on a `Provider` object | declarative `models: ProviderModelConfig[]` + async `fetchDynamicModels(apiKey)` |
| OAuth | `Provider.auth.oauth.login(interaction)` returning `{type:"oauth", …}` | `ProviderConfig.oauth.login(callbacks)` returning `OAuthCredentials`, plus `refreshToken`/`getApiKey` |
| API-key auth | `auth.apiKey.check/resolve` | `apiKey` field (env/name resolved by omp) with the OAuth login as the primary path |
| Transcript replay | re-exported from `@earendil-works/pi-ai` | vendored verbatim port in `src/omp/transcript.ts` (from omp's `legacy-pi-transcript.ts`) |
| `Context.systemPrompt` | `string` | `string[]` — joined in `currentSystemInstructions` |
| Thinking tiers | `Model.thinkingLevelMap` | `Model.thinking = { mode, efforts }` + local `thinkingLevelMap` used by `resolveAcpModelId` |
| Model descriptor type | `Model<"antigravity-acp">` | local `AcpModel` (`src/models.ts`) — omp's `Model` requires a resolved `identity`/`compat` record only its `buildModel` can produce |
| Deprecated command | `/gemini-acp` alias | `/antigravity-acp-reload` (re-registers the provider in-session) |

The provider still registers under the same id (`antigravity-acp`), the same
custom API (`api: "antigravity-acp"`), and the same model ids, and still writes
its runtime under `~/.local/opt/agy-acp/` and credentials under
`~/.gemini/antigravity-acp/` — so it shares state with any existing Antigravity
ACP install.

## Install (as an omp extension)

```bash
git clone https://github.com/yorha2B0826/omp-antigravity-acp-provider  # this fork
cd omp-antigravity-acp-provider
bun install
omp plugin link "$PWD"
```

Then, in omp:

1. `/login` → choose **Sign in with Google** / the provider named
   **Google Antigravity (ACP)**.
2. Complete the Google sign-in (browser or the headless manual-relay flow).
3. `/model` → pick an `antigravity-acp/*` model.
4. **Shift+Tab** selects the reasoning effort (low/medium/high).

`/antigravity-acp [setup|doctor|status|quota|update|updates|logout|account|qualify|permissions]`
provides the same setup, diagnostics, quota, and permission-mode controls as the
upstream package.

## Verification status

Verified against a live Antigravity ACP session on omp 18.8.9:

- The extension loads under `omp -e ./extensions/index.ts` with no errors, and
  the provider registers four models (`gemini-3.8-flash`, `gemini-3.7-flash`,
  `gemini-3.6-flash`, `gemini-3.1-pro`); the `antigravity-acp` OAuth provider
  appears in the in-session login list.
- A streamed turn completes end-to-end (provider → ACP → Google), and the
  `low`/`high` reasoning tiers resolve to their advertised variant ids.
- omp tools round-trip through the loopback MCP bridge (a model-initiated
  `bash` call returns its result).
- **Fixed in this port:** the collapsed→effort-qualified model-id re-expansion.
  Antigravity advertises effort-qualified ids (`gemini-3.8-flash-high`, …) and
  the provider collapses them into one entry per model, re-expanding per turn
  from the selected reasoning effort via a host `thinkingLevelMap`. omp's
  declarative `ProviderModelConfig` has no such field, so the mapping is kept in
  an internal `VARIANT_REGISTRY` (`src/models.ts`) instead. Without it every
  turn sends the bare collapsed id and the ACP server rejects it with
  `-32602 Model '…' is not available for the current authentication method.`
- The unit suite (`bun run test`) passes 146 tests. Five test files
  (`provider`, `models`, `runtime`, `runtime-safety`, `pi-events`) plus
  `supervisor` fail to *load* because omp's published `@oh-my-pi/*` packages are
  Bun-native (raw TypeScript reading the `Bun` global, plus `.html` assets that
  vite cannot transform). That is a vitest/Node limitation of the host dev
  dependency, not a port regression; the same modules load and run correctly
  under omp's own Bun-based extension loader.

## Testing and CI (fork)

- `npm run check` (tsc + vitest) runs under Node against the published
  `@oh-my-pi/*` type surfaces. Five suites (`provider`, `models`, `runtime`,
  `runtime-safety`, `pi-events`) import host packages whose entries are raw
  TypeScript that touches the `Bun` global; Node cannot execute them, so
  `vitest.config.ts` excludes them from the Node run (they still type-check).
  Run them with a real Bun runtime when needed: `bun test test/<file>` — note
  that Bun's own runner is missing a few vitest APIs in some other suites
  (`toHaveBeenCalledExactlyOnceWith`, `vi.waitFor`, fake-timer semantics);
  those are runner limitations, not failures of this package.
- `npm run test:packed` packs the package, installs it (production deps) into
  a temp directory, and loads the packed extension in the real omp CLI via
  `omp models antigravity-acp --no-extensions --json -e …`, expecting the four
  antigravity models to register. The smoke reads the JSON listing and then
  kills the CLI: provider discovery may leave network connections open, so the
  process is not expected to self-exit.
- `typebox` ships as a regular dependency (upstream keeps it peer-only): omp's
  npm-CLI form does not resolve bare `typebox` for transitive extension
  imports, so packaged/plugin installs must carry it.
- CI (`.github/workflows/ci.yml`) runs `npm ci` → `npm run check` →
  `npm run pack:check` → `npm run test:packed` → dependency audit on Node
  22.19.0 and 24, with Bun installed (the omp CLI binary is a Bun script). The
  upstream-only `report-dispatched-results` job is skipped outside the
  `zacbemis` repository.

## License

MIT — see [LICENSE](./LICENSE). Original work by
[zacbemis](https://github.com/zacbemis).
