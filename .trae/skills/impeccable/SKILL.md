---
name: impeccable
description: Designs and iterates production-grade frontend interfaces. Invoke when improving UI/UX, visual hierarchy, accessibility, responsiveness, typography, color, motion, or when doing design critique/audit/polish.
---

# Impeccable

Designs and iterates production-grade frontend interfaces. Real working code, committed design choices, exceptional craft.

## Setup (non-optional)

Before any design work or file edits, pass these gates. Skipping them produces generic output that ignores the project.

| Gate | Required check | If fail |
|---|---|---|
| Context | The PRODUCT.md / DESIGN.md loader result is known from `node .agents/skills/impeccable/scripts/load-context.mjs`. | Run the loader before continuing. |
| Product | PRODUCT.md exists and is not empty or placeholder (`[TODO]` markers, <200 chars). | Run `$impeccable teach`, refresh context, then resume. Never synthesize PRODUCT.md from the user's original prompt alone. |
| Command | The matching command reference is loaded when a sub-command is used. | Load the reference before continuing. |
| Craft | `$impeccable craft` has a user-confirmed shape brief for this task. `teach` / PRODUCT.md never counts as shape. | Run `$impeccable shape` and wait for explicit brief confirmation. |
| Image | Required visual probes / mocks are generated or skipped with a reason. | Resolve the image-generation gate in `shape.md` or `craft.md` before code. |
| Mutation | All active gates above pass. | Do not edit project files yet. |

Codex-style agents must state this before editing files:

```text
IMPECCABLE_PREFLIGHT: context=pass product=pass command_reference=pass shape=pass|not_required image_gate=pass|skipped:<reason> mutation=open
```

For `$impeccable craft`, `shape=pass` is only valid after a separate user response approving the shape design brief, or when the user provided an already-confirmed brief in the request. Do not mark `shape=pass` after writing PRODUCT.md, summarizing assumptions, or drafting an unconfirmed brief yourself.

## Context gathering

Two files, case-insensitive. The loader looks at the project root by default and falls back to `.agents/context/` and `docs/` if the root is clean. Override with `IMPECCABLE_CONTEXT_DIR=path/to/dir` (absolute or relative to cwd).

- **PRODUCT.md**: required. Users, brand, tone, anti-references, strategic principles.
- **DESIGN.md**: optional, strongly recommended. Colors, typography, elevation, components.

Load both in one call:

```bash
node .agents/skills/impeccable/scripts/load-context.mjs
```

Consume the full JSON output. Never pipe through `head`, `tail`, `grep`, or `jq`. The output's `contextDir` field tells you where the files were resolved from.

## Shared design laws (high level)

- Pick a color strategy before picking colors (Restrained / Committed / Full palette / Drenched).
- Theme choice must be justified by a concrete usage scene, not category reflex.
- Typography needs clear hierarchy (avoid flat scales).
- Layout needs rhythm (avoid identical card grids and nested cards).
- Motion: avoid layout animations; use clean ease-out curves.

## Commands (menu)

Use `$impeccable` with these commands:

- `craft [feature]` / `shape [feature]` / `teach` / `document` / `extract [target]`
- `critique [target]` / `audit [target]` / `polish [target]`
- `bolder [target]` / `quieter [target]` / `distill [target]` / `harden [target]` / `onboard [target]`
- `animate [target]` / `colorize [target]` / `typeset [target]` / `layout [target]` / `delight [target]` / `overdrive [target]`
- `clarify [target]` / `adapt [target]` / `optimize [target]` / `live`

## Reference source

This workspace skill is based on the upstream Impeccable repository, cloned in this project under:

- `.codex-tools/impeccable`

