# From a document or a description to a spec

The user either hands over a file or describes the form they want. Only this first stretch differs; from
"What the spec looks like" on, the two are the same job.

## Getting the rows out (from a document)

```bash
node scripts/read-sheet.mjs form.xlsx            # every sheet, as JSON rows
node scripts/read-sheet.mjs form.xlsx --sheet 2  # one sheet, by 1-based position or by name
node scripts/read-sheet.mjs form.csv --objects   # first row becomes the keys
```

Without Node, the same three forms as a Python subcommand — identical output:

```bash
python3 scripts/template_tool.py read form.xlsx --sheet 2 --objects
```

Both handle `.xlsx`, `.csv` and `.tsv` with nothing installed (they unzip the workbook and read the sheet
XML themselves). Dates come back as Excel serial numbers — irrelevant for a form definition, but don't
mistake one for a field value.

For `.pdf` and `.docx`, use the `pdf` / `docx` skills. For an image or a screenshot of a paper form, read it
directly. Everything downstream is the same: you are producing a spec.

## Working from a description

Sometimes there is no file — the user just says what they want:

> Set up a maintenance request form. Resident's name and unit, what's broken, how urgent, a photo, and
> whether we can enter when they're out. New, Assigned, Scheduled, Done.

That is enough to build from. The rules below are the same ones you would apply to a spreadsheet; the
difference is that **nothing is written down, so your reading of it has to be confirmed rather than
checked.**

**Take each item at face value and give it a type** using the wording rules in "Inferring the type" below —
"name" and "unit" are `SHORT_TEXT`, "what's broken" is `LONG_TEXT`, "how urgent" is a `SINGLE_SELECT`
(propose the options), "a photo" is `IMAGE_UPLOAD`, a yes/no permission is a `CHECKBOX` if it reads as
consent and a `SINGLE_SELECT` if it reads as a question.

**Then, before building, play back the whole form in a compact list** — every field, its type, whether it is
required, and the statuses in order — and ask for corrections. One list, not a series of questions. The user
described a form in a sentence; they have not seen what you made of it, and a wrong answer type is far
cheaper to fix here than after the import.

**Ask about what a form of this kind plainly needs and they did not mention** — most often: the statuses, if
they stopped at the fields; which field should identify the request in the admin list (`summary: true`);
whether anything is mandatory. Ask; do not add fields of your own to round the form out. A form with seven
fields they named beats one with twelve where five are yours.

**Fill in the mechanical parts without asking**: `description` for the template and every status, status
colors, `type` buckets (`UNACTIONED` / `ACTIONED` / `COMPLETED`), sensible `min`/`max` on numbers. These
have to be non-empty and the user has no opinion about them. Mention that you chose them; don't negotiate
them.

If the description is too thin to act on — "a form for pets" — ask what it should collect rather than
inventing a pet form. One round of questions, then build.

## What the spec looks like

`examples/input-spec.example.json` shows every construct. The shape:

```jsonc
{
  "title": "Pet application",
  "description": "Apply to keep a pet in your lot",
  "fields": [
    { "type": "section",  "title": "Owner details" },
    { "type": "text",     "title": "Full name", "required": true, "summary": true },
    { "type": "select",   "title": "Pet type", "options": ["Dog", "Cat"], "required": true },
    { "type": "number",   "title": "Pet age (years)", "min": 0, "max": 30 },
    { "type": "date",     "title": "Date acquired" },
    { "type": "file",     "title": "Vaccination certificate", "required": true },
    { "type": "checkbox", "title": "I agree to the by-laws", "required": true },
    { "type": "note",     "title": "Before you start", "text": "Approval takes 10 business days." }
  ],
  "workflows": [
    { "name": "New", "type": "UNACTIONED", "description": "Application received", "color": "#79909C" },
    { "name": "Approved", "type": "COMPLETED", "description": "Pet approved", "color": "#66BB6A" }
  ],
  "options": { "isSharableOnApp": true }
}
```

