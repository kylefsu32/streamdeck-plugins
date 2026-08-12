# Claude Usage — Stream Deck plugin

Claude Code usage as Apple Watch style activity rings. Outer ring is the rolling
session window, inner ring the rolling week.

## Where the numbers come from

Two sources, and a ring picks one.

**Anthropic's own figures — the default.** `GET api.anthropic.com/api/oauth/usage`
returns the real utilization and reset time for both limit windows, which is the
same source `/usage` reads. Exact percentages, real resets, nothing to calibrate.

This needs Claude Code's OAuth token, which lives in your macOS keychain under
`Claude Code-credentials` (on Windows, `~/.claude/.credentials.json`). The plugin
reads only the `claudeAiOauth` branch — that blob also holds every authenticated
MCP server's credentials, which are never touched — and uses the token for
exactly one thing: that one authenticated GET. It is never logged, written, or
sent anywhere else. **macOS will prompt once for keychain access; choose Always
Allow or the key sits at "NO DATA".**

The endpoint is undocumented, so Anthropic could change it. Two behaviours are
load-bearing and were learned the hard way:

- **The User-Agent must look like Claude Code.** Anything else gets an
  aggressively rate-limited bucket and persistent `429`s. Sending
  `claude-usage-streamdeck/0.1` put a machine in a penalty box for an hour.
- **A failure triggers a cooldown, not a retry.** Every visible key asks for a
  redraw, so without one a failure makes each key fire its own request — pushing
  the rate *up* exactly when the API wants less.

**Your local transcripts.** Everything the API cannot answer: per-model usage,
arbitrary windows, burn rate, and token counts. These need a ceiling you set
once. This path makes no network calls and reads no credentials.

<!-- Run `npm run preview` to render the key art to dist/preview.html. -->

## Why this exists

Claude Code writes a `usage` block onto every assistant message in
`~/.claude/projects/**/*.jsonl`. The trap is that **a single API response is
written as several JSONL lines — one per content block — and every one of those
lines carries a full copy of the same cumulative `usage` object.**

Summing the lines therefore counts the same call once per content block. On a
real corpus that inflated the total by **2.8x**, and on a tool-heavy day by
**9.8x**. This plugin deduplicates by `requestId`, so each billed call is
counted exactly once.

That is the whole reason it exists. If a usage monitor reads high and drifts
higher the more tool calls you make, this is why.

## What it measures

Raw token counts are not comparable to each other — a cache read is a tenth the
price of an input token, an output token is five times it. Totals are therefore
expressed in **effective input tokens**, mirroring Anthropic's published price
ratios:

| Token class          | Weight |
| -------------------- | ------ |
| input                | 1.0    |
| cache write (5 min)  | 1.25   |
| cache write (1 hour) | 2.0    |
| cache read           | 0.1    |
| output               | 5.0    |

Model weights default to 1.0 across the board. Claude Code's own limits do
weight models differently, but those ratios are not published anywhere readable,
and inventing them would add error rather than remove it. Because you calibrate
the ceiling by hand, a uniform weight self-corrects as long as your model mix is
roughly stable.

## Calibrating the ceilings

Claude Code does **not** store your plan limits on disk — `/usage` fetches them
live. So the percentages need a ceiling you supply once.

```bash
npm run report
```

```
window                 effective   calls     output   cache rd
──────────────────────────────────────────────────────────────
last 1h                        —       —          —          —
last 5h  (session)             —       —          —          —
last 24h                       —       —          —          —
last 7d  (week)                —       —          —          —
```

Dashes stand in for your own figures. Compare the session and week rows against
the percentages `/usage` reports in Claude Code — if `/usage` says 50% and the
session row reads 20M, your session ceiling is about 40M. Enter that in the
property inspector.

The report also breaks the window down per model, which is what a model-specific
key needs — both its ceiling and the substring to filter on:

```
per model — history (60d)
model                            effective   calls    share
───────────────────────────────────────────────────────────
claude-opus-5                            —       —        —
claude-fable-5                           —       —        —
claude-haiku-4-5-20251001                —       —        —
```

Pass a day count to widen the history: `npm run report -- 60`.

Leave a ceiling empty and that ring stays dark while the readout falls back to a
raw token count — the key is still useful before you calibrate.

## Actions

### Usage Rings

A key rests as rings alone. **Pressing swaps the face to text alone — no rings —
and pressing again swaps back**, so a wall of keys stays quiet until you ask one
a question. Dropping the rings frees the whole canvas, so the figures render
about twice the size they could manage inside a ring's centre hole. A two-ring
key shows both numbers.

Values keep the colour of the ring they replace and turn red over budget, so a
pressed key is still identifiable at a glance. On the rings themselves, past 100%
the ring turns red and a thinner overshoot arc wraps back around on top, the way
the Watch does it.

Each key is either **one ring** or **two**, and every ring is configured
independently:

| Setting  | Notes                                                                    |
| -------- | ------------------------------------------------------------------------ |
| Tracks   | Session (the 5-hour limit), week, day, or a custom number of hours        |
| Ceiling  | Effective tokens that mean 100%. Empty leaves the ring dark               |
| Model    | Case-insensitive substring of the model id. Empty counts every one        |
| Colour   | Coral, teal, violet, amber, green, blue                                   |

