---
name: gdbox
description: Drive GDBox and Godot 4 projects from the terminal through the `gdbox` CLI — check the connection, pick the target project, run headless checks and scripted play-tests (godot_check, godot_run), save game screenshots, read or drive the user's open Godot editor (editor_scene_tree, editor_play, editor_save_all), search the asset library, or hand a whole task to GDBox's own agent with `gdbox ask`. Use when the task needs GDBox's Godot tools or libraries and `gdbox --version` succeeds. Do not use when no GDBox is running, or for plain reading and editing of .gd and .tscn files — edit those directly.
---

# Driving Godot with `gdbox`

`gdbox` is a terminal client for GDBox. It talks to the running GDBox over a local loopback
connection. GDBox either runs a headless Godot (checks, play-tests, screenshots) or forwards
to the user's open Godot editor through the GDBox Link addon. Every command is one process:
it connects, does one thing, prints, exits. There is nothing to set up — it finds GDBox's
config on its own.

**Read-only unless you pass `--allow-write`.** With that flag you can call anything GDBox's
own assistant can call. Without it, every write exits 6. The flag is the user's consent:
the CLI has no approval dialog, so do not add it unless the user asked for a change.

## Start here

Run `gdbox doctor` once at the beginning of a session, and again after any connection
error. **Do not run it before every command** — it is a layered check, not a ping.

```
gdbox doctor --json
```

It reports the layers in order: connection (config and auth), contract, tool scope,
projects. Whichever layer fails carries its own remedy in `error.hint`. Follow that hint
rather than guessing. "No Godot editor connected" is only a warning: headless tools still work.

## Always read the exit code

| Code | Meaning                                                  | What to do                                           |
| ---- | -------------------------------------------------------- | ---------------------------------------------------- |
| 0    | Done. An empty result is still success                   | Continue                                             |
| 2    | Bad argument or output location                          | Fix the command                                      |
| 3    | Config or auth                                           | Read `error.code` before acting — see below          |
| 4    | GDBox unreachable or too old                             | Tell the user to start/upgrade GDBox                 |
| 5    | No single target project, or its editor is not connected | Pass `--project`, or ask the user to open the editor |
| 6    | Missing `--allow-write`, or tool out of scope            | See "Exit 6" below                                   |
| 7    | Timeout                                                  | **Verify the real state first**; do not resend       |
| 8    | Tool failed, or the file was not delivered               | Read the message                                     |
| 130  | Interrupted — nothing sent was rolled back               | Verify the real state                                |

With `--json`, stdout is exactly one JSON object, on success and on failure alike.
Parse `ok`, then `data` or `error`. Diagnostics go to stderr and never pollute stdout.

Exit code 3 covers four situations — read `error.code`:

- `CONFIG_MISSING` — no GDBox config found. GDBox has never been started on this machine,
  or it is installed somewhere unusual: pass `--config <path>` or set `GDBOX_HOST_CONFIG`.
- `CONFIG_UNREADABLE` — **the file is there, you just cannot read it.** Do not reinstall.
  In a sandbox, add that path to your readable set, or use `GDBOX_URL` / `GDBOX_TOKEN`.
- `CONFIG_INVALID` — the file is corrupt, or two installs were found and the CLI will not
  guess which. The hint says how to pick.
- `AUTH_FAILED` — the token was rejected. If you set `GDBOX_TOKEN`, it is stale; otherwise
  `gdbox doctor` shows which config was read.

## Picking the project

The target is decided in three steps: an explicit `--project` (the directory or its
`project.godot`), else the nearest `project.godot` walking up from the current directory,
else — only when exactly one Godot editor is connected — that editor's project.

- **Headless tools** (`godot_check`, `godot_run`, `godot_screenshot`) take the project as
  their `project_path` argument; the CLI fills it from `--project` or the current
  directory when you leave it out. No editor needed.
- **Editor tools** (`editor_*`) need that project's editor connected. A project named
  explicitly is never swapped for a different editor — if it is not connected the command
  exits 5. Ask the user to open it in Godot with the GDBox Link addon enabled.

When `gdbox projects list` shows more than one connected editor, pass `--project` on
every command.

## Two ways in: one tool, or the whole agent

### Calling tools

```
gdbox tools list --search godot --json
gdbox tools show godot_run --json
gdbox tools call godot_check --project "D:/Games/Demo" --json
gdbox tools call godot_run --args-file ./run.json --json
gdbox tools call editor_scene_tree --json
gdbox tools call editor_save_all --allow-write --json
```

`tools show` never needs `--allow-write` — call it before `tools call`, because it returns
the real input schema. Do not invent arguments from a tool's name.

The tools that answer most questions:

- **`godot_check`** imports the project and runs it headless, then reports script and
  engine errors. Run it after every script or scene change; a change is not done while it
  reports errors.
- **`godot_run`** plays for a few seconds with scripted input (InputMap actions, keys, mouse
  clicks and drags on coordinates or nodes) and samples values over time (`watch`, e.g.
  `"Player:position:y"`, `"max(@balls:global_position:y)"`). Use it to verify behaviour —
  a double jump, a dash, a menu button — without writing test scenes into the project.
  It also reports positions or velocities that became NaN.
- **`editor_scene_tree`** reads the scene open in the user's editor.
- **`gdbox screenshot --output <file.png>`** runs the game off-screen and saves the last
  frame. Details: `references/screenshots.md`.

For nested arguments, write a UTF-8 JSON file and pass `--args-file`; this sidesteps quoting
differences between PowerShell, cmd and bash. `--args-file -` reads stdin.

### Handing a task to GDBox's agent

```
gdbox ask "check the main scene's scripts for errors" --json
gdbox ask "add a double jump to the player and verify it" --allow-write --json
```

- **Read-only by default.** Without `--allow-write` the agent's write tools are removed.
- **Its reach is fixed:** Godot tools, project files (read/write, no shell), the asset
  library and the project library. It never gets the shell, the browser or third-party MCP
  servers, with or without the flag.
- The project path is written into the task. If that project's editor is not connected,
  the agent still works but cannot use `editor_*` tools; a warning says so.
- **It runs on GDBox's default model**, billed to it. `--model <id>` picks another of
  GDBox's models; only add it when the user names one. Do not use it for a single lookup
  that one `tools call` would answer.
- Progress goes to stderr; the conclusion is `data.answer`. For `ask`, `--timeout` is how
  long it may go without any progress, not total time.

`gdbox tools call task` is refused on purpose — use `ask`, which applies the limits above.

## Changing things

- **`--allow-write` is required on every write.** Leaving it off gives exit code 6.
- **Judge by what the tool reported**, not by what you asked for.
- **Verify before reporting done.** After editing scripts or scenes, run `godot_check`;
  for behaviour, `godot_run`.
- Editor changes live in the editor until saved; `editor_save_all` writes them to disk.

## After a timeout, verify — do not resend

Exit code 7 means the request was sent and the outcome is unknown. Resending can do an
already-finished operation twice. Look at the current state first (`editor_scene_tree`,
`godot_check`, the files on disk) and decide from what you see. Imports of a large project
can take minutes; pass a larger `--timeout` (default 120 seconds) for those.

## Exit 6: missing consent, or genuinely out of scope

- **"this command has not enabled writes"** — pass `--allow-write` only if the user asked
  for the change.
- **"out of scope"** — the tool demands per-call human approval, GDBox did not declare what
  it is, or it is `task` (use `ask`). Report that plainly and stop.

If a write tool is missing from `tools list --allow-write` entirely, GDBox's MCP settings
are set to read-only for external clients. `gdbox doctor` says so; that is the user's
switch to flip, not something to route around.
