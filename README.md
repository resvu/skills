# resvu-skills

Agent skills for working with Resvu.

## Skills

### `build-workflow` — Resvu workflow templates

Turns a spreadsheet, CSV, PDF or document describing a request form into the JSON the admin console's
**Workflow → Templates → Import template** button accepts: form fields plus the workflow statuses a request
moves through. Also covers hand-authoring, repairing and validating an existing template export.

The skill's own instructions live in [`build-workflow/SKILL.md`](build-workflow/SKILL.md).

```
build-workflow/
├── SKILL.md                              # the workflow the agent follows
├── references/
│   ├── json-contract.md                  # exact shape of every item type + where each rule is enforced
│   └── source-mapping.md                 # reading the source file and mapping it onto a spec
├── examples/
│   ├── input-spec.example.json           # build input — not importable
│   └── importable-template.example.json  # what that spec builds into
└── scripts/
    ├── read-sheet.mjs                    # dump .xlsx/.csv/.tsv rows as JSON
    ├── build-template.mjs                # spec.json → importable template
    ├── validate-template.mjs             # re-implements all four import gates
    └── template_tool.py                  # the same three as read/build/validate subcommands
```

#### Using the scripts directly

Nothing needs installing — the Node scripts and the Python one are dependency-free (they unzip `.xlsx`
workbooks and read the sheet XML themselves) and implement identical rules.

```bash
cd build-workflow

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

## Installing a skill

Copy or symlink the skill directory into a skills directory the agent reads — `~/.claude/skills/` for
personal use, or `.claude/skills/` inside a project:

```bash
ln -s "$PWD/build-workflow" ~/.claude/skills/resvu-workflow
```

The directory name is what the agent lists the skill under; the `name:` in `SKILL.md` frontmatter is
`resvu-workflow`.
