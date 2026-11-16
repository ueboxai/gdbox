---
name: asset-library
description: Search and curate the box's own asset library — find assets the user has collected, read and write their notes and tags, move assets between library folders, create rename and delete those folders, and delete or restore library entries such as duplicate registrations. Use when the user asks what is in their library, wants to find a model or texture they own, wants assets organised, or says things like "帮我把重复的清理了"、"把这几个素材归到一个文件夹"、"删错了恢复一下". Do not use for files already inside a Godot project or loose files on disk, and not for generating new art or audio.
---

# The box's asset library

Verified against a live library. This is the user's **curated collection** — assets they gathered,
tagged and annotated. It is a different thing from the two other places assets live:

| Where | Tool |
|---|---|
| The box's library (tagged, annotated) | `search_assets` — this skill |
| Inside the Godot project (`res://...`) | `find_local_files` / `grep_local_files` on the project folder |
| Loose files on disk | `find_local_files` |

Picking the wrong one is the most common failure here. "我素材库里有没有…" is this library.
"这个工程里有没有…" is the project.

## Asset names are English

Asset files are named `chair_wood.glb`, `wood_floor.png`, `hero_idle.png`, and the user asks in
Chinese. Searching 椅子 finds nothing that `chair` would have found.

You do not have to translate up front and you should not guess. When a Chinese keyword returns
zero, `search_assets` re-runs the search without the keyword and hands back `library_sample` —
real assets from the library, with `dropped_query` naming what it removed. Pick the English word
off that sample; it beats guessing, and a miss tells you almost nothing on its own.

Tags are the exception. Chinese tags the user (or you) applied **are** searchable in Chinese, so
after tagging, `家具` finds the chair that `椅子` could not.

## Browsing

Call `search_assets` with no arguments to list the whole library. That is the right first move for
"我素材库里有什么" and for getting your bearings before organising anything.

## Filtering

Filter at the source instead of paging the whole library and sorting it out yourself:

| Ask | Argument |
|---|---|
| "Trees 文件夹里有什么" | `folder: "Trees"` — name, `/full/path`, or `folderKey`; subfolders included unless `includeSubfolders: false` |
| "带'角色'标签的" | `tags: ["角色"]`, plus `tagsMatch: "all"` when every tag must be present |
| "除了废弃的" | `excludeTags: ["废弃"]` |
| "我收藏的" | `favorite: true` |
| "最近改过的" | `changedAfter: "2026-08-01"` / `changedBefore` |
| "回收站里有什么" | `deleted: true` (paging only — no other filter works with it) |

Two failure modes worth knowing:

- A **folder name that matches more than one folder is an error**, not a guess. The error lists the
  candidates with their full paths; ask the user which one rather than picking.
- A **tag name that does not exist is an error** too. Without that, an empty filter would come back
  as the entire library and you would report all of it as "assets with that tag".

`changedAfter` / `changedBefore` read the **last-modified** time, which annotating an asset also
refreshes. It is not an "imported on" date — do not present it as one.

## Picking assets to bring into a Godot project

Bringing a library asset into a Godot project means **copying its file into the project folder**;
Godot imports whatever lands there. There is no import tool to call.

```
search_assets(query: "chair", fileFormat: "模型")   → real_path of each hit
run_shell_command: cp "<real_path>" "D:/Games/MyGame/models/"
```

Check three things while you are still choosing, not after half the batch is copied:

- **Is it usable in Godot at all?** Godot takes `png` / `jpg` / `webp` / `svg`, `wav` / `ogg` /
  `mp3`, `glb` / `gltf` (preferred for 3D), `obj`, and `fbx`. Libraries collected for other engines
  also hold `.uasset` and similar engine-private files — those cannot be used, so filter them out
  with `fileFormat` instead of offering them.
- **Godot version, for Godot resources.** A `.tscn` / `.tres` saved by a newer Godot may not open
  in an older one. Results carry `engineVersion` when the library recorded it, and
  `search_assets` takes it as a filter (`engineVersion: ["4.3", "4.4"]`). Plain media files have no
  version limit.
- **Which vault they live in.** Search reads across vaults; `real_path` is readable either way, but
  writes to the library (tags, notes, moves) only work in the **active** vault. If you need to
  write and the asset lives elsewhere, `switch_vault` asks the user to confirm the switch.

A Godot resource copied from the library may come with a `.import` or `.uid` sidecar next to it —
copy those along. After copying, check that the file shows up where you put it and, if a scene uses
it, run `godot_check` once.

## Filtering by kind

- `assetType` takes Godot resource type names: `PackedScene`, `Texture2D`, `GDScript`, `Shader`,
  `AudioStreamWAV`, `Model3D`.
- `fileFormat` takes extensions (`glb`, `png`, `wav`) or Chinese aliases (`模型`, `贴图`, `材质`).

An alias matches on **either** the file extension or the asset type, because the same kind of
thing can be stored as a raw file or as a saved Godot resource.

**Check `relaxed` in the result.** When nothing matches the type you asked for, the search widens
and returns other assets instead. `relaxed: true` means *what came back is not the type you asked
for* — say that to the user rather than presenting the list as matches.

## Notes and tags round-trip

Search results carry `note` and `tags` when the asset has them. Read them before writing:

`annotate_asset` writes both. Its two halves behave differently:

- `note` **overwrites**. If the asset already has a note, you are about to destroy what the user
  wrote unless you incorporate it.
