---
name: build-workflow
description: Turn a spreadsheet, CSV, PDF or document that describes a request form into the JSON file the admin console's "Import template" button accepts — form fields plus workflow statuses. Use when someone hands over a form definition (questions, answer types, statuses) in Excel/CSV/Word/PDF and wants it as a Resvu workflow template, or when hand-authoring, repairing or validating a template export JSON.
---

# Workflow template import files

The admin console imports request-form templates from JSON: **Workflow → Templates → Import template**.
The same shape falls out of the per-template **Export** action, so a generated file has to look like an
export.

A template carries two halves:

- **items** — the fields a requestor fills in (short text, select, date, upload …).
- **workflows** — the statuses a request moves through. At least one is required, and the **first element of
  the array is the status every new submission starts in**.

## Pick a runtime first

The scripts ship twice, with identical rules and identical messages. Check what exists before step 1:

| If | Use |
| --- | --- |
| `node` is on PATH | `node scripts/<name>.mjs …` |
| only `python3` is | `python3 scripts/template_tool.py <read\|build\|validate> …` |
| neither is | the fallback at the bottom of this file |

Neither needs anything installed — no `pnpm install`, no `pip install`. Both read `.xlsx` by unzipping the
workbook themselves. **They must stay in step**: a rule changed in one belongs in the other, and
`references/json-contract.md` is the source both follow.

Probe for a runtime by asking for a version and reading the output — `node -v`, then
`python3 -c "print(1)"` — rather than trusting an exit code. Claude Code running is no evidence either way:
the native install is a self-contained binary that exposes no interpreter on PATH, so `node` is there only
if someone installed it.

**On Windows, expect neither.** A stock Windows 10/11 ships PowerShell (5.1) and `cmd`, no Node and no real
Python — and `python3.exe` exists as a Microsoft Store stub, so a bare `python3` probe can appear to work
while running nothing. The realistic routes are WSL, Git Bash with Node installed, or
`winget install OpenJS.NodeJS.LTS`; failing those, use the hand-authoring fallback at the bottom of this
file rather than a third implementation.

## Workflow

1. **Read the source.** `node scripts/read-sheet.mjs <file>` — or `python3 scripts/template_tool.py read
   <file>` — prints the rows of an `.xlsx`, `.csv` or `.tsv` as JSON. For `.pdf` / `.docx`, use the `pdf` /
   `docx` skills or read the text out directly.
2. **Write a spec** — the compact intermediate JSON in `examples/input-spec.example.json`. This is where the
   judgement lives: which column holds the question, what answer type it implies, which rows are section
   headings rather than fields. `references/source-mapping.md` covers the column vocabulary, the
   type-inference rules and the layouts that show up in real customer forms.
3. **Build** — `node scripts/build-template.mjs spec.json -o "<Title>.json"`, or `python3
   scripts/template_tool.py build spec.json -o "<Title>.json"`. It mints the ids, assigns contiguous
   indexes, and fills every default the importer and the API expect.
4. **Validate** — `node scripts/validate-template.mjs "<Title>.json"`, or `python3
   scripts/template_tool.py validate "<Title>.json"`. It re-implements all four gates the file has to pass:
   the import schema, `Form` validation, `FormVersion` validation, and the one-summary-column rule. Do not
   hand over a file that has not passed this.
5. **Hand it over.** The user imports it at Workflow → Templates → Import template and picks the target
   communities there. The file deliberately carries no community, payment account or notification admin —
   the importer forces those off (see "What the importer throws away" below).

Ask the user before guessing at anything the source does not state — above all the **statuses**, since most
customer spreadsheets describe only the fields. `build-template.mjs` will fall back to the console's default
five-status set if `workflows` is omitted, but say so explicitly rather than letting it pass silently.

## The traps that actually bite

- **Empty strings are not "present".** `''`, `null`, `undefined` and `[]` all count as missing. The import
  schema happily accepts `description: ""`, then the create is rejected with `Description is required`. Template `title` and `description`, and every workflow's `name`,
  `description` and `color`, must be non-empty.