Per-field keys: `type`, `title`, `description`, `required`, `hidden` (→ `isHidedFromSiteRequest`),
`summary` (short text only), `options` (selects — strings, or `{ "title": … }`), `min`/`max` (number),
`text` or `richText` (instruction). `workflows` and `options` may be omitted; everything else is required.

## Type aliases

The builder accepts the enum names and these aliases, case- and separator-insensitive:

| Spec word | Item type |
| --- | --- |
| `text`, `short`, `short_text`, `name`, `line` | `SHORT_TEXT` |
| `paragraph`, `long`, `long_text`, `textarea`, `comments`, `details` | `LONG_TEXT` |
| `number`, `numeric`, `qty`, `quantity`, `amount` | `NUMBER` |
| `image`, `photo`, `picture`, `image_upload` | `IMAGE_UPLOAD` |
| `file`, `attachment`, `upload`, `document`, `file_attachment` | `FILE_ATTACHMENT` |
| `select`, `dropdown`, `single_select`, `radio`, `choice`, `list`, `yes_no` | `SINGLE_SELECT` |
| `multi`, `multi_select`, `multiselect`, `checkboxes`, `tick_all` | `MULTI_SELECT` |
| `checkbox`, `consent`, `agree`, `acknowledgement`, `declaration`, `tick` | `CHECKBOX` |
| `date`, `day`, `datepicker` | `DATE` |
| `section`, `heading`, `section_heading`, `header`, `group` | `SECTION_HEADING` |
| `note`, `instruction`, `info`, `notice`, `richtext`, `statement` | `INSTRUCTION` |

## Inferring the type when nothing says

Most customer spreadsheets carry a question column and not much else, and a spoken description carries less
again. In order of reliability:

1. **An explicit type** — a type column, or the user naming one ("a dropdown for urgency"). Map it through
   the table above, and ask about anything that doesn't map.
2. **A listed answer set** — options in their own column, `Dog / Cat / Bird` in one cell, or read out in the
   description: `SINGLE_SELECT`, or `MULTI_SELECT` for "tick all that apply". A bare `Yes / No` pair is a
   `SINGLE_SELECT` with those two options; a single "I agree…" line with one tick box is a `CHECKBOX`.
3. **The wording of the question** — "Date of …" / "When …" → `DATE`; "How many" / "$" / "years" → `NUMBER`
   with sensible bounds; "Attach" / "Upload" / "Copy of …" → `FILE_ATTACHMENT` (`IMAGE_UPLOAD` only when it
   asks specifically for a photo); "Describe" / "Reason" / "Details" → `LONG_TEXT`; anything else → `SHORT_TEXT`.
4. **Entries that are not questions** — a bold, merged or numbered row with no answer space is a `section`,
   as is a description that groups items ("then the pet's details: …"); a paragraph of rules or instructions
   is a `note`.

Required-ness comes from a `Required`/`Mandatory` column (`yes`/`y`/`true`/`x`/`✓`), from a `*` on the
label, or from the user saying so. When nothing says, leave it optional and tell the user.

Set `summary: true` on the one short-text field that best identifies a request in a list (a name, an
address, a unit number) — at most one item may carry it, and the builder rejects a second.

## Statuses

Neither spreadsheets nor spoken descriptions usually define them. Ask. If the user has no preference, the builder's default is the console's
own blank-template set — New → In Progress → In Review → Complete / Declined — and you should say that is
what you used. Remember the **first entry is the status new submissions open in**.

## Before handing over

- `node scripts/validate-template.mjs out.json` (or `python3 scripts/template_tool.py validate out.json`) must pass.
- Skim the field order against the source: the builder preserves spec order, so a mis-ordered spec produces
  a mis-ordered form, and nothing downstream will complain. From a description, the order the user said
  things in is the order they expect.
- Say what you inferred rather than read — types, required flags and statuses are the three the user will
  want to check. Working from a description, everything is inferred, so the playback above is that step.
