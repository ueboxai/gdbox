---
name: local-files
description: Work with files and programs on the user's own computer — list a directory, find files by glob, search contents, read text or images, write and edit files (GDScript, .tscn, .tres, project.godot included), run shell commands where a shell exists, and connect a third-party MCP server the user has installed. Use when the user names a path on disk, wants scripts, scenes or config files in their Godot project changed, asks to bring files from disk into the project ("把这个文件夹里的图放进工程"), or says they installed an MCP server and wants it connected. Do not use for searching the box's own asset library, for generating art or audio, or for verifying game behaviour (that is godot-verify-changes).
---

# Files on the user's computer

A Godot project is a folder of text files plus media. Scripts (`.gd`), scenes (`.tscn`),
resources (`.tres`) and `project.godot` are all plain text, so these tools are how you read and
change a Godot project — there is no separate "engine API" to go through.

Read: `list_local_dir`, `find_local_files`, `grep_local_files`, `read_local_file`.
Write: `write_local_file`, `edit_local_file`. Run: `run_shell_command` (only where a shell exists).

## `list_local_dir` — before you act on a folder, look inside it

```
list_local_dir(path: "D:/素材/角色")
list_local_dir(path: "D:/素材/角色", pattern: ".png")
```

Directories come first and are marked `[目录]`; files show their size.

When the user says "把这个文件夹里的图放进工程", list it first. Do not infer contents from the
folder's name, and do not guess file paths — a guessed one simply fails.

Capped at 200 entries. When more exist, the header says so — pass that on to the user rather than
quietly acting on the first 200. Use `pattern` to narrow before resorting to summarising.

## `read_local_file` — text and images

```
read_local_file(path: "D:/Games/MyGame/project.godot")
read_local_file(path: "D:/Games/MyGame/scenes/player.tscn", offset: 40, limit: 30)
read_local_file(path: "C:/Users/me/Desktop/reference.png")
```

**Images come back as pictures you can actually see.** When the user says "参考这张图" and gives a
path, read it and describe what you see before proposing anything — do not ask them to describe
their own reference.

Long files are truncated with a note telling you the offset to continue from. Read the part you
need rather than pulling a huge log into the conversation.

Binary Godot formats (`.scn`, `.res`, `.glb`) are not readable as text. If a scene you need to
change is a `.scn`, tell the user; do not try to patch binary bytes.

## What is off limits

Credential and browser-data locations are refused: the box's own key store, `.ssh`, `.aws`,
`.gnupg`, Chrome and Firefox profiles. If a task seems to need something from those, ask the user
to look and tell you — do not try another path spelling to get around it.

Everything else on disk is readable. The user naming a path is the authorisation; you should still
say which file you are about to open when it is outside their Godot project.

## `find_local_files` — locate files across directories

```
find_local_files(path: "D:/素材", pattern: "**/*.png")
find_local_files(path: "D:/Games/MyGame", pattern: "**/*.tscn")
```

Use this instead of walking down with `list_local_dir` when the file could be at any depth.
Patterns are glob, relative to `path`; cross-directory patterns need a leading `**/`.

`.godot`, `.import`, `build`, `export`, `exports`, `.git` and `node_modules` are skipped by
default. `.godot/` is the editor's import cache — every texture and model is stored there a second
time, and none of it is something the user edits. If the user genuinely wants something from an
export folder, read it directly by path.

## `grep_local_files` — search inside files

```
grep_local_files(path: "D:/Games/MyGame", pattern: "move_and_slide", glob: "**/*.gd")
grep_local_files(path: "D:/Games/MyGame", pattern: "res://art/hero.png", glob: "**/*.{tscn,tres}")
```

The second form is how you answer "谁在用这个文件": scenes and resources reference each other by
`res://` path (and by `uid://`), so a text search finds every user. Do it before renaming, moving or
deleting anything in the project.

Narrow with `glob` before searching wide. Binary files are skipped. An invalid regex is reported
with the exact parser error — fix the pattern rather than trying a different spelling of the same
mistake.

Both tools cap their results and say so in the header when they hit the cap. Pass that on: "找到前
200 个" is a different answer from "找到 200 个".

## Writing and editing

`write_local_file` creates a file or **replaces one entirely**. `edit_local_file` replaces exact
snippets and can make several disjoint changes in one call.

Reach for `edit_local_file` whenever the file already exists and you only need part of it changed.
`write_local_file` discards everything you did not include — including the parts you never read.

For edits:

