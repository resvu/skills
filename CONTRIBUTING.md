# Working on this repo

For maintainers. End users only need the README.

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

## Testing a change

Load the plugin from disk without installing it:

```bash
claude --plugin-dir ./plugins/resvu
```

The skill's scripts can also be run on their own. They are dependency-free — both the Node and the Python
implementation read `.xlsx` by unzipping the workbook themselves:

```bash
cd plugins/resvu/skills/build-workflow

node scripts/read-sheet.mjs form.xlsx
node scripts/build-template.mjs spec.json -o "Pet application.json"
node scripts/validate-template.mjs "Pet application.json"

# or, with python3 instead of node
python3 scripts/template_tool.py read form.xlsx
python3 scripts/template_tool.py build spec.json -o "Pet application.json"
python3 scripts/template_tool.py validate "Pet application.json"
```

The two implementations must stay in step: a rule changed in one belongs in the other, and
`references/json-contract.md` is the source both follow.

## Before publishing

```bash
claude plugin validate . --strict
claude plugin validate ./plugins/resvu --strict
```

Bump `version` in **both** `plugins/resvu/.claude-plugin/plugin.json` and
`.claude-plugin/marketplace.json`. Installed copies only update when the version changes.