- `tagNames` adds; re-adding an existing tag is pointless noise. Unknown tag names are created.

One call can do both — pass `note` and `tagNames` together rather than making two round-trips.

It also writes a batch: `assetKeys` for a list, or `folder` for a whole library folder
(subfolders included unless `includeSubfolders: false`). Tagging a 300-asset pack is one call, not
300 — and one approval instead of 300. Above 200 assets, `folder_selection.hasMore` comes back
with `nextFolderOffset`; pass it as `folderOffset` to continue. Remember `note` overwrites *every*
asset in the batch.

`hasNoTags: true` finds everything unlabelled — the natural starting point for "帮我把素材库整理
一下". Propose a tag scheme from what you find and get agreement before applying it in bulk; a
library retagged to someone else's scheme is worse than an untagged one.

**Read `list_tags` before you write tags.** Unknown tag names are created silently and land
outside the user's tag groups, so guessing produces 树 / 树木 / Tree as three separate tags and
quietly shreds their scheme. `list_tags` shows what exists, which group each tag belongs to, and
how many assets carry it — high counts are the real categories, ones and twos are usually strays
worth merging. It is also where the exact spelling for `search_assets`'s `tags` filter comes from.

**Tags are editable, so the mess is fixable.** `manage_tags` renames one (`newName`, associations
survive — every asset keeps the tag), recolours it, or marks it a favourite. `delete_tags` takes
them out: with `mergeInto` it moves the assets onto the target tag first, which is how 树 / 树木 /
Tree become one tag without any asset losing a label; without it the tag is simply gone and the
assets are one label poorer.

There is **no recycle bin for tags** — a deleted tag does not come back. Read out the list and
each tag's asset count from `list_tags` and get agreement before deleting or merging.

`assetKey` is how every write identifies its target, and it only comes from a search result. There
is no way to guess it.

## Organising: folders and moving

`create_folders` makes the folder, `move_assets` puts things in it. Neither touches the disk —
library folders are a classification, not directories, and the files stay where they are.

`move_assets` takes a `targetFolder` (name, full path, or `folderKey`) plus either `assetKeys` or
`sourceFolder`. Assets already in the target come back as `already_there`, which is not a failure.
A tidy-up is usually one `search_assets` per group, then one `move_assets` per group — not one
call per asset.

`sourceFolder` empties one folder into another without you listing its contents first. It moves
**only that folder's own assets**; `includeSubfolders: true` sweeps the whole subtree, which
flattens it into the target — say that out loud before doing it. Above 200 assets it moves the
first batch and sets `source_folder.hasMore`; call again with the *same* arguments to continue
(what moved is no longer in the source, so there is no offset to pass).

Say what you are about to reorganise before you do it. "把素材库整理一下" is not agreement to a
particular scheme; a library rearranged into someone else's scheme is worse than a messy one.

## Deleting

`delete_assets` takes `assetKeys` and moves those entries to the library's recycle bin. It is a
soft delete: the user can restore them in the UI, and **nothing on disk is touched**. Every call
asks the user for approval, so batch the keys instead of calling it once per asset.

Read the result rather than assuming it worked. Each key comes back with its own `status`:
`deleted`, `not_found`, `denied`, `failed`, or `unconfirmed` — the last one means the delete ran
but the record was still there on read-back, which is not a success and must be said out loud.

Names repeat in a library. Before deleting more than one thing, list what you are about to remove
(name, path, `assetKey`) and get agreement — `assetKey` is the only thing that distinguishes two
assets called `tree.glb`.

### Undoing a delete

`restore_assets` takes the same `assetKeys` back out of the recycle bin. `delete_assets` returns
every key it removed, so when a delete turns out to be wrong — a name collision, the user changes
their mind — restore it yourself instead of telling them to go dig through the UI.

`search_assets` with `deleted: true` lists what is in the recycle bin when you no longer have the
keys.

### Duplicate registrations

The same folder imported twice leaves two rows for one file: same path, same size, two
`assetKey`s. Spot them by listing the library (`search_assets` with no keyword, paging with
`nextOffset`) and grouping on `path` + `size`. Keep one key per group and delete the rest.

Duplicates share the file they point at, so `delete_assets` may return `shared_file_warnings`.
That means the surviving row uses the same file as the one you just removed: leaving the deleted
entries in the recycle bin is fine, but **emptying the recycle bin would delete that file** and
leave the survivor pointing at nothing. Pass that on to the user.

## Folders

`create_folders` makes folders **inside the library** — database records, not directories on disk.
`parentFolderKey: "ALL"` puts them at the root, and children nest in one call. Nothing moves on
the user's filesystem; use `move_assets` to put assets into them.

`rename_folder` fixes a name, `delete_folders` removes one. Deleting a folder is not just the
folder: **its subfolders and every asset inside go to the recycle bin with it**. The result says
how many assets that was — tell the user that number, not just "folder deleted".

`restore_folders` is the undo for it, and it restores the whole tree — the folder, its subfolders
and the assets that went down with them. Call it with no arguments to list what is in the folder
recycle bin (that is read-only), then pass `folders` with a name, full path or `folderKey`. Use
this rather than `restore_assets` after a folder delete: restoring the assets alone brings them
back without the structure they lived in.

On a **network vault** both refuse and say so: renaming and deleting there also have to move real
directories on the share, which these tools cannot do. Half of that operation would leave the
library and the disk disagreeing, so the user does it in the UI instead.