- `oldText` must match the file **character for character**, indentation and newlines included.
  GDScript indentation is tabs by default — copy it from what you read, do not retype it.
- Every `oldText` is matched against the **original** file, not the result of your earlier edits in
  the same call. Do not write overlapping or nested edits.
- Keep each `oldText` just long enough to be unique.
- Read the file first. Editing from memory of what a file "usually" looks like is how you get an
  exact-match failure and burn a turn.

Godot-specific rules for project files:

- **Never write under `.godot/`.** It is regenerated by the editor; changes there are lost or break
  the import cache.
- **Keep `uid://` values exactly as they are.** When you add an `[ext_resource]` for a file whose uid
  you do not know, write `path=` only and leave `uid=` out — Godot resolves it by path. Never invent
  a uid.
- When the user has a `.tscn` open in the editor, call `editor_save_all` before editing it, so their
  unsaved work is on disk first. After the write, the open editor reloads the scene from disk.

Under the default approval setting neither write tool asks for confirmation: every write is
snapshotted and shows up line by line in this turn's changes. When the user asked for the file,
write it — do not stop to ask first. Afterwards, say plainly which file you changed and what the
change was, then verify it (see the `godot-verify-changes` skill).

## Bringing files from disk into the project

In Godot, "importing" a file means putting it inside the project folder. The editor (or the next
`godot_check` / `godot_run`) notices it and imports it automatically; nothing else is needed.

- Copy with `run_shell_command` (`cp`), into the folder the project already uses for that kind of file (look first; `res://art/`, `res://audio/` and the like).
  `write_local_file` writes text only — it cannot copy a PNG or a WAV.
- **Copying from another Godot project? Copy the sidecars too.** Next to `hero.png` sits
  `hero.png.import` (import settings + uid); next to scripts and shaders there may be a `.uid`
  file. Copy them along, or scenes that referenced the file by uid break and the import settings
  (pixel-art filter, loop flags) are lost. Never copy anything from the other project's `.godot/`.
- Moving or renaming a file that is already in the project breaks every scene that points at its
  `res://` path. Grep for users first (see above), and prefer asking the user to move it in the
  Godot FileSystem panel, which rewrites references for them.

## Running commands

`run_shell_command` runs bash. **It is only present when the machine actually has a shell** (Git
for Windows, typically) — if you do not see the tool, that machine does not have one, and the
answer is to use the file tools or ask the user to run the command themselves.

Prefer the dedicated tools where they fit: `list_local_dir`, `find_local_files`,
`grep_local_files`, `read_local_file`. They are faster, produce tidier output, and work on every
machine.

Do not launch Godot from the shell to test the game. `godot_check`, `godot_run` and
`godot_screenshot` already know where Godot is, run it off-screen and serialise runs so two
imports do not trample the same `.godot/` cache.

## `connect_mcp_server` — something the user installed, wired into the box

An MCP server is another program on this machine (or a service on it) that exposes its own tools.
`connect_mcp_server` handshakes with it and, only if that succeeds, writes it into the box's
config. Two shapes, pick by what the user's server documents:

```
connect_mcp_server(id: "filesystem", command: "npx",
                   args: ["-y", "@modelcontextprotocol/server-filesystem", "D:/assets"])
connect_mcp_server(id: "something", url: "9876")
```

Most servers are the first shape — a local process, launched by a command. `url` is for the
handful that run as an HTTP service; a bare port is enough, it tries `/mcp` then the root.

Three things to get right:

- **Ask for the launch command, do not invent one.** "我装了 xxx MCP" is not enough to guess from.
  The server's README has the exact line; a made-up one fails with `ENOENT` and the user reads
  that as "this server is broken".
- **A port that answers is not proof of an MCP endpoint.** Many tools' ports belong to their own
  plugin channel, not to a server that speaks MCP.
- **Its tools arrive on the next message, not this turn.** The tool list is assembled once per
  message. Tell the user it is connected and let them send the next message.

Blender is not done here — Settings → MCP installs it in one click, scripts and environment
variables included. Point the user at that button instead.

## What is deliberately missing

There is no dedicated delete tool, and you never remove, rename or move the user's files on your
own initiative. When the user explicitly asks for it, do it through `run_shell_command`, which asks
for their approval. Name the exact paths first, and confirm anything that is not obviously theirs to
lose (whole folders, files outside the folder they named). Inside a Godot project, deleting a file
that a scene still references breaks that scene — grep for users before deleting.
