# resvu-skills

Claude Code skills for working with Resvu, packaged as a plugin.

This repository is both the plugin and the marketplace that serves it.

## Install

```
/plugin marketplace add resvu/skills
/plugin install resvu@resvu-skills
```

The skill is then available as `/resvu:build-workflow`, and Claude will reach for it on its own when
someone hands over a form definition.

To try it without installing:

```bash
claude --plugin-dir ./plugins/resvu
```

## Skills

### `build-workflow` — Resvu workflow templates

Turns a spreadsheet, CSV, PDF or document describing a request form into the JSON the admin console's
**Workflow → Templates → Import template** button accepts: form fields plus the workflow statuses a request
moves through. Also covers hand-authoring, repairing and validating an existing template export.

The skill's own instructions live in
[`plugins/resvu/skills/build-workflow/SKILL.md`](plugins/resvu/skills/build-workflow/SKILL.md).

#### Using the scripts directly

Nothing needs installing — the Node scripts and the Python one are dependency-free (they unzip `.xlsx`
workbooks and read the sheet XML themselves) and implement identical rules.

```bash
cd plugins/resvu/skills/build-workflow

node scripts/read-sheet.mjs form.xlsx               # inspect the source rows
node scripts/build-template.mjs spec.json -o "Pet application.json"
node scripts/validate-template.mjs "Pet application.json"
```

With `python3` instead of `node`:

```bash
python3 scripts/template_tool.py read form.xlsx
python3 scripts/template_tool.py build spec.json -o "Pet application.json"
python3 scripts/template_tool.py validate "Pet application.json"
```

The two implementations must stay in step: a rule changed in one belongs in the other, and
`references/json-contract.md` is the source both follow.

## Layout

```
.claude-plugin/marketplace.json   # the marketplace listing
plugins/resvu/
├── .claude-plugin/plugin.json    # the plugin manifest
└── skills/
    └── build-workflow/           # one skill; more go alongside it
```

Adding a skill means dropping another directory under `plugins/resvu/skills/` — the marketplace and
manifest need no change.

## Before publishing changes

```bash
claude plugin validate . --strict
claude plugin validate ./plugins/resvu --strict
```

Bump `version` in **both** `plugins/resvu/.claude-plugin/plugin.json` and
`.claude-plugin/marketplace.json` when you change the plugin — installed copies only update when the
version changes.
