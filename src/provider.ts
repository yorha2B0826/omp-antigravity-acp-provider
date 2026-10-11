import type {
	Api,
	AssistantMessageEventStream,
	Model,
	SimpleStreamOptions,
} from "@oh-my-pi/pi-ai";
import type { ProviderConfig, ProviderModelConfig } from "@oh-my-pi/pi-coding-agent";

import { hasAntigravityAuth } from "./acp/antigravity.js";
import { API_ID, FALLBACK_MODELS, PROVIDER_ID, projectModels, type AcpModel } from "./models.js";
import { AntigravityRuntime, MANAGED_AUTH_MARKER } from "./runtime.js";
import type { PromptContext } from "./stream/context.js";

/**
 * Upstream Pi carried the provider display name inside the config; omp takes it
 * as the first `registerProvider` argument and ignores the field. The property
 * is kept so the object handed to the host keeps its exact runtime shape.
 */
type LegacyNamedProviderConfig = ProviderConfig & { name: string };

/**
 * The provider config this bundle registers. `streamSimple` accepts a wider
 * context than the host declares: alongside omp `Context`s it also serves the
 * vendored legacy transcript context (see src/omp/transcript.ts), whose system
 * state entries the host `Context` type cannot express.
 */
export type AntigravityProviderConfig = ProviderConfig & {
	streamSimple?: (
		model: Model<Api>,
		context: PromptContext,
		options?: SimpleStreamOptions,
	) => AssistantMessageEventStream;
};

export interface AntigravityProviderBundle {
	provider: AntigravityProviderConfig;
	runtime: AntigravityRuntime;
}

/**
 * Map an ACP model descriptor onto omp's declarative `ProviderModelConfig`.
 * omp materializes its own `Model` (identity/compat) from these fields, so only
 * the catalog inputs are carried here.
 */
function toOmpModel(model: AcpModel): ProviderModelConfig {
	return {
		id: model.id,
		name: model.name,
		api: API_ID,
		reasoning: model.reasoning,
		...(model.thinking ? { thinking: model.thinking as ProviderModelConfig["thinking"] } : {}),
		input: ["text", "image"],
		cost: model.cost,
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
	};
}

export function createAntigravityProvider(runtime = new AntigravityRuntime()): AntigravityProviderBundle {
	let models: AcpModel[] = [...FALLBACK_MODELS];

	const provider: LegacyNamedProviderConfig & AntigravityProviderConfig = {
		name: "Google Antigravity (ACP)",
		baseUrl: "https://daily-cloudcode-pa.googleapis.com",
		api: API_ID,
		apiKey: "GEMINI_API_KEY",
		oauth: {
			name: "Google Antigravity (ACP)",
			async login(callbacks) {
				callbacks.onProgress?.("Starting Antigravity Google login…");
				await runtime.loginGoogle(
					callbacks.signal,
					(message) => callbacks.onProgress?.(message),
					{
						showAuthorizationUrl(url, instructions) {
							callbacks.onAuth({ url, instructions });
						},
						promptForCallback: async (signal) => {
							if (callbacks.onManualCodeInput) return callbacks.onManualCodeInput(signal);
							return callbacks.onPrompt({
								message: "Paste the final localhost callback URL (or authorization code):",
								placeholder: "http://127.0.0.1:PORT/?state=…&code=…",
							});
						},
					},
				);
				// omp needs a durable credential record so the provider stays visible;
				// the actual OAuth tokens remain owned by Google Antigravity.
				return {
					refresh: MANAGED_AUTH_MARKER,
					access: MANAGED_AUTH_MARKER,
					expires: Number.MAX_SAFE_INTEGER,
				};
			},
			async refreshToken(credential) {
				return credential;
			},
			getApiKey() {
				return MANAGED_AUTH_MARKER;
			},
		},
		// A wider `context` parameter than the host declares is intentional: the
		// provider also serves the vendored legacy transcript context (see
		// src/omp/transcript.ts), which the host `Context` cannot express.
		streamSimple(
			model: Model<Api>,
			context: PromptContext,
			options?: SimpleStreamOptions,
		): AssistantMessageEventStream {
			// omp routes only its own `antigravity-acp` catalog models here; the host
			// `Model<Api>` additionally carries the `identity`/`compat` records that
			// only omp's `buildModel` materializes and this runtime never reads, so
			// the host model narrows to the ACP descriptor at this one boundary.
			return runtime.stream(model as unknown as AcpModel, context, options ?? {}).stream;
		},
		models: models.map(toOmpModel),
		async fetchDynamicModels(apiKey: string | undefined): Promise<readonly ProviderModelConfig[]> {
			try {
				// A real Gemini API key, otherwise Antigravity's own OAuth refresh token.
				const key = apiKey && apiKey !== MANAGED_AUTH_MARKER ? apiKey : MANAGED_AUTH_MARKER;
				const discovered = projectModels(await runtime.discoverModels(key));
				if (discovered.length > 0) models = discovered;
			} catch {
				// Discovery must not hide the conservative offline catalog when
				// authentication is absent, expired, or temporarily unavailable.
			}
			return models.map(toOmpModel);
		},
	};
	return { provider, runtime };
}

export const ANTIGRAVITY_ACP_API = API_ID;
export { PROVIDER_ID };
