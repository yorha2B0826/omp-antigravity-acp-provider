import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "omp-antigravity-acp-pack-"));
let tarball;

try {
	const name = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).name;
	const output = JSON.parse(execFileSync("npm", ["pack", "--json"], { cwd: root, encoding: "utf8" }));
	// npm 12 keys pack results by package name; earlier versions return an array.
	const packed = Array.isArray(output) ? output[0] : output[name];
	if (!packed?.filename) throw new Error("npm pack did not return a tarball filename");
	tarball = path.join(root, packed.filename);
	fs.writeFileSync(path.join(temporary, "package.json"), '{"private":true}\n');
	execFileSync(
		"npm",
		["install", "--ignore-scripts", "--legacy-peer-deps", tarball],
		{ cwd: temporary, stdio: "inherit" },
	);
	const installed = path.join(temporary, "node_modules", name);
	for (const required of ["extensions/index.ts", "src/acp/supervisor.mjs", "src/mcp/bridge.ts"]) {
		if (!fs.existsSync(path.join(installed, required))) throw new Error(`Packed file is missing: ${required}`);
	}
	const unzipperPackage = path.join(temporary, "node_modules", "unzipper", "package.json");
	if (!fs.existsSync(unzipperPackage)) throw new Error("Antigravity ACP installer dependency is missing");

	// Load the packed extension in the real omp CLI and list its provider models.
	// `omp models` runs provider discovery, which may leave network sockets open
	// after the JSON listing is printed; the smoke reads the payload and then
	// kills the CLI instead of waiting for a natural exit (which the upstream
	// `pi --list-models` flow never had to deal with).
	const models = await listAntigravityModels(path.join(installed, "extensions/index.ts"), temporary);
	const antigravity = models.filter((entry) => entry?.provider === "antigravity-acp");
	if (antigravity.length === 0) throw new Error("Packed extension did not register Antigravity models");
	process.stdout.write(
		`Packed install passed: omp loaded the extension and registered ${antigravity.length} antigravity-acp models (${antigravity.map((entry) => entry.id).join(", ")}).\n`,
	);
} finally {
	fs.rmSync(temporary, { recursive: true, force: true });
	if (tarball) fs.rmSync(tarball, { force: true });
}

function listAntigravityModels(extensionPath, temporary) {
	return new Promise((resolvePromise, reject) => {
		const child = spawn("omp", ["models", "antigravity-acp", "--no-extensions", "--json", "-e", extensionPath], {
			detached: true,
			env: {
				...process.env,
				PI_CODING_AGENT_DIR: path.join(temporary, "agent"),
				GEMINI_API_KEY: "packed-smoke-placeholder",
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let settled = false;
		const finish = (error, value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			try {
				process.kill(-child.pid, "SIGKILL");
			} catch {
				// Already exited.
			}
			if (error) reject(error);
			else resolvePromise(value);
		};
		const tryParse = () => {
			const text = stdout.trim();
			if (!text.startsWith("{")) return;
			try {
				const parsed = JSON.parse(text);
				if (Array.isArray(parsed?.models)) finish(undefined, parsed.models);
			} catch {
				// Payload still incomplete; keep reading.
			}
		};
		const timer = setTimeout(
			() => finish(new Error(`omp models timed out; stdout=${stdout.slice(0, 400)} stderr=${stderr.slice(-400)}`)),
			120_000,
		);
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
			tryParse();
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", (error) => finish(error));
		child.on("exit", () => {
			tryParse();
			finish(
				new Error(
					`omp models exited before printing a model list; stdout=${stdout.slice(0, 400)} stderr=${stderr.slice(-400)}`,
				),
			);
		});
	});
}
