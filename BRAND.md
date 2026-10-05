# The g-cauc board: brand

The board (`/board`) is dense product UI inside the Claude Code pane. On the Desktop app, it draws small SVGs. In a terminal, it draws colored text. It uses the theme of the host, so it draws no backgrounds of its own. `hooks/draw.js` holds every value in this file. No other file has a raw color.

## Color

There are two types of color, and each type has one job.

**Status colors** show the state of a thing. They are mid tones, so they show on light and dark themes.

| Token | Hex | Terminal | Use |
|---|---|---|---|
| `good` | `#22A06B` | green | passed, ready, on |
| `warn` | `#E0A21A` | yellow | waiting, running, behind main |
| `bad` | `#E5484D` | red | failed, stuck, needs Garrett |
| `muted` | `#8A8F98` | gray | off, skipped, labels in an SVG |
| track | `rgba(127,127,127,0.24)` | dim text | the empty part of a bar, a ring or a cell |

**Project colors** show which project a thing belongs to. Each project uses the accent from its own `BRAND.md`, and the `Color` column of `projects.md` holds it. If a project has no color, the board uses the next color from a fallback list.

| Project | Hex | Source |
|---|---|---|
| CallFlow | `#017272` | `--primary`, `oklch(0.50 0.085 195)`, deep pool teal |
| Bison Brain | `#F48327` | `--brand-accent`, orange |
| g-cauc | `#5B5BD6` | this file: iris |

Rules for project colors:

- A project color shows only on that project's badge, phase ring, pipeline nodes, slots and lane cells.
- A project color never shows a status, and it is never the color of a line of text.
- Each page has one project color at most, except the All page and the Fleet page. On those two pages, the project colors identify the projects.
- Text on a filled shape is white or `#111111`, whichever has the higher contrast.

## Type

The SVGs use the system UI font. A badge or a pill uses 11px at weight 600. A pipeline label uses 10px at weight 500. Plain text uses the host font. A section heading is short uppercase dim text. Thus the board uses 2 weights.

## Shape and space

- A square cell is 14px with a 4px radius. A pill and a ring are round.
- A card has no border. Its badge shows the project. The Desktop app showed no pane after version 0.6.0 added borders, percent widths and wrapping (2026-10-05). The board before 0.6.0 used none of them.
- Rows in a section have no gap. Sections have one empty row between them.

## Motion

None. The board draws again when its data changes.
