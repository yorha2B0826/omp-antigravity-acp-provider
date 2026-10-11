# omp port

This branch retargets `pi-antigravity-acp-provider` from upstream Pi
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
git clone https://github.com/yorha2B0826/pi-antigravity-acp-provider  # this fork
cd pi-antigravity-acp-provider
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

- The extension loads under `omp -e ./extensions/index.ts` with no errors.
- The provider registers and exposes four models
  (`gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.1-pro`);
  the `antigravity-acp` OAuth provider appears in the in-session login list.
- A live `streamSimple` reaches the ACP server and returns a protocol-level
  response (e.g. `Model '…' is not available for the current authentication
  method.` when no Google credential is present) — i.e. provider → ACP → Google
  wiring is intact.
- The unit suite (`bun run test`) passes 146 tests. Five test files
  (`provider`, `models`, `runtime`, `runtime-safety`, `pi-events`) plus
  `supervisor` fail to *load* because omp's published `@oh-my-pi/*` packages are
  Bun-native (raw TypeScript reading the `Bun` global, plus `.html` assets that
  vite cannot transform). That is a vitest/Node limitation of the host dev
  dependency, not a port regression; the same modules load and run correctly
  under omp's own Bun-based extension loader.

## License

MIT — see [LICENSE](./LICENSE). Original work by
[zacbemis](https://github.com/zacbemis).
