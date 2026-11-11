/**
 * Parser and hub tests against output captured from macOS tools.
 *
 * Run: npm test
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
	appName,
	groupByApp,
	memoryUsedBytes,
	parseBattery,
	parseDiskIo,
	parseGpu,
	parseNetstat,
	parsePing,
	parsePs,
	parseSwap,
	parseVmStat
} from "./collectors/parse";
import { face } from "./metrics";
import { duration, rate, bytes } from "./render/format";
import { Hub } from "./sampler/hub";
import { TransferLedger } from "./sampler/ledger";

const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                5021.
Pages active:                            401234.
Pages inactive:                          398765.
Pages speculative:                         2345.
Pages throttled:                              0.
Pages wired down:                        150000.
Pages purgeable:                          10000.
"Translation faults":                 987654321.
Pages copy-on-write:                   12345678.
Pages zero filled:                    234567890.
Pages reactivated:                      1234567.
Pages purged:                            123456.
File-backed pages:                       300000.
Anonymous pages:                         500000.
Pages stored in compressor:              250000.
Pages occupied by compressor:             80000.
Decompressions:                         1234567.
Compressions:                           2345678.
Pageins:                                3456789.
Pageouts:                                 12345.
Swapins:                                      0.
Swapouts:                                     0.
`;

test("vm_stat → Activity Monitor style memory used", () => {
	const vm = parseVmStat(VM_STAT)!;
	assert.equal(vm.pageSize, 16384);
	assert.equal(vm.wired, 150000);
	assert.equal(vm.compressed, 80000);
	assert.equal(vm.anonymous, 500000);
	// (500000 - 10000) + 150000 + 80000 pages
	assert.equal(memoryUsedBytes(vm), 720000 * 16384);
});

test("swap usage", () => {
	const s = parseSwap("total = 2048.00M  used = 1536.25M  free = 511.75M  (encrypted)")!;
	assert.equal(s.total, 2048 * 1024 ** 2);
	assert.equal(s.used, 1536.25 * 1024 ** 2);
	assert.equal(parseSwap("total = 0.00M  used = 0.00M  free = 0.00M  (encrypted)")!.total, 0);
});

const NETSTAT = `Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll
lo0        16384 <Link#1>                         1638294     0  628012345  1638294     0  628012345     0
lo0        16384 127           127.0.0.1          1638294     -  628012345  1638294     -  628012345     -
gif0*      1280  <Link#2>                               0     0          0        0     0          0     0
en0        1500  <Link#11>   a4:83:e7:12:34:56  23456789     0 31234567890 9876543     0 1234567890     0
en0        1500  192.168.1     192.168.1.23     23456789     - 31234567890 9876543     - 1234567890     -
en0        1500  fe80::1c2b:3 fe80:b::1c2b:3d4e  23456789     - 31234567890 9876543     - 1234567890     -
awdl0      1500  <Link#13>   6a:1b:2c:3d:4e:5f       123     0      45678      456     0      78901     0
utun3      1380  <Link#20>                          34567     0    9876543    23456     0    3456789     0
en5        1500  <Link#17>   ac:de:48:00:11:22      5000     0     700000     4000     0     300000     0
`;

test("netstat link rows, including ones with no address", () => {
	const m = parseNetstat(NETSTAT);
	assert.deepEqual(m.get("en0"), { rx: 31234567890, tx: 1234567890 });
	assert.deepEqual(m.get("lo0"), { rx: 628012345, tx: 628012345 });
	assert.deepEqual(m.get("utun3"), { rx: 9876543, tx: 3456789 });
	assert.deepEqual(m.get("gif0"), { rx: 0, tx: 0 });
	assert.deepEqual(m.get("en5"), { rx: 700000, tx: 300000 });
	assert.equal(m.size, 6);
});

const IOREG_GPU = `+-o AGXAcceleratorG14X  <class AGXAcceleratorG14X, id 0x1000004f2, registered, matched, active, busy 0 (0 ms), retain 52>
    {
      "IOClass" = "AGXAcceleratorG14X"
      "PerformanceStatistics" = {"In use system memory (driver)"=0,"Alloc system memory"=4831838208,"Tiler Utilization %"=9,"recoveryCount"=0,"lastRecoveryTime"=0,"Renderer Utilization %"=17,"TiledSceneBytes"=1179648,"Device Utilization %"=19,"SplitSceneCount"=0,"Allocated PB Size"=176422912,"In use system memory"=1157627904}
      "gpu-core-count" = 30
    }
`;

test("Apple Silicon GPU utilisation from ioreg", () => {
	const g = parseGpu(IOREG_GPU)!;
	assert.equal(g.device, 19);
	assert.equal(g.renderer, 17);
	assert.equal(g.tiler, 9);
	assert.equal(g.memory, 1157627904);
	assert.equal(parseGpu("nothing here"), undefined);
});

const IOREG_DISK = `+-o IOBlockStorageDriver  <class IOBlockStorageDriver, id 0x100000412>
    {
      "Statistics" = {"Operations (Write)"=2345678,"Latency Time (Write)"=0,"Bytes (Read)"=123456789012,"Errors (Write)"=0,"Total Time (Read)"=987654321,"Latency Time (Read)"=0,"Retries (Read)"=0,"Errors (Read)"=0,"Total Time (Write)"=876543210,"Bytes (Write)"=98765432109,"Operations (Read)"=3456789,"Retries (Write)"=0}
    }
+-o IOBlockStorageDriver  <class IOBlockStorageDriver, id 0x100000999>
    {
      "Statistics" = {"Bytes (Read)"=1000,"Bytes (Write)"=2000}
    }
`;

test("disk byte counters summed across drives", () => {
	assert.deepEqual(parseDiskIo(IOREG_DISK), { read: 123456790012, write: 98765434109 });
});

test("ping round trip and loss", () => {
	assert.equal(
		parsePing("PING 1.1.1.1 (1.1.1.1): 56 data bytes\n64 bytes from 1.1.1.1: icmp_seq=0 ttl=58 time=12.874 ms\n"),
		12.874
	);
	assert.equal(parsePing("PING 10.255.255.1 (10.255.255.1): 56 data bytes\n\n--- 10.255.255.1 ping statistics ---\n1 packets transmitted, 0 packets received, 100.0% packet loss\n"), undefined);
});

test("battery states", () => {
	const b = parseBattery(`Now drawing from 'Battery Power'\n -InternalBattery-0 (id=12345678)\t82%; discharging; 6:41 remaining present: true\n`)!;
	assert.deepEqual(b, { percent: 82, state: "discharging", remaining: "6:41" });
	const c = parseBattery(`Now drawing from 'AC Power'\n -InternalBattery-0 (id=12345678)\t100%; charged; 0:00 remaining present: true\n`)!;
	assert.equal(c.state, "charged");
	assert.equal(parseBattery("Now drawing from 'AC Power'\n"), undefined);
});

test("ps rows and app grouping", () => {
	const rows = parsePs(`    1   0.3  12345 launchd
  412  14.9 123456 WindowServer
 9001  22.0 400000 Google Chrome
 9002  18.5 300000 Google Chrome Helper (Renderer)
 9003   3.0 100000 Google Chrome Helper (GPU)
 9004   1.0  50000 Code Helper (Plugin)
`);
	assert.equal(rows.length, 6);
	assert.equal(rows[2]!.name, "Google Chrome");
	assert.equal(rows[3]!.rss, 300000 * 1024);
	assert.equal(appName("Google Chrome Helper (Renderer)"), "Google Chrome");
	assert.equal(appName("Code Helper (Plugin)"), "Code");
	assert.equal(appName("Safari Web Content"), "Safari");
	const chrome = groupByApp(rows).find((a) => a.name === "Google Chrome")!;
	assert.equal(chrome.count, 3);
	assert.ok(Math.abs(chrome.cpu - 43.5) < 1e-9);
});

test("formatting", () => {
	assert.deepEqual(rate(8_610_000), { value: "8.61", unit: "MB/s" });
	assert.deepEqual(rate(1_250_000, true), { value: "10.0", unit: "Mb/s" });
	assert.deepEqual(bytes(19.8 * 1024 ** 3), { value: "19.8", unit: "GB" });
	assert.equal(duration(3 * 86400 + 4 * 3600 + 59).value, "3d 4h");
	assert.equal(duration(5 * 3600 + 12 * 60).value, "5h 12m");
});

test("ledger totals by window", () => {
	const l = new TransferLedger();
	const now = 1_700_000_000_000;
	l.add("en0", 100, 10, now - 30_000);
	l.add("en0", 100, 10, now - 90_000);
	l.add("en0", 100, 10, now - 2 * 3_600_000);
	l.add("en0", 100, 10, now - 25 * 3_600_000);
	assert.deepEqual(l.total("en0", 60_000, now), { rx: 100, tx: 10 });
	assert.deepEqual(l.total("en0", 3_600_000, now), { rx: 200, tx: 20 });
	assert.deepEqual(l.total("en0", 86_400_000, now), { rx: 300, tx: 30 });
});

test("hub runs, lingers, and drops collectors", async () => {
	let runs = 0;
	const hub = new Hub((key) =>
		key === "x"
			? {
					intervalMs: 1000,
					async collect(h) {
						runs++;
						h.record("x", runs);
					}
				}
			: undefined
	);
	const t0 = 1_000_000;
	hub.want("x", t0);
	await new Promise((r) => setImmediate(r));
	assert.equal(runs, 1);
	await hub.tick(t0 + 500);
	assert.equal(runs, 1, "not due yet");
	await hub.tick(t0 + 1000);
	assert.equal(runs, 2);
	await hub.tick(t0 + 11 * 60_000);
	assert.equal(runs, 2, "dropped after lingering unwanted");
	assert.deepEqual(hub.history("x"), [1, 2]);
});

test("every face renders without data", () => {
	const hub = new Hub(() => undefined);
	for (const category of ["cpu", "memory", "gpu", "disk", "network", "ping", "system", "top", "app"] as const) {
		for (const style of ["graph", "gauge", "number"] as const) {
			const uri = face(hub, category, { style, app: "Nothing" });
			assert.ok(uri.startsWith("data:image/svg+xml"), category);
			assert.ok(!decodeURIComponent(uri).includes("NaN"), `${category}/${style} drew NaN`);
		}
	}
});
