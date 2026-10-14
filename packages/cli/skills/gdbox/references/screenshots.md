# Screenshots: what the image can and cannot tell you

## Contents

- [Delivery: the file, not the call](#delivery-the-file-not-the-call)
- [What gets captured](#what-gets-captured)
- [When the frame is not what you expected](#when-the-frame-is-not-what-you-expected)
- [Overwriting](#overwriting)

## Delivery: the file, not the call

`gdbox screenshot --output <path.png>` is finished only when a valid PNG exists at that
path. The command checks the bytes itself — non-empty, really a PNG, and matching
dimensions when GDBox reports them — before it reports success. Verification failure
always exits non-zero.

So a zero exit code means the file is there. Read it from `artifacts[0].path`, which is an
absolute path. Image bytes are never printed.

The delivered file is the original frame. If GDBox only returns a compressed preview, the
command fails with exit 8 (`OUTPUT_INVALID`) rather than saving the preview under a `.png`
name — upgrade GDBox in that case.

`--output` is required and only accepts `.png`. Relative paths resolve against the current
directory. Missing parent directories are created.

## What gets captured

The command runs `godot_screenshot`: an off-screen Godot window runs the project for
`--frames` frames at 60 fps (default 30) and the last frame is kept.

- `--scene res://...` captures that scene instead of the main scene; `data.scene` echoes
  it (`null` means the main scene).
- It is a fresh run of the game, **not** a picture of the user's editor or of a game they
  have running. State they built up by playing is not there.
- No input is sent. To see a state that needs input (after a jump, after a menu click),
  use `godot_run` with `inputs` and `screenshots` through `gdbox tools call`.

## When the frame is not what you expected

- An early frame may still show a loading state or an animation mid-way. Increase
  `--frames` before concluding something is missing.
- Newly added textures are imported before the run; if an image still shows only
  code-drawn UI, run `godot_check` and read its errors.
- An object missing from the frame may simply be outside the camera. Check the scene with
  `editor_scene_tree` or the `.tscn` file before telling the user it is gone.

## Overwriting

An existing target file is never replaced silently: without `--overwrite` the command
stops with exit code 2 (`OUTPUT_EXISTS`) before contacting GDBox at all, so nothing is
run and nothing is lost.

With `--overwrite`, the new image is written to a temporary file in the same directory and
renamed into place. If anything fails along the way the original file is left untouched.
