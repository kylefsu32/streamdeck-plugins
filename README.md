# streamdeck-plugins

Custom Elgato Stream Deck plugins, one directory per plugin.

| Plugin                          | What it does                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------- |
| [claude-usage](./claude-usage/) | Claude Code usage as Apple Watch style activity rings, computed from local transcripts |
| [claude-harness](./claude-harness/) | Your Claude Code sessions as a harness device shows them: working, done, needs you. Answer prompts from the deck |
| [claude-gauges](./claude-gauges/) | Fill gauges for the 5-hour session and weekly limits, from Anthropic's usage endpoint (moved from streamdeck-claude-gauges) |
| [system-vitals](./system-vitals/) | Live Mac system stats on keys: CPU, memory, GPU, disk, network, ping, battery, top apps |

Each plugin is self-contained — its own `package.json`, build, and manifest.

```bash
cd claude-usage
npm install
npm run build
npx streamdeck link com.kylefsu.claude-usage.sdPlugin
```

The Elgato CLI is a dev dependency, so `npx` runs it without a global install.

`streamdeck link` needs the Stream Deck desktop app on the same machine, so run
it wherever the deck is actually plugged in.
