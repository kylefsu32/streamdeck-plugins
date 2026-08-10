# Claude Usage — Stream Deck plugin

Claude Code usage as Apple Watch style activity rings. Outer ring is the rolling
session window, inner ring the rolling week.

Everything is computed locally from your own transcripts. The plugin makes no
network calls, reads no credentials, and needs no API key.

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
last 1h                    1.10M      42      67.6K      4.31M
last 5h  (session)         4.66M     188     210.9K     25.82M
last 24h                   4.66M     188     210.9K     25.82M
last 7d  (week)            4.66M     188     210.9K     25.82M
```

Compare the session and week rows against the percentages `/usage` reports in
Claude Code. If `/usage` says 50% and the session row reads 20M, your session
ceiling is about 40M. Enter that in the property inspector.

The report also breaks the window down per model, which is what a model-specific
key needs — both its ceiling and the substring to filter on:

```
per model — history (60d)
model                            effective   calls    share
───────────────────────────────────────────────────────────
claude-opus-4-8                    181.27M    2529      45%
claude-opus-5                      160.04M    3849      40%
claude-fable-5                      62.34M    1700      15%
claude-haiku-4-5-20251001           189.5K      23       0%
```

Pass a day count to widen the history: `npm run report -- 60`.

Leave a ceiling empty and that ring stays dark while the readout falls back to a
raw token count — the key is still useful before you calibrate.

## Actions

### Usage Rings

A key rests as rings alone. **Pressing it reveals the readout, pressing again
hides it** — so a wall of keys stays quiet until you ask one a question. Past
100% the ring turns red and a thinner overshoot arc wraps back around on top,
the way the Watch does it.

Each key is either **one ring** or **two**, and every ring is configured
independently:

| Setting  | Notes                                                             |
| -------- | ----------------------------------------------------------------- |
| Window   | In hours. `5` for the session, `168` for a week, `24` for a day    |
| Ceiling  | Effective tokens that mean 100%. Empty leaves the ring dark        |
| Model    | Case-insensitive substring of the model id. Empty counts every one |
| Colour   | Coral, teal, violet, amber, green, blue                            |

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

One ring showing how much of the session ceiling is gone, with the current spend
rate or the projected time until you hit it. Pressing flips between the two. It
takes the same model filter and colour, so you can watch one model's rate.

The rate is effective tokens per hour over the rate window, measured against
wall-clock time — an idle stretch pulls it down rather than being ignored.

## Install

Requires the Stream Deck desktop app 6.5+ and Node 20+.

```bash
npm install
npm run build
streamdeck link com.kylefsu.claude-usage.sdPlugin
```

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
so the poll costs about 100ms on a 150MB corpus and much less thereafter.
`CLAUDE_CONFIG_DIR` is honoured if you have moved `~/.claude`.

## Known limits

- **Windows are rolling, not aligned.** Claude's real session window starts at
  your first message and its weekly limit resets on a fixed schedule. A rolling
  5h/7d approximation tracks closely during active work but will disagree around
  a reset boundary.
- **Percentages are only as good as your ceiling.** Recalibrate if you change
  plan or your model mix shifts a lot.
- **One machine only.** It reads the transcripts on the machine it runs on. If
  you use Claude Code on several machines, each deck shows that machine's usage.
