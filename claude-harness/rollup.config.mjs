import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";
import path from "node:path";
import url from "node:url";

const isWatching = !!process.env.ROLLUP_WATCH;
const sdPlugin = "com.kylefsu.claude-harness.sdPlugin";

const node = () => [
	typescript({ mapRoot: isWatching ? "./" : undefined, compilerOptions: { sourceMap: isWatching } }),
	nodeResolve({ browser: false, exportConditions: ["node"], preferBuiltins: true }),
	commonjs()
];

/** The plugin itself, loaded by the Stream Deck app. */
const plugin = {
	input: "src/plugin.ts",
	output: {
		file: `${sdPlugin}/bin/plugin.js`,
		sourcemap: isWatching,
		sourcemapPathTransform: (relativeSourcePath, sourcemapPath) =>
			url.pathToFileURL(path.resolve(path.dirname(sourcemapPath), relativeSourcePath)).href
	},
	plugins: [
		{
			name: "watch-externals",
			buildStart() {
				this.addWatchFile(`${sdPlugin}/manifest.json`);
			}
		},
		...node(),
		!isWatching && terser(),
		{
			name: "emit-module-package-file",
			generateBundle() {
				this.emitFile({ fileName: "package.json", source: `{ "type": "module" }`, type: "asset" });
			}
		}
	]
};

/** The Claude Code hook. Ships inside the plugin; Claude Code runs it with the Stream Deck app's Node. */
const hook = {
	input: "src/hook/hook.ts",
	output: { file: `${sdPlugin}/bin/hook.mjs`, format: "esm", sourcemap: false },
	plugins: [...node(), !isWatching && terser()]
};

/** Renders every key face to an HTML page — `npm run preview`. */
const preview = {
	input: "src/preview.ts",
	output: { file: "dist/preview.mjs", format: "esm", sourcemap: false },
	plugins: node()
};

/** Unit tests — `npm test`. */
const tests = {
	input: "src/tests.ts",
	output: { file: "dist/tests.mjs", format: "esm", sourcemap: false },
	external: [/^node:/],
	plugins: node()
};

/** Static art for tools/make-icons.mjs — `npm run icons`. */
const icons = {
	input: "src/icons.ts",
	output: { file: "dist/icons.mjs", format: "esm", sourcemap: false },
	plugins: node()
};

export default [plugin, hook, preview, tests, icons];
