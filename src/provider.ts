import type {
	AssistantMessageEventStream,
	Context,
	Model,
	SimpleStreamOptions,
} from "@oh-my-pi/pi-ai";
import type { ProviderConfig, ProviderModelConfig } from "@oh-my-pi/pi-coding-agent";

import { hasAntigravityAuth } from "./acp/antigravity.js";
import { API_ID, FALLBACK_MODELS, PROVIDER_ID, projectModels, type AcpModel } from "./models.js";
import { AntigravityRuntime, MANAGED_AUTH_MARKER } from "./runtime.js";

export interface AntigravityProviderBundle {
	provider: ProviderConfig;
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

	const provider: ProviderConfig = {
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
		streamSimple(
			model: Model<"antigravity-acp">,
			context: Context,
			options?: SimpleStreamOptions,
		): AssistantMessageEventStream {
			return runtime
				.stream(model as never, context as never, options as SimpleStreamOptions | undefined)
				.stream as AssistantMessageEventStream;
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
