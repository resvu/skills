# The import JSON contract

Three gates decide whether a file imports. All three must pass.

| Gate | Where it runs | What it checks |
| --- | --- | --- |
| Import schema | Admin console, on picking the file | Top-level keys and their primitive types; `workflows` non-empty |
| `Form` validation | API, on create | Title/description present, popup and auto-close pairings |
| `FormVersion` validation | API, on create | Per-item required fields, index ranges, option shape |

Plus one rule applied when the form is created: at most one `SHORT_TEXT` item with `showAsSummary: true`.

The API's notion of "present" is stricter than the import schema's: **`''`, `null`, `undefined` and `[]`
all count as missing**; `false` and `0` count as present.

## Top level

```jsonc
{
  "__typename": "Form",                 // optional everywhere
  "title": "Pet application",           // required, non-empty
  "description": "Apply to keep a pet", // required, non-empty (zod allows "", the API does not)
  "mainImages": [],                     // required array of { id }; keep empty
  "attachments": [],                    // required array of { id }; keep empty
  "currentFormVersion": {
    "__typename": "FormVersion",
    "id": "",
    "items": [ /* see below */ ],
    "workflows": [ /* see below, at least one */ ]
  },
  "isEnableEditSubmission": false,      // required boolean
  "isShowPopupMessage": false,          // required boolean
  "popupMessage": "",                   // optional string; required non-empty if isShowPopupMessage
  "paymentAmount": null,                // number | null
  "isSharableOnApp": true,              // required boolean — visible in the resident app
  "isVisibleToCommitteeMembers": false, // required boolean
  "isInternalAdminWorkflow": false,     // required boolean — admin-only template
  "isUsedForJobs": false,               // optional boolean
  "isAutoCloseInactiveEnabled": false,  // optional boolean
  "autoCloseInactiveDays": null         // number | null; required >= 1 if auto-close is enabled
}
```

Fields the zod schema tolerates but the importer discards: `id`, `orderNum`, `sites`, `groups`,
`paymentAccount`, `newSubmissionNotificationAdmins`, `isPaymentRequired`, `isPublic`, and the four
`isRequiredToSend…` notification booleans. Real exports contain them; generated files need not.

## Workflows (the statuses)

```jsonc
{
  "__typename": "FormWorkflow",
  "id": "…uuid…",                        // re-minted on import, but must be present
  "color": "#79909C",                    // non-empty hex
  "name": "New",                         // non-empty
  "description": "Request has been created", // non-empty — the usual cause of a rejected import
  "type": "UNACTIONED",                  // UNACTIONED | ACTIONED | COMPLETED
  "index": 0                             // present; not range-checked (that check is commented out)
}
```

- **Array order is what matters for the start status**: a new submission opens on `workflows[0]`,
  regardless of `index`.
- `type` buckets the status for sorting in the resident app — `UNACTIONED` (1) before `ACTIONED` (2) before
  `COMPLETED` (3). Use `UNACTIONED` for the opening status, `ACTIONED` for work in flight and `COMPLETED` for terminal ones.
  (The console's blank template marks even *Complete* and *Declined* as `ACTIONED`, so either is accepted.)

`color` is a hex string; any value works, so the console's own palette is a convention rather than a
constraint.

## Items (the form fields)

Every item carries `id`, `index`, `type`, `title` (non-empty). Everything except `SECTION_HEADING` also
carries `isHidedFromSiteRequest` (hides the field from the community-facing form) and a `validators` object.
`description` is `string | null` — always emit it, even as `""`.

| `type` | `__typename` | `validators` | Extra |
| --- | --- | --- | --- |
| `SHORT_TEXT` | `ShortText` | `{ isRequired }` | `showAsSummary` — at most one item may set it `true` |
| `LONG_TEXT` | `LongText` | `{ isRequired }` | |
| `NUMBER` | `Number` | `{ isRequired, minNumber, maxNumber }` | both bounds required |
| `IMAGE_UPLOAD` | `ImageUpload` | `{ isRequired }` | |
| `FILE_ATTACHMENT` | `FileUpload` | `{ isRequired }` | |
| `SINGLE_SELECT` | `SingleSelect` | `{ isRequired }` | `options` — non-empty |
| `MULTI_SELECT` | `MultiSelect` | `{ isRequired }` | `options` — non-empty |
| `CHECKBOX` | `CheckBox` | `{ isRequiredTrue }` | note the different key |
| `DATE` | `DateItem` | `{ isRequired }` | |
| `SECTION_HEADING` | `SectionHeading` | *(none)* | no `isHidedFromSiteRequest` either |
| `INSTRUCTION` | `Instruction` | *(none)* | `richText` Quill delta, `ops` non-empty; no `description` |

`item.index` must fall in `0 … items.length - 1`. Option shape:

```jsonc
{ "__typename": "SelectionOption", "id": "…uuid…", "title": "Dog", "index": 0 }
```

with `index` in `0 … options.length - 1`.

### Examples

```jsonc
// SHORT_TEXT
{
  "__typename": "ShortText", "id": "…", "index": 0, "type": "SHORT_TEXT",
  "title": "Full name", "description": "", "isHidedFromSiteRequest": false,
  "showAsSummary": true, "validators": { "__typename": "ShortTextValidators", "isRequired": true }
}

// SINGLE_SELECT
{
  "__typename": "SingleSelect", "id": "…", "index": 1, "type": "SINGLE_SELECT",
  "title": "Pet type", "description": "", "isHidedFromSiteRequest": false,
  "options": [
    { "__typename": "SelectionOption", "id": "…", "title": "Dog", "index": 0 },
    { "__typename": "SelectionOption", "id": "…", "title": "Cat", "index": 1 }
  ],
  "validators": { "__typename": "SingleSelectValidators", "isRequired": true }
}

// INSTRUCTION
{
  "__typename": "Instruction", "id": "…", "index": 2, "type": "INSTRUCTION",
  "title": "Before you start", "isHidedFromSiteRequest": false,
  "richText": { "ops": [{ "insert": "Approval takes up to 10 business days.\n" }] }
}
```