- **Indexes are range-checked.** Each item's `index` must be in `0 … items.length - 1`, and each select
  option's `index` in `0 … options.length - 1`. Keep them contiguous and 0-based.
- **At most one `SHORT_TEXT` may set `showAsSummary: true`** — `createForm` throws
  `Only one Display in "Summary" column is allowed.` otherwise.
- **`__typename` values are not the enum names.** `NUMBER` → `Number`, `DATE` → `DateItem`,
  `FILE_ATTACHMENT` → `FileUpload`, `CHECKBOX` → `CheckBox`. The build script gets this right; hand edits
  usually don't. `__typename` is optional (the API stores `items`/`workflows` as opaque JSON), but real
  exports carry it, so the build script emits it.
- **`CHECKBOX` validators use `isRequiredTrue`**, not `isRequired`.
- **`INSTRUCTION.richText` is a Quill delta** — `{ "ops": [{ "insert": "…\n" }] }` — and `ops` must be
  non-empty.
- **Only `SINGLE_SELECT` and `MULTI_SELECT` take `options`**, and the list must be non-empty.
- **`SECTION_HEADING` has no validators** and no `isHidedFromSiteRequest`.
- **Blob ids don't travel.** `mainImages` and `attachments` must exist as arrays; leave them `[]` unless you
  hold Blob ids that belong to the importing account — ids copied from another account's export won't resolve.

## What the importer throws away

The importer strips `id`, `orderNum`, `sites`, `groups`, `paymentAccount`,
`newSubmissionNotificationAdmins`, `isPublic`, and forces `isPaymentRequired` and all four notification
booleans to `false`. Fresh UUIDs are minted for every item, option and workflow. So don't spend effort on
those fields — but do keep the keys the import schema requires, listed in `references/json-contract.md`.

## Reference

- `references/json-contract.md` — the exact shape of every item type, the workflow shape, the top-level
  fields, and which gate enforces each validation rule.
- `references/source-mapping.md` — reading the source file and mapping it onto the spec.
- `examples/input-spec.example.json` — a spec covering every item type. **This is build input, not an
  importable file**; the admin console rejects it with "Invalid import file".
- `examples/importable-template.example.json` — what that spec builds into: a file that does import, handy
  for checking the feature end to end.
- `scripts/read-sheet.mjs`, `scripts/build-template.mjs`, `scripts/validate-template.mjs` — Node.
- `scripts/template_tool.py` — the same three as `read` / `build` / `validate` subcommands, stdlib only.

## When there is no runtime at all

Neither `node` nor `python3`: build the file by hand from `references/json-contract.md`, which carries the
whole contract including a worked example of every item type. Then walk this checklist explicitly — it is
what the validator would have done, and the failures it catches are invisible until the import is attempted:

1. `title` and `description` non-empty; every workflow's `name`, `description` and `color` non-empty.
2. At least one workflow; every `type` is `UNACTIONED`, `ACTIONED` or `COMPLETED`; `workflows[0]` is the
   status you want new submissions to open in.
3. Item `index` values run `0 … items.length - 1` with no gaps or repeats; the same within each `options`
   list.
4. Each item's `__typename` matches its type in the table in `json-contract.md` — `Number`, `DateItem`,
   `FileUpload`, `CheckBox` are the four that catch people out. (Or omit `__typename` entirely; it is
   optional.)
5. `CHECKBOX` uses `isRequiredTrue`; every other type with validators uses `isRequired`; `NUMBER` also needs
   `minNumber` and `maxNumber`.
6. Selects have non-empty `options`; `INSTRUCTION` has a non-empty `richText.ops`; at most one `SHORT_TEXT`
   sets `showAsSummary`.
7. `mainImages` and `attachments` are present as arrays — `[]` unless you hold Blob ids for that account.

**Say plainly in the hand-over that the file was not machine-checked**, and that the first import attempt is
the real test. A rejected import is not destructive: nothing is created until the file passes.
