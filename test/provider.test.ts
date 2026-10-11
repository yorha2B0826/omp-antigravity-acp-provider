import type { Api, Model } from "@oh-my-pi/pi-ai";
import { normalizeContext } from "../src/omp/transcript.js";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";

import { AntigravityAcpConnection } from "../src/acp/connection.js";
import { FALLBACK_MODELS } from "../src/models.js";
import { createAntigravityProvider } from "../src/provider.js";
import { AntigravityRuntime } from "../src/runtime.js";

const fakeAgent = fileURLToPath(new URL("./fixtures/fake-agent.mjs", import.meta.url));
const model = FALLBACK_MODELS[0]!;

/**
 * omp's `Model<Api>` additionally carries the `identity`/`compat` records that
 * only its `buildModel` materializes and the provider never reads, so the ACP
 * descriptor crosses that host boundary with one documented assertion.
 */
const hostModel = model as unknown as Model<Api>;

describe("native Pi provider", () => {
	it("passes transcript instructions through to the ACP prompt", async () => {
		const prompts: Array<Parameters<AntigravityAcpConnection["prompt"]>[0]> = [];
		const runtime = new AntigravityRuntime((options) => {
			const connection = new AntigravityAcpConnection({ ...options, command: process.execPath, args: [fakeAgent] });
			const prompt = connection.prompt.bind(connection);
			connection.prompt = (request, signal) => {
				prompts.push(request);
				return prompt(request, signal);
			};
			return connection;
		});
		try {
			const { provider } = createAntigravityProvider(runtime);
			const streamSimple = provider.streamSimple;
			if (!streamSimple) throw new Error("antigravity provider must register streamSimple");
			const stream = streamSimple(hostModel, normalizeContext({
				systemPrompt: "Follow native transcript instructions",
				messages: [{ role: "user", content: "hello", timestamp: 1 }],
			}), { apiKey: "test-key" });
			const result = await stream.result();
			expect(result.stopReason).toBe("stop");
			expect(prompts[0]?.prompt[0]).toMatchObject({
				type: "resource",
				resource: { text: expect.stringContaining("Follow native transcript instructions") },
			});
		} finally {
			await runtime.close();
		}
	});

	it("routes tools added by a transcript delta through the MCP bridge", async () => {
		const runtime = new AntigravityRuntime(
			(options) => new AntigravityAcpConnection({ ...options, command: process.execPath, args: [fakeAgent] }),
		);
		try {
			const { provider } = createAntigravityProvider(runtime);
			const streamSimple = provider.streamSimple;
			if (!streamSimple) throw new Error("antigravity provider must register streamSimple");
			const tools = [{ name: "echo", description: "Echo text", parameters: Type.Object({ text: Type.String() }) }];
			const context = normalizeContext({ messages: [
				{ role: "system", content: "Base instructions", timestamp: 0 },
				{ role: "system", content: "", toolsAdded: tools, timestamp: 1 },
				{ role: "user", content: "use bridge", timestamp: 2 },
			] });
			const first = await streamSimple(hostModel, context, { apiKey: "test-key" }).result();
			const call = first.content.find((block) => block.type === "toolCall");
			if (!call || call.type !== "toolCall") throw new Error("missing transcript tool call");
			expect(call).toMatchObject({ name: "echo", arguments: { text: "from gemini" } });
			const second = await streamSimple(hostModel, normalizeContext({ messages: [
				...context.messages,
				first,
				{ role: "toolResult", toolCallId: call.id, toolName: "echo", content: [{ type: "text", text: "native result" }], isError: false, timestamp: 3 },
			] }), { apiKey: "test-key" }).result();
			expect(second.content).toEqual([{ type: "text", text: "native result" }]);
		} finally {
			await runtime.close();
		}
	});
});
