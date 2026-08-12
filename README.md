# streamdeck-plugins

Custom Elgato Stream Deck plugins, one directory per plugin.

| Plugin                          | What it does                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------- |
| [claude-usage](./claude-usage/) | Claude Code usage as Apple Watch style activity rings, computed from local transcripts |

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