**Session is a block, not a trailing window.** Claude's session limit opens on
your first message and runs for five hours whatever you do inside it; when it
expires your usage drops to zero and the next message opens a new one. A
trailing-five-hours sum would disagree with `/usage` most of the time — it keeps
counting work the real limit has already forgiven, and it never shows the reset.
So a session ring fills through the block and empties at the reset, and its
caption counts down to that reset (`RESET` once expired). Blocks are anchored to
the top of the hour.

That is what makes single-ring keys worth having — one key per thing you care
about, each its own colour:

| Key         | Layout | Window | Model   | Colour |
| ----------- | ------ | ------ | ------- | ------ |
| Session     | single | `5`    | —       | coral  |
| Week        | single | `168`  | —       | teal   |
| Fable       | single | `5`    | `fable` | violet |
| Opus        | single | `5`    | `opus`  | amber  |
| Session + week | dual | `5` / `168` | —  | coral / teal |

When the readout is showing, a model filter captions the key with the model
rather than the window, so a per-model key labels itself.

Other settings: **Reads** (percent, tokens, or percent-falling-back-to-tokens)
and **Refresh** (5–120s, default 20s).

### Burn Rate

One ring showing how much of the session ceiling is gone. Pressing swaps it to
the readout, same as the rings key; whether that reads the current spend rate or
the projected time until you hit the ceiling is a property-inspector setting. It
takes the same model filter and colour, so you can watch one model's rate.

The rate is effective tokens per hour over the rate window, measured against
wall-clock time — an idle stretch pulls it down rather than being ignored.

## Long press

Holding a key opens Claude Code's own `/usage` view in a terminal. That is the
authoritative number, straight from Claude, next to this plugin's calibrated
estimate — and it is how you recalibrate a ceiling when it drifts.

| Setting   | Default    | Notes                                             |
| --------- | ---------- | ------------------------------------------------- |
| Holding does | Open /usage | Or run a command of your own, or nothing       |
| Hold for  | 600ms      | 300–1500ms                                        |
| Terminal  | `Terminal` | Any app name — `iTerm`, `Ghostty`, `WezTerm`      |
| Open in   | `~`        | Directory the session starts in                   |
| Command   | —          | Used only by "Run a command"                      |

The SDK has no long-press event, so it is timed from key-down: the long action
fires while the key is still held, and the following key-up is swallowed so a
long press never also toggles the readout.

Two implementation notes, because both were failure modes worth avoiding:

- It launches by writing a small `.command` script and handing it to `open -a`,
  **not** by driving the terminal with AppleScript. AppleScript would need
  Stream Deck to hold Automation permission for that specific terminal, and a
  missed or denied TCC prompt leaves the key silently doing nothing. `open` is a
  launch, not an Apple event, so no permission is involved — and any terminal
  works by name rather than needing per-app scripting terminology.
- That script re-execs through your login shell, because `claude` usually lives
  in `~/.local/bin` and a `.command` file does not inherit it on PATH.

Failures are logged rather than swallowed; the key flashes an alert if the long
press had nothing to run.

## Install

Requires the Stream Deck desktop app 6.5+ and Node 20+.

```bash
npm install
npm run build
npx streamdeck link com.kylefsu.claude-usage.sdPlugin
```

The Elgato CLI comes in as a dev dependency, so `npx` runs it without a global
install. Drop the `npx` if you have `@elgato/cli` installed globally.

`streamdeck link` needs the Stream Deck app installed on the same machine, so
run it wherever the deck actually lives. To iterate:

```bash
npm run watch
```

To produce a double-clickable installer instead:

```bash
streamdeck pack com.kylefsu.claude-usage.sdPlugin
```

## Layout

```
src/
  engine/
    scanner.ts     incremental transcript reader, requestId dedup
    aggregate.ts   windowing, weighting, burn rate, projections
    service.ts     one shared poller for every visible key
    types.ts       sample shape and the weight table
  render/
    rings.ts       SVG activity rings as a data URI
    format.ts      compact tokens, percentages, durations
  actions/         the two Stream Deck actions
  report.ts        calibration CLI
  preview.ts       renders key art to dist/preview.html
tools/
  make-icons.py    generates the PNG assets, no dependencies
```

Transcripts are read incrementally — only bytes appended since the last scan —
so a poll costs on the order of 100ms even on a large transcript directory, and
much less once the first scan has been done.
`CLAUDE_CONFIG_DIR` is honoured if you have moved `~/.claude`.

## Known limits

- **The token modes are approximations; the limit modes are not.** A ring set to
  a limit reports Anthropic's own number. A ring counting tokens depends on the
  ceiling you gave it and on a uniform model weighting, and its weekly window is
  a trailing 7 days rather than Claude's actual reset schedule.
- **The usage endpoint is undocumented and rate-limited.** If it changes or
  starts refusing, limit rings show "NO DATA" or "STALE" rather than a wrong
  number, and the plugin log says which.
- **Percentages are only as good as your ceiling.** Recalibrate if you change
  plan or your model mix shifts a lot.
- **One machine only.** It reads the transcripts on the machine it runs on. If
  you use Claude Code on several machines, each deck shows that machine's usage.
