# Claude Harness — Stream Deck plugin

Your Claude Code sessions on the deck, the way the
[OpenHarness](https://github.com/autonomous-ai/openharness) **Harness device** shows
them on its round dial: which session is working and on what, which one finished
and what it did, and which one is waiting on you. You can answer permission
prompts and Claude's multiple-choice questions from the deck without switching
windows.

Run `npm run preview` to see every key face in `dist/preview.html`.

## What the keys show

The device gives each agent one of a few moods. Each one maps to a key face with the
same coloured top bar, so you can read the deck at a glance:

| Mood | Bar | Key face |
| --- | --- | --- |
| **Working** | coral | A spinning ring with the turn's elapsed time in the middle (`0:34`, `12:05`, `1h 5m`). Under it is the running tool, for example `Bash · npm test` or `Edit · plugin.ts`. |
| **Needs you** | amber, pulsing | `Allow Bash?` and the command, or the question Claude asked. |
| **Done** | green | A check mark and the first lines of Claude's last message. It stays until you press the key. |
| **Error** | red | The API error that ended the turn. |
| **Idle** | grey | `Ready · 4m ago`. |
| **Asleep** | dim | Idle for more than 30 minutes. |

### Actions

| Action | What it does |
| --- | --- |
| **Agent** | Shows one session. By default a key shows the Nth session in the order they started (slot 1–8). You can pin it to a project folder instead. Pressing it marks a finished turn as read. |
| **Overview** | Counts how many sessions need you, are working, and finished unread, like the dial's overview. Pressing it marks every finished turn as read. |
| **Inbox** | Shows the newest unread recap, with a badge for how many are waiting. Pressing it marks that one as read and shows the next, like the device's notification drawer. |
| **Needs You** | Shows the prompt that has waited longest. When there are several, a `1/3` counter appears and pressing the key steps to the next. |
| **Allow / Deny** | Answers the permission prompt shown on Needs You. The keys only light up when the deck is able to answer that prompt (see below). |
| **Always Allow** | Allows the prompt and saves the rule Claude Code suggests, which is shown on the key (`Bash(gh pr *)`). It shows the rule rather than the command because the rule is what gets saved. It refuses when no single safe rule is on offer, and for 30 seconds after you deny something the rule would re-allow. See below. |
| **Option** | Option 1–4 of Claude's multiple-choice question (AskUserQuestion). Pressing it answers. A question with several parts takes one press per part. |
| **Use Terminal** | Lets go of the held prompt or question right away, so Claude Code's own picker shows it. |

### Usage keys

| Action | What it shows |
| --- | --- |
| **Usage** | One limit (session, weekly, Opus or Sonnet) in one of three styles. **Bar:** the percent, the reset date, the other window and a fill bar. **Ring:** the percent and the time to reset. **Forecast:** where the window ends at the current pace, with `Locks 12 Nov` in red if that comes before the reset, and the rate per day or hour. Press to refresh. |
| **Usage Strip** | The same on a Stream Deck + touch strip. Turn the dial to switch limits, and press or tap to refresh. |

The numbers come from the same endpoint `/usage` reads, using your Claude Code
sign-in, at most once a minute and only while a usage key is on screen. The client is
the one from `claude-gauges` in this repo, with the same rules: it never refreshes the
token, and on a failure it backs off rather than retrying. The forecast is a straight
line from the pace so far in the window. It says nothing until 5% of the window has
passed. Window lengths (5 hours, 7 days) are assumed, because the endpoint only
reports reset times.

### Ready-made profiles

Installing the plugin also installs a profile for your device, so a working page is
ready before you place any keys:

- **MK.2 / 15 keys:** sessions 1–4 with Overview, then sessions 5–8 with Inbox, then Needs You, Allow, Always, Deny and Use Terminal.
- **Mini:** sessions 1–2 and Overview on top, with Needs You, Allow and Deny below.
- **XL:** sessions 1–16 on the top two rows, then weekly Bar, session Ring and weekly Forecast usage keys. The bottom row holds Needs You, Allow, Always, Deny, Use Terminal, Inbox and Overview.
- **Stream Deck +:** sessions 1–4, then Needs You, Allow, Deny and Overview.

Each device also gets an **answer page**: the question, its options as large keys,
and Use Terminal. When Claude asks a multiple-choice question and the deck can answer
it, the deck jumps to that page. Once the question is answered, or the hold runs out,
the deck goes back to the page you were on. To stop the jump, turn off *Jump to the
answer page* in any key's settings.

`profile/build_profiles.py` (`npm run profiles`) generates every profile from its `LAYOUTS` table.

## How it works

```
claude (any terminal) ──hook event──▶ bin/hook.mjs ──▶ ~/.claude/streamdeck-harness/sessions/<id>.json
                                           ▲                              │
                     answers/<prompt>.json │                              ▼ fs.watch + 2 s rescan
                                           └────────── Stream Deck plugin (keys)
```

OpenHarness doesn't wrap the agent CLI. It reads the vendor's own hooks, and this
plugin does the same. When the plugin starts, it adds one command to Claude Code's
`~/.claude/settings.json` for each of these events: `SessionStart`, `SessionEnd`,
`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`,
`Notification`, `Stop` and `StopFailure`. Claude Code runs that command with the
event on stdin, and the hook folds the event into a small JSON file for that
session. The plugin only reads those files. Plain files mean that a session which
changes state while the Stream Deck app is closed still shows up correctly when the
app starts.

- **The install is safe to repeat.** The plugin finds its own entries by the plugin
  id in the command and replaces them on every start, so the path follows the Stream
  Deck app's bundled Node when that changes. Your own hooks are left alone.
  `settings.json` is backed up once to `settings.json.before-claude-harness`. If the
  file isn't valid JSON, the plugin leaves it untouched and logs why.
- **Installing by hand:** tick *I installed the hook myself* in any key's settings.
  Then use `npm run hooks:install` / `npm run hooks:uninstall`, or run
  `node <plugin>/bin/hook.mjs --install`.
- **The hook can't break Claude Code.** Every failure ends in a silent `exit 0`, so
  the worst case is a key that shows an old state.
- **Recaps** come from `last_assistant_message` when Claude Code sends it. Otherwise
  they come from the last 512 KB of the transcript. Markdown is stripped so the text
  fits on a key.
- **Read state belongs to the deck.** It lives in `acks.json`, so pressing a key never
  writes to a file that a hook might be writing at the same moment.
- **Stale sessions are cleaned up.** A session that crashed and never sent
  `SessionEnd` disappears from the deck after 12 hours. Its file is swept after 24
  hours.

### Answering prompts from the deck

**Permission prompts.** A `PermissionRequest` hook can answer a prompt itself. While
an **Allow**, **Always** or **Deny** key is on the deck, the plugin writes a
heartbeat. If the heartbeat is fresh, the hook waits up to 15 seconds (you can change
this) for a press. The prompt appears on Needs You with a countdown
(`Answer on deck · 12s`). The terminal prompt stays usable the whole time, and
whichever is answered first wins. agent-vitals observed this behaviour on real
hardware.

**Always Allow** follows rules agent-vitals learned the hard way:

- It only echoes back one concrete `addRules` allow rule. It never passes on
  `setMode` or `addDirectories`, and never anything for MCP tools.
- The rule must be short enough to show in full.
- The rule is saved to the project's local settings, or to the session if you tick
  *For this session only*. It is never saved to your user settings.
- After a Deny, Claude retries the same call within about two seconds, and the
  retry looks identical on the key. So for 30 seconds the key reads `just denied`
  and refuses a rule that would re-allow the call you just refused.

**Multiple-choice questions.** These wait in `PreToolUse`, before Claude Code draws
its picker. They are held only while an Option key is on the deck, or a deck can jump
to the answer page. The hold lasts 60 seconds by default, and you can change it.
Pressing an option hands the tool its `answers` up front, which is the same field an
Agent SDK host fills in, so Claude never opens the picker. During the hold the
terminal shows the hook running instead of the picker. Press **Use Terminal**, or
wait out the hold, to get the picker back.

Setting a hold to *Off*, or removing the matching keys, turns holding off completely.

**Not yet verified on real hardware.** I haven't watched these work against a live
session. Answering with `updatedInput.answers` from `PreToolUse` and the profile jump
are the two to check first.

### Sessions that ended without saying so

Claude Code keeps a file per running process in `~/.claude/sessions/` that names its
session. A session whose process is gone drops off the deck at once, without waiting
for the 12-hour timeout. Sessions with no such file are left alone.

## Build

```bash
npm install
npm run build            # plugin + hook into com.kylefsu.claude-harness.sdPlugin/bin/
npm test                 # reducer, settings merge, rules, decisions, text fitting
npm run preview          # dist/preview.html
npx streamdeck link com.kylefsu.claude-harness.sdPlugin
npm run package          # dist/com.kylefsu.claude-harness.streamDeckPlugin
```

`npm run icons` re-renders the PNGs from the same SVG the keys draw. It needs
Playwright's Chromium.

## Credits

- [OpenHarness](https://github.com/autonomous-ai/openharness) (MIT, Autonomous, Inc.)
  supplied the model: the device's agent moods, the working line that names the
  running tool, the elapsed clock and its format, recaps on finished turns, an inbox
  of unread finishes, and the idea of reading the CLI's own hooks rather than
  wrapping it. No code was copied. The device firmware is C on an ESP32, and this
  plugin is new TypeScript.
- [Stream Deck Claude Plugin](https://github.com/kotyzap/Stream-Deck-Claude-Plugin)
  (MIT, Pavel Kotyza) supplied the setup: a profile per device that installs with
  the plugin, key art with a coloured state bar and the label drawn into the image,
  and Allow / Deny on physical keys. The profile builder is written fresh, after
  its `build_profile.py`.
- [streamdeck-claude-answer](https://github.com/hardkoded/streamdeck-claude-answer)
  (MIT, Dario Kondratiuk) supplied the answer page: jump the deck to a page with the
  question, its options and a way back to the terminal, then return. Here it is
  wired to Claude's own AskUserQuestion rather than a separate CLI.
- [Agent Vitals](https://github.com/tapparello/agent-vitals) (MIT) supplied the Always
  Allow rules and the deny guard, the fact that the terminal prompt stays usable while
  a PermissionRequest hook is pending, the `~/.claude/sessions` liveness check, and
  telling Allow, Always and Deny apart by shape as well as colour.

Not affiliated with Anthropic, Autonomous or Elgato.
