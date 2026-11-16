import { z } from 'zod'

const pointerTarget = z
  .union([z.array(z.number()).length(2), z.string().min(1)])
  .describe('[x, y] in project-resolution pixels, or a node path (clicks its on-screen position)')

/** godot_run 和回放用例共用的输入：动作、按键、点击、拖拽四选一 */
export const runInputSchema = z
  .object({
    action: z.string().optional().describe('InputMap action name'),
    key: z.string().optional().describe('Key name, e.g. "Space", "A", "Escape", "Left", "Enter"'),
    click: pointerTarget.optional(),
    drag: z.object({ from: pointerTarget, to: pointerTarget }).optional(),
    button: z.enum(['left', 'right', 'middle']).optional().describe('For click/drag. Default left'),
    at: z.number().min(0).describe('Seconds from start'),
    hold: z
      .number()
      .min(0.016)
      .optional()
      .describe('Seconds held (for drag: the drag duration). Default 0.1, drag 0.3')
  })
  .refine(
    (i) => [i.action, i.key, i.click, i.drag].filter((x) => x !== undefined).length === 1,
    'Each input needs exactly one of action, key, click, drag'
  )
