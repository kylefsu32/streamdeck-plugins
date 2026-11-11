#!/usr/bin/env node
/**
 * Writes one property inspector page per action. They share the look and
 * behaviour settings, so they're generated rather than hand-copied nine times.
 *
 * Run: node tools/make-ui.mjs
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const ui = path.join(here, "..", "com.kylefsu.system-vitals.sdPlugin", "ui");

const select = (setting, label, options, def) =>
	`		<sdpi-item label="${label}">
			<sdpi-select setting="${setting}" default="${def ?? options[0][0]}">
${options.map(([v, l]) => `				<option value="${v}">${l}</option>`).join("\n")}
			</sdpi-select>
		</sdpi-item>`;

const textfield = (setting, label, placeholder, type = "text") =>
	`		<sdpi-item label="${label}">
			<sdpi-textfield setting="${setting}" type="${type}" placeholder="${placeholder}"></sdpi-textfield>
		</sdpi-item>`;

const STYLE = select("style", "Style", [
	["graph", "Live graph"],
	["gauge", "Gauge"],
	["number", "Big number"]
]);

const LOOK = [
	select("theme", "Theme", [
		["graphite", "Graphite"],
		["black", "Black"],
		["midnight", "Midnight"],
		["paper", "Paper (light)"]
	]),
	select(
		"colour",
		"Colour",
		[
			["", "Default"],
			["blue", "Blue"],
			["teal", "Teal"],
			["green", "Green"],
			["lime", "Lime"],
			["amber", "Amber"],
			["orange", "Orange"],
			["red", "Red"],
			["pink", "Pink"],
			["violet", "Violet"],
			["white", "White"]
		],
		""
	),
	`		<sdpi-item label="Graph span">
			<sdpi-range setting="graphSeconds" min="20" max="120" step="10" default="60" showlabels>
				<span slot="min">20s</span>
				<span slot="max">2m</span>
			</sdpi-range>
		</sdpi-item>`
];

const PRESS = select("press", "On press", [
	["monitor", "Open Activity Monitor"],
	["cycle", "Show next metric"],
	["none", "Nothing"]
]);

const alert = (unit) => textfield("alertAbove", "Turn red above", `off — value in ${unit}`, "number");

const pages = {
	cpu: [
		select("metric", "Show", [
			["total", "Total usage"],
			["peak", "Busiest core"],
			["cores", "Every core (bars)"],
			["load", "Load average (1 min)"]
		]),
		STYLE,
		alert("% (or load)"),
		...LOOK,
		PRESS
	],
	memory: [
		select("metric", "Show", [
			["percent", "Used (%)"],
			["used", "Used (GB)"],
			["pressure", "Memory pressure"],
			["swap", "Swap used"]
		]),
		STYLE,
		alert("% (or GB)"),
		...LOOK,
		PRESS
	],
	gpu: [
		select("metric", "Show", [
			["device", "GPU usage"],
			["renderer", "Renderer usage"],
			["tiler", "Tiler usage"],
			["memory", "GPU memory in use"]
		]),
		STYLE,
		alert("% (or GB)"),
		...LOOK,
		PRESS
	],
	disk: [
		select("metric", "Show", [
			["used", "Space used (%)"],
			["free", "Free space"],
			["activity", "Read + write"],
			["read", "Read speed"],
			["write", "Write speed"]
		]),
		textfield("volume", "Volume", "/ — or /Volumes/External"),
		STYLE,
		alert("% (or GB, or MB/s)"),
		...LOOK,
		PRESS
	],
	network: [
		select("metric", "Show", [
			["both", "Down + up"],
			["down", "Download"],
			["up", "Upload"],
			["minute", "Total, last 60 seconds"],
			["hour", "Total, last hour"],
			["day", "Total, last 24 hours"]
		]),
		`		<sdpi-item label="Adapter">
			<sdpi-select setting="iface" default="auto" datasource="getInterfaces" loading="Finding adapters…" hot-reload></sdpi-select>
		</sdpi-item>`,
		`		<sdpi-item label="Units">
			<sdpi-checkbox setting="bits" label="Bits per second (Mb/s)"></sdpi-checkbox>
		</sdpi-item>`,
		STYLE,
		alert("MB/s"),
		...LOOK,
		PRESS
	],
	ping: [
		textfield("host", "Target", "1.1.1.1 — or a hostname"),
		`		<sdpi-item label="Every">
			<sdpi-range setting="pingSeconds" min="1" max="30" step="1" default="2" showlabels>
				<span slot="min">1s</span>
				<span slot="max">30s</span>
			</sdpi-range>
		</sdpi-item>`,
		STYLE,
		alert("ms"),
		...LOOK,
		PRESS
	],
	system: [
		select("metric", "Show", [
			["uptime", "Uptime"],
			["battery", "Battery"]
		]),
		STYLE,
		textfield("alertAbove", "Turn red when", "off — % of battery used, e.g. 80", "number"),
		...LOOK,
		PRESS
	],
	top: [
		select("metric", "Rank by", [
			["cpu", "CPU"],
			["memory", "Memory"]
		]),
		`		<sdpi-item label="Apps">
			<sdpi-range setting="count" min="1" max="5" step="1" default="3" showlabels>
				<span slot="min">1</span>
				<span slot="max">5</span>
			</sdpi-range>
		</sdpi-item>`,
		...LOOK.slice(0, 2),
		PRESS
	],
	app: [
		`		<sdpi-item label="App">
			<sdpi-select setting="app" datasource="getApps" loading="Listing running apps…" hot-reload placeholder="Pick a running app"></sdpi-select>
		</sdpi-item>`,
		textfield("app", "…or type a name", "e.g. Xcode"),
		select("metric", "Show", [
			["cpu", "CPU"],
			["memory", "Memory"]
		]),
		STYLE,
		alert("% (or GB)"),
		...LOOK,
		PRESS
	]
};

for (const [name, items] of Object.entries(pages)) {
	const html = `<!doctype html>
<html>
	<head lang="en">
		<meta charset="utf-8" />
		<script src="https://sdpi-components.dev/releases/v4/sdpi-components.js"></script>
	</head>
	<body>
${items.join("\n\n")}
	</body>
</html>
`;
	writeFileSync(path.join(ui, `${name}.html`), html);
}
console.log(`wrote ${Object.keys(pages).length} pages to ${ui}`);
