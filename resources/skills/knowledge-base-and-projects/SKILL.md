---
name: knowledge-base-and-projects
description: Read and add sources to the user's knowledge base, list the Godot projects registered in 我的项目, tidy that project list into collections and pins, bring assets from the box's library into a Godot project, and check or manage the box itself (its assistant's past conversations, stuck imports, skills, third-party MCP servers, backups). Use when the user wants researched material saved to a knowledge base, wants to recall material from the bound knowledge base, wants their projects grouped, sorted or pinned on the home screen ("按 Godot 版本把工程分个组"), wants assets from their library put into a Godot project, or asks about the box itself ("盒子里刚才那个对话", "导入卡住了", "关掉这个技能"). Do not use for a standalone note: notes are an internal knowledge-base source type and have no separate user-facing entrance.
---

# Knowledge base and projects

Nothing here needs the Godot editor running. Projects are folders on disk; the box keeps a list
of them (我的项目) and a library of assets beside them.

## Knowledge base

A text source is an implementation detail inside a knowledge base. Saving research belongs in a
knowledge base, not in a note — `create_note` writes an asset's or folder's "detailed note", which
is a different thing with a different entrance (the asset library's details panel).

Notes are the other half, and they are separate from knowledge bases:

- `search_notes` — search or list the user's notes.
- `get_note` — read one in full.

Reach for these when the user refers to something they wrote down ("我之前记过"), rather than to
research they collected. Searching the knowledge base for it will come back empty and read as
"you never wrote that", which is worse than looking in the right place.

Knowledge-base tools use the knowledge base currently bound to the conversation when one exists:

- `search_notebook_sources` searches its existing sources.
- `add_notebook_source` adds either a web page or a text source. If no knowledge base is bound, it
  creates a new one so the result still has a real user-facing home.

Outside the box (a client connected over MCP) there is no bound knowledge base. There
`search_notebook_sources` searches every knowledge base unless you pass `notebook` with a title, and
`add_notebook_source` saves into the knowledge base whose title matches `notebookTitle`, creating
one only when none matches — pass it whenever the user said where the material goes.

Inside the box, if the user names an existing knowledge base but the conversation is not bound to
it, tell them to type `/wiki` and choose that target before saving. Do not create a duplicate with the same name.
Never fall back to a note, a local file, or the chat transcript.

For a web source, give `add_notebook_source` its URL and let the tool fetch the page. For a report
you wrote, give it a clear title and Markdown content. Only say the material was saved after the
tool succeeds, and name the knowledge base reported by the tool so the user knows exactly where
to verify it.

## Projects

Two tools, split by what they touch:

**`project_list`** (read-only, never asks) — every Godot project registered in 我的项目: its
`projectKey`, name, Godot version, folder, whether the folder is still on disk, whether an editor is
connected right now, plus the collections. Pass `keyword` to narrow by name or path.

**`project_organize`** (tidies the list, touches no project files) — `group_projects`,
`ungroup_projects`, `pin_projects`, `update_collection`, `delete_collection`.

There is no tool that creates a project or opens one in the editor. When the user wants a new
project, the folder plus a `project.godot` is a project — but ask before writing one, and tell them
to open it from Godot (or add it to 我的项目 in the box) so it shows up on the home screen.

### Tidying the project list

"按 Godot 版本帮我把项目分个组" is `project_organize`, one call per group:

```
project_list()                      → godotVersion per project, plus collections
project_organize(action: "group_projects", collection: "Godot 4.3", projects: [...])
```

Read `project_list` first. It reports which collections exist (empty ones included) and which
projects are in them, so you do not re-sort projects that are already grouped and do not create a
second collection with a name that is taken.

`group_projects` creates the collection when it does not exist yet and fills it in the same call.

**A project can sit in several collections at once.** Adding it to B does not take it out of A — the
user can group by version and by purpose side by side. To take it out of one collection, use
`ungroup_projects` naming that collection; without a collection it leaves all of them.

`delete_collection` dissolves the grouping only. Every project stays in the list. Deleting projects
is not something this tool does.

Collection colours, icons and descriptions are not exposed, because no screen renders them. If the
user asks for a coloured collection, say it cannot be done rather than pretending.

A project whose folder is no longer on disk shows up as such in `project_list`; say so instead of
reporting it as a normal project.

### Bringing library assets into a project

"把我素材库里那两把椅子放进工程" is a copy, not an import call:

```
search_assets(query: "chair")       → real_path for each hit
project_list(keyword: "MyGame")     → the project's folder
run_shell_command: cp "<real_path>" "<project folder>/models/"
```

Godot imports whatever lands inside the project folder — the editor does it on focus, and the next
`godot_check` / `godot_run` does it too. Pick a folder that matches the project's existing layout
(look with `list_local_dir` first) rather than inventing a new tree.

- Only Godot-usable formats belong in a Godot project (images, `wav` / `ogg` / `mp3`, `glb` /
  `gltf` / `obj` / `fbx`, `.tscn` / `.tres`). Leave out engine-private files from other engines and
  say which ones you skipped.
- When the asset is itself a Godot resource with a `.import` or `.uid` file beside it, copy those
  too.
- Without a shell (`run_shell_command` missing) you cannot copy binaries — give the user the
  `real_path` list and tell them to drag the files into Godot's FileSystem panel.
- Confirm afterwards: list the target folder, and if a scene now uses the asset, run
  `godot_check`. A copy that "succeeded" into the wrong folder is not done.

## The box itself

`box_status` reads the box in one call: connected editors, import tasks (including stuck ones
waiting for a decision), third-party MCP servers and whether they connect, skills and whether each is
on, knowledge bases, backups. Pass `sections` when you only need one part.

`box_sessions` reads the box assistant's own conversations — `list`, then `read` one. Use it when the
user refers to work done in the box ("盒子里刚才让它做的那个") or you are picking up where it stopped.
It shows what was said and which tools ran, not the result on disk: re-read the project files or
the library before you tell the user what was changed.

`box_manage` changes the box: `enable_skill` / `disable_skill`, `reconnect_mcp`, `remove_mcp_server`,
`resume_import` / `abandon_import`, `reimport_asset` / `reimport_folder`, `backup_database`. Take the
target from `box_status`, never guess it. `abandon_import` clears the server's staging area, so the
import can no longer be resumed; say so before doing it. Restoring or deleting backups and changing
the box's settings are not available — tell the user where to do it in the box.

## Pointing the user at a screen

There is no navigation tool. If the next step belongs in another part of the box — the asset
library, the knowledge base, AI creation — say so in words and name the screen. The user clicks it
themselves; you do not have a way to move them there.
