import type { PromptResponse } from "@agentclientprotocol/sdk/unstable";
import type { Usage } from "@oh-my-pi/pi-ai";
import type { AcpModel, ModelCost } from "../models.js";

export function emptyUsage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

export function usageFromPrompt(response: PromptResponse, model?: AcpModel): Usage {
	const usage = emptyUsage();
	const standard = asRecord(response.usage);
	const quota = asRecord(asRecord(response._meta)?.quota);
	const tokens = asRecord(quota?.token_count);
	usage.cacheRead = token(standard?.cachedReadTokens) ?? 0;
	usage.cacheWrite = token(standard?.cachedWriteTokens) ?? 0;
	const rawInput = token(standard?.inputTokens) ?? token(tokens?.input_tokens) ?? 0;
	const rawOutput = token(standard?.outputTokens) ?? token(tokens?.output_tokens) ?? 0;
	const reasoning = token(standard?.thoughtTokens);
	const rawTotal = token(standard?.totalTokens);
	const resolved = resolveInputAndOutput(rawInput, rawOutput, usage.cacheRead, usage.cacheWrite, reasoning, rawTotal);
	usage.input = resolved.input;
	usage.output = resolved.output;
	// omp's `Usage` records thinking tokens as `reasoningTokens` (a subset of
	// `output`); there is no separate `reasoning` field.
	if (reasoning !== undefined) usage.reasoningTokens = reasoning;
	usage.totalTokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
	if (model) applyCost(model.cost, usage);
	return usage;
}

/** Price a turn from the model's catalog rate card. `tiers[0]` is the long-context
 * rate: once prompt input (uncached + cache read + cache write) exceeds its
 * threshold the whole request reprices at the higher tier, mirroring the host's
 * long-context pricing semantics. */
function applyCost(cost: ModelCost, usage: Usage): void {
	const promptInput = usage.input + usage.cacheRead + usage.cacheWrite;
	const tier = cost.tiers?.[0];
	const rates = tier && promptInput > tier.inputTokensAbove ? tier : cost;
	usage.cost.input = (rates.input / 1_000_000) * usage.input;
	usage.cost.output = (rates.output / 1_000_000) * usage.output;
	usage.cost.cacheRead = (rates.cacheRead / 1_000_000) * usage.cacheRead;
	usage.cost.cacheWrite = (rates.cacheWrite / 1_000_000) * usage.cacheWrite;
	usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
}

function resolveInputAndOutput(
	rawInput: number,
	rawOutput: number,
	cacheRead: number,
	cacheWrite: number,
	reasoning: number | undefined,
	rawTotal: number | undefined,
): { input: number; output: number } {
	const thoughts = reasoning ?? 0;
	const outputIncludesThoughts = reasoning === undefined || rawOutput >= reasoning;
	if (rawTotal !== undefined) {
		const candidates: Array<{ input: number; output: number }> = [];
		// 1. ACP 1.5.0+: input excludes cache counters, output already includes thoughtTokens.
		if (outputIncludesThoughts) {
			candidates.push({ input: rawInput, output: rawOutput });
		}
		// 2. Legacy ACP (e.g. 1.4.3): input includes cacheRead (and possibly cacheWrite), output excludes thoughts.
		if (rawInput >= cacheRead) {
			if (cacheWrite > 0 && rawInput >= cacheRead + cacheWrite) {
				candidates.push({ input: rawInput - cacheRead - cacheWrite, output: rawOutput + thoughts });
			}
			candidates.push({ input: rawInput - cacheRead, output: rawOutput + thoughts });
		}
		// 3. Gross input + inclusive output (totalTokens === inputTokens + outputTokens).
		if (outputIncludesThoughts && rawInput >= cacheRead) {
			if (cacheWrite > 0 && rawInput >= cacheRead + cacheWrite) {
				candidates.push({ input: rawInput - cacheRead - cacheWrite, output: rawOutput });
			}
			candidates.push({ input: rawInput - cacheRead, output: rawOutput });
		}
		// 4. Net input + exclusive output.
		if (thoughts > 0) {
			candidates.push({ input: rawInput, output: rawOutput + thoughts });
		}
		const matched = candidates.find(
			(candidate) => candidate.input + candidate.output + cacheRead + cacheWrite === rawTotal,
		);
		if (matched) return matched;
	}
	return {
		input: rawInput,
		output: outputIncludesThoughts ? rawOutput : rawOutput + thoughts,
	};
}

function token(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}
