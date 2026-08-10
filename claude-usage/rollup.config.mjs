import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";
import path from "node:path";
import url from "node:url";

const isWatching = !!process.env.ROLLUP_WATCH;
const sdPlugin = "com.kylefsu.claude-usage.sdPlugin";

/** The plugin itself, loaded by the Stream Deck app. */
const plugin = {
	input: "src/plugin.ts",
	output: {
		file: `${sdPlugin}/bin/plugin.js`,
		sourcemap: isWatching,
		sourcemapPathTransform: (relativeSourcePath, sourcemapPath) => {
			return url.pathToFileURL(path.resolve(path.dirname(sourcemapPath), relativeSourcePath)).href;
		}
	},
	plugins: [
		{
			name: "watch-externals",
			buildStart: function () {
				this.addWatchFile(`${sdPlugin}/manifest.json`);
			}
		},
		typescript({ mapRoot: isWatching ? "./" : undefined, compilerOptions: { sourceMap: isWatching } }),
		nodeResolve({ browser: false, exportConditions: ["node"], preferBuiltins: true }),
		commonjs(),
		!isWatching && terser(),
		{
			name: "emit-module-package-file",
			generateBundle() {
				this.emitFile({ fileName: "package.json", source: `{ "type": "module" }`, type: "asset" });
			}
		}
	]
};

/** Standalone calibration reporter — `npm run report`. */
const report = {
	input: "src/report.ts",
	output: {
		file: "dist/report.mjs",
		format: "esm",
		sourcemap: false
	},
	plugins: [
		typescript({ compilerOptions: { declaration: false, sourceMap: false } }),
		nodeResolve({ browser: false, exportConditions: ["node"], preferBuiltins: true }),
		commonjs()
	]
};

/** Renders the key art to an HTML page — `npm run preview`. */
const preview = {
	input: "src/preview.ts",
	output: {
		file: "dist/preview.mjs",
		format: "esm",
		sourcemap: false
	},
	plugins: [
		typescript({ compilerOptions: { declaration: false, sourceMap: false } }),
		nodeResolve({ browser: false, exportConditions: ["node"], preferBuiltins: true }),
		commonjs()
	]
};

export default [plugin, report, preview];
