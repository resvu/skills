# Reading the source and writing the spec

## Getting the rows out

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

## Inferring the type when the sheet doesn't say

Most customer spreadsheets carry a question column and not much else. In order of reliability:

1. **An explicit type column** — map it through the table above, and ask about anything that doesn't map.
2. **A listed answer set** — options in their own column, or `Dog / Cat / Bird` in one cell: `SINGLE_SELECT`,
   or `MULTI_SELECT` if the sheet says "tick all that apply". A bare `Yes / No` pair is a `SINGLE_SELECT`
   with those two options; a single "I agree…" line with one tick box is a `CHECKBOX`.
3. **The wording of the question** — "Date of …" / "When …" → `DATE`; "How many" / "$" / "years" → `NUMBER`
   with sensible bounds; "Attach" / "Upload" / "Copy of …" → `FILE_ATTACHMENT` (`IMAGE_UPLOAD` only when it
   asks specifically for a photo); "Describe" / "Reason" / "Details" → `LONG_TEXT`; anything else → `SHORT_TEXT`.
4. **Rows that are not questions** — a bold, merged or numbered row with no answer space is a `section`;
   a paragraph of rules or instructions is a `note`.

Required-ness comes from a `Required`/`Mandatory` column (`yes`/`y`/`true`/`x`/`✓`), or from a `*` on the
label. When nothing says, leave it optional and tell the user.

Set `summary: true` on the one short-text field that best identifies a request in a list (a name, an
address, a unit number) — at most one item may carry it, and the builder rejects a second.

## Statuses

Spreadsheets rarely define them. Ask. If the user has no preference, the builder's default is the console's
own blank-template set — New → In Progress → In Review → Complete / Declined — and you should say that is
what you used. Remember the **first entry is the status new submissions open in**.

## Before handing over

- `node scripts/validate-template.mjs out.json` (or `python3 scripts/template_tool.py validate out.json`) must pass.
- Skim the field order against the source: the builder preserves spec order, so a mis-ordered spec produces
  a mis-ordered form, and nothing downstream will complain.
- Say what you inferred rather than read — types, required flags and statuses are the three the user will
  want to check.
