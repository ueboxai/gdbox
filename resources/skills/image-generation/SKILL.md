---
name: image-generation
description: Generates and edits raster assets with generate_image while preserving the user's exact requirements. Use when the user asks for 生图、改图、换背景、角色概念图、贴图、海报、UI 草图 or multiple image variants. Do not use for in-game sprites with animation frames or for tilesets in a Godot project (gen_sprite / gen_tileset make those, see godot-2d-character and godot-tilemap-level), for screenshots of the actual game, video, 3D mesh generation or edits to existing SVG/vector source.
---

# Image generation and editing

## Quick start

Use `generate_image` with the user's configured model. It accepts `prompt`, optional
`reference_images`, `count`, `aspect_ratio`, `size`, `seed`, `model` and `name`.
It returns images for inspection and saves outputs to the asset library under AIGC/图片.
Do not invent extra tool parameters, use a different provider without authorization, or
substitute a generated picture for actual engine output.

## Is this the right tool?

`generate_image` makes a picture and files it in the asset library. For assets that go straight
into a Godot game, the Godot generators are better and cheaper to get right:

| The user wants | Use | Why |
| --- | --- | --- |
| An animated character or object for the game | `gen_sprite` | Writes a transparent, frame-aligned sheet plus SpriteFrames into the project |
| Tiles for a level | `gen_tileset` | Writes a seamless atlas plus TileSet with collision |
| Concept art, key art, a poster, a UI mock, a background painting, a reference for 3D | `generate_image` | This skill |

Both Godot generators apply the project's art style automatically; `generate_image` does not, so
when a picture must match the game, pass the project's style reference images in
`reference_images` and repeat the style words.

## Decide the intent

- New image: describe the desired result. References may guide style, composition or subject.
- Edit: identify the target image and state exactly what changes and what stays unchanged.
- Inspect unseen local input images with an available image-viewing tool before generation.
  Use attachment or tool-returned absolute paths; never guess image contents from filenames.
  `read_local_file` shows you an image on disk.
- For each reference, explicitly label its role in the prompt using input order:
  “Image 1: edit target; Image 2: style only; Image 3: object to insert.”
- One prompt with `count` produces variants. Distinct assets require distinct prompts/calls.
  Keep the requested number of deliverables; do not create an unsolicited batch.

## Shape the prompt

If the user is specific, normalize their request without adding creative requirements.
If generic, add only useful framing, lighting or scene detail. Do not invent extra characters,
objects, brands, slogans, palettes or story beats. Do not choose arbitrary left/right placement
unless the requested layout calls for it. Chinese and English are both valid.

Use only the useful lines of this scaffold; it is prompt text, not additional tool arguments:

```text
Asset use: where this image will be used
Primary request: the user's objective
Input images: numbered roles, if present
Scene and subject: environment, identity, exact subject counts and actions
Style/medium: photo, illustration, pixel art, etc.
Composition: viewpoint, framing, placement and useful empty space
Lighting/materials: relevant light, mood and surface detail
Text (verbatim): "exact requested text", typography and placement
Change only: the requested edit
Keep unchanged: relevant identity, pose, layout, palette or object details
Avoid: unwanted elements and explicit prohibitions
```

Keep prompts concise. Preserve user-supplied text verbatim, including language and spelling;
do not translate visible lettering when translating the rest of the prompt. Specify counts
explicitly. For edits, repeat invariants every iteration and describe one targeted change.
For transparent assets, request actual transparency; a drawn checkerboard is not transparency.
Do not promise alpha or exact dimensions merely because the prompt requested them.

## Examples

**New asset:** “Game character concept. Exactly one adventurer cook and exactly three friendly
monsters at a fantasy campsite. Chibi illustration, wide composition. No text, logos or UI.”
Use these subject/count/style choices only when requested; examples are not defaults.

**Background edit:** “Image 1 is the edit target. Replace only the background with a warm
sunset sky. Keep the person's face, hair, clothing, pose and framing unchanged. Add no objects.”

**Style reference:** “Image 1 is the character to preserve. Image 2 provides brushwork only.
Apply that brushwork to Image 1; retain its identity, outfit, pose, palette and composition.
Do not copy subjects or lettering from Image 2.”

## Inspect and deliver

1. Inspect the returned image against subject/identity, counts, composition, exact text,
   style, invariants and avoid items. Tool success alone does not establish correctness.
2. Distinguish objective mismatches from taste. Describe the actual mismatch plainly.
   Only judge images actually viewed; beyond the returned previews, inspect saved files.
3. Every generation spends the user's API credits. Default to one image unless more are
   requested. Use `ask_user` before an unapproved paid retry; an explicit redo request or
   previously authorized iteration budget does not require repeated approval.
4. For authorized edits, reuse the approved output as the edit target and repeat invariants.
   A fixed seed cannot guarantee identity or composition. The current OpenAI/GPT and Gemini
   integrations do not send seed; only SiliconFlow and Ark integrations forward it.
5. Show the result and saved path, actual model and final prompt. An image meant for a Godot
   project goes in by copying the saved file into the project folder (`run_shell_command`, `cp`)
   — Godot imports it on its own. Do not overwrite the original unless replacement was
   requested. Pixel-art images need the project's nearest-neighbour texture filter, or they
   render blurry.
6. Report save failures and unverified requirements honestly. Verify alpha and dimensions
   from the file with available inspection tools when those properties are required.

## Failure handling

Missing model configuration: relay the tool's setup guidance. Do not guess a model.
Invalid reference path: recover the real path from attachments or prior tool output.
Unsupported multiple references: do not silently drop or merge images; explain the limitation
and ask the user to choose a supported integration or explicitly select a single image.
Reference/edit request failure: do not automatically remove references and spend on a different
task to diagnose it. Report the actual error; a text-only success does not prove why editing failed.
Ask only when a missing detail blocks execution, otherwise proceed within the user's request.
