import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
		// omp port: these five suites import @oh-my-pi host packages whose module
		// initialization touches the Bun global (e.g. `Bun.env` in pi-utils) and
		// whose entries are raw TypeScript — vitest workers run under Node, where
		// they cannot load. They still type-check via `tsc` and can be executed
		// with a real Bun runtime (`bun test test/<file>` on this checkout).
		// Excluding them keeps `npm run check` green under Node; see
		// docs/OMP-PORT.md ("Testing" section).
		exclude: [
			...configDefaults.exclude,
			"test/models.test.ts",
			"test/provider.test.ts",
			"test/pi-events.test.ts",
			"test/runtime.test.ts",
			"test/runtime-safety.test.ts",
		],
		testTimeout: 10_000,
	},
});
