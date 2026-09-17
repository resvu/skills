#!/usr/bin/env python3
"""Python twin of read-sheet.mjs, build-template.mjs and validate-template.mjs.

Standard library only, so it runs wherever python3 does — no pip install, no Node.
Use the .mjs scripts when Node is available; this file exists for machines without it.
The two implementations must stay in step: same rules, same messages.

    python3 template_tool.py read form.xlsx [--sheet <n|name>] [--objects]
    python3 template_tool.py build spec.json [-o "Title.json"]
    python3 template_tool.py validate "Title.json"
"""

import argparse
import csv
import json
import os.path
import re
import sys
import uuid
import zipfile

# --------------------------------------------------------------------------------------
# read — .xlsx / .csv / .tsv into rows
# --------------------------------------------------------------------------------------

ENTITIES = {"&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'"}


def decode_xml(s):
    s = re.sub(r"&#x([0-9a-fA-F]+);", lambda m: chr(int(m.group(1), 16)), s)
    s = re.sub(r"&#(\d+);", lambda m: chr(int(m.group(1))), s)
    for entity, char in ENTITIES.items():
        s = s.replace(entity, char)
    return s.replace("&amp;", "&")


def text_of(xml):
    return "".join(decode_xml(m.group(1)) for m in re.finditer(r"<t\b[^>]*>(.*?)</t>", xml, re.S))


def column_index(letters):
    n = 0
    for c in letters:
        n = n * 26 + (ord(c) - 64)
    return n - 1


def read_sheet_xml(xml, strings):
    rows = {}
    for row_match in re.finditer(r"<row\b([^>]*?)(?:/>|>(.*?)</row>)", xml, re.S):
        number = re.search(r'r="(\d+)"', row_match.group(1))
        row_number = int(number.group(1)) if number else len(rows) + 1
        cells = {}
        for cell_match in re.finditer(r"<c\b([^>]*?)(?:/>|>(.*?)</c>)", row_match.group(2) or "", re.S):
            attrs, body = cell_match.group(1), cell_match.group(2) or ""
            column = re.search(r'r="([A-Z]+)\d+"', attrs)
            at = column_index(column.group(1)) if column else len(cells)
            cell_type = re.search(r't="([^"]+)"', attrs)
            cell_type = cell_type.group(1) if cell_type else "n"

            if cell_type == "inlineStr":
                value = text_of(body)
            else:
                raw = re.search(r"<v\b[^>]*>(.*?)</v>", body, re.S)
                raw = raw.group(1) if raw else ""
                if cell_type == "s":
                    index = int(raw) if raw.isdigit() else -1
                    value = strings[index] if 0 <= index < len(strings) else ""
                elif cell_type == "b":
                    value = "TRUE" if raw == "1" else "FALSE"
                else:
                    value = decode_xml(raw)
            cells[at] = value
        width = max(cells) + 1 if cells else 0
        rows[row_number - 1] = [cells.get(i, "") for i in range(width)]
    return [rows.get(i, []) for i in range(max(rows) + 1 if rows else 0)]


def read_workbook(path):
    with zipfile.ZipFile(path) as archive:

        def read(name):
            try:
                return archive.read(name).decode("utf-8")
            except KeyError:
                return ""

        strings = []
        for m in re.finditer(r"<si\b(?:[^>]*/>|[^>]*>(.*?)</si>)", read("xl/sharedStrings.xml"), re.S):
            strings.append(text_of(m.group(1)) if m.group(1) else "")

        rels = {}
        for m in re.finditer(r"<Relationship\b([^>]*)/>", read("xl/_rels/workbook.xml.rels")):
            rel_id = re.search(r'Id="([^"]+)"', m.group(1))
            target = re.search(r'Target="([^"]+)"', m.group(1))
            if rel_id and target:
                rels[rel_id.group(1)] = re.sub(r"^/?xl/", "", target.group(1)).lstrip("/")

        names = set(archive.namelist())
        sheets = []
        for m in re.finditer(r"<sheet\b([^>]*?)/?>", read("xl/workbook.xml")):
            name = re.search(r'name="([^"]*)"', m.group(1))
            rel_id = re.search(r'r:id="([^"]+)"', m.group(1))
            path_in_zip = "xl/" + rels.get(rel_id.group(1), "") if rel_id else ""
            if name and path_in_zip in names:
                sheets.append({"name": decode_xml(name.group(1)), "rows": read_sheet_xml(read(path_in_zip), strings)})

    if not sheets:
        raise SystemExit("no worksheets found in the workbook")
    return sheets


def read_delimited(path, delimiter):
    with open(path, "r", encoding="utf-8-sig", newline="") as handle:
        return [row for row in csv.reader(handle, delimiter=delimiter)]


def command_read(args):
    if args.file.lower().endswith(".xlsx"):
        sheets = read_workbook(args.file)
    else:
        delimiter = "\t" if args.file.lower().endswith(".tsv") else ","
        sheets = [{"name": os.path.basename(args.file), "rows": read_delimited(args.file, delimiter)}]

    if args.sheet:
        picked = next((s for s in sheets if s["name"] == args.sheet), None)
        if picked is None and args.sheet.isdigit() and 1 <= int(args.sheet) <= len(sheets):
            picked = sheets[int(args.sheet) - 1]
        if picked is None:
            raise SystemExit(f"no such sheet: {args.sheet}. Available: {', '.join(s['name'] for s in sheets)}")
        sheets = [picked]

    def shape(sheet):
        if not args.objects:
            return sheet
        header = sheet["rows"][0] if sheet["rows"] else []
        keys = [key or f"column{i + 1}" for i, key in enumerate(header)]
        return {
            "name": sheet["name"],
            "rows": [
                {key: (row[i] if i < len(row) else "") for i, key in enumerate(keys)} for row in sheet["rows"][1:]
            ],
        }

    payload = shape(sheets[0]) if len(sheets) == 1 else [shape(s) for s in sheets]
    print(json.dumps(payload, indent=2, ensure_ascii=False))


# --------------------------------------------------------------------------------------
# build — spec into an importable template
# --------------------------------------------------------------------------------------

TYPE_ALIASES = {
    "SHORT_TEXT": ["shorttext", "text", "short", "string", "line", "name", "singleline", "onelinetext"],
    "LONG_TEXT": ["longtext", "paragraph", "long", "textarea", "multiline", "comments", "details", "description"],
    "NUMBER": ["number", "numeric", "integer", "decimal", "qty", "quantity", "amount", "currency"],
    "IMAGE_UPLOAD": ["imageupload", "image", "photo", "picture", "photos"],
    "FILE_ATTACHMENT": ["fileattachment", "file", "attachment", "upload", "document", "files"],
    "SINGLE_SELECT": ["singleselect", "select", "dropdown", "radio", "choice", "list", "picklist", "yesno"],
    "MULTI_SELECT": ["multiselect", "multi", "checkboxes", "multichoice", "tickall", "multipleselect"],
    "CHECKBOX": ["checkbox", "consent", "agree", "agreement", "acknowledgement", "declaration", "tick", "confirm"],
    "DATE": ["date", "day", "datepicker", "calendar"],
    "SECTION_HEADING": ["sectionheading", "section", "heading", "header", "group", "title"],
    "INSTRUCTION": ["instruction", "note", "info", "notice", "richtext", "statement", "text_block", "message"],
}

ALIAS_LOOKUP = {}
for _type, _aliases in TYPE_ALIASES.items():
    ALIAS_LOOKUP[re.sub(r"[^a-z0-9]", "", _type.lower())] = _type
    for _alias in _aliases:
        ALIAS_LOOKUP[re.sub(r"[^a-z0-9]", "", _alias)] = _type

TYPENAMES = {
    "SHORT_TEXT": "ShortText",
    "LONG_TEXT": "LongText",
    "NUMBER": "Number",
    "IMAGE_UPLOAD": "ImageUpload",
    "FILE_ATTACHMENT": "FileUpload",
    "SINGLE_SELECT": "SingleSelect",
    "MULTI_SELECT": "MultiSelect",
    "CHECKBOX": "CheckBox",
    "DATE": "DateItem",
    "SECTION_HEADING": "SectionHeading",
    "INSTRUCTION": "Instruction",
}

# The set the admin console's blank template starts from, used when a spec names no statuses.
DEFAULT_WORKFLOWS = [
    {"name": "New", "type": "UNACTIONED", "description": "Request has been created", "color": "#79909C"},
    {"name": "In Progress", "type": "ACTIONED", "description": "Request is being worked on", "color": "#1F96F3"},
    {"name": "In Review", "type": "ACTIONED", "description": "Pending approval from another party", "color": "#7E57C2"},
    {"name": "Complete", "type": "COMPLETED", "description": "Request was completed successfully", "color": "#66BB6A"},
    {"name": "Declined", "type": "COMPLETED", "description": "Request was invalid or cancelled", "color": "#F03333"},
]

DEFAULT_OPTIONS = {
    "isEnableEditSubmission": False,
    "isShowPopupMessage": False,
    "popupMessage": "",
    "paymentAmount": None,
    "isSharableOnApp": True,
    "isVisibleToCommitteeMembers": False,
    "isInternalAdminWorkflow": False,
    "isUsedForJobs": False,
    "isAutoCloseInactiveEnabled": False,
    "autoCloseInactiveDays": None,
}

TRUTHY = {"y", "yes", "true", "required", "mandatory", "x", "1", "✓", "✔"}

problems = []


def fail(message):
    problems.append(message)


def new_id():
    return str(uuid.uuid4())


def first(field, *keys, default=None):
    for key in keys:
        if field.get(key) is not None:
            return field[key]
    return default


def as_number(value):
    """Match JSON.stringify: a whole number is written 0, not 0.0."""
    number = float(value)
    return int(number) if number.is_integer() else number


def truthy(value):
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().lower() in TRUTHY


def resolve_type(raw, where):
    key = re.sub(r"[^a-z0-9]", "", str(raw if raw is not None else "").lower())
    item_type = ALIAS_LOOKUP.get(key)
    if not item_type:
        fail(f"{where}: unknown field type {json.dumps(raw)} — see references/source-mapping.md")
    return item_type


def build_options(field, where):
    raw = first(field, "options", "choices", "values", default=[])
    listed = raw if isinstance(raw, list) else re.split(r"\s*[/|;,\n]\s*", str(raw))
    titles = []
    for option in listed:
        title = option.get("title") or option.get("label") or option.get("name") if isinstance(option, dict) else option
        title = str(title if title is not None else "").strip()
        if title:
            titles.append(title)
    if not titles:
        fail(f"{where}: {field.get('type')} needs at least one option")
    return [
        {"__typename": "SelectionOption", "id": new_id(), "title": title, "index": index}
        for index, title in enumerate(titles)
    ]


def build_rich_text(field, where):
    rich_text = field.get("richText")
    if isinstance(rich_text, dict) and rich_text.get("ops"):
        return rich_text
    text = str(first(field, "text", "body", "description", default="")).strip()
    if not text:
        fail(f'{where}: an instruction needs "text" (or a "richText" delta)')
    return {"ops": [{"insert": f"{text}\n"}]}


def build_item(field, index):
    where = f"fields[{index}]"
    item_type = resolve_type(first(field, "type", "kind"), where)
    if not item_type:
        return None

    title = str(first(field, "title", "label", "question", default="")).strip()
    if not title:
        fail(f"{where}: title is required and may not be empty")

    required = truthy(first(field, "required", "isRequired", "mandatory"))
    description = str(first(field, "description", "help", "hint", default=""))
    hidden = truthy(first(field, "hidden", "isHidedFromSiteRequest"))

    base = {
        "__typename": TYPENAMES[item_type],
        "id": new_id(),
        "index": index,
        "type": item_type,
        "title": title,
        "description": description,
        "isHidedFromSiteRequest": hidden,
    }

    if item_type == "SHORT_TEXT":
        return {
            **base,
            "showAsSummary": truthy(first(field, "summary", "showAsSummary")),
            "validators": {"__typename": "ShortTextValidators", "isRequired": required},
        }
    if item_type == "LONG_TEXT":
        return {**base, "validators": {"__typename": "LongTextValidators", "isRequired": required}}
    if item_type == "NUMBER":
        return {
            **base,
            "validators": {
                "__typename": "NumberValidators",
                "minNumber": as_number(first(field, "min", "minNumber", default=0)),
                "maxNumber": as_number(first(field, "max", "maxNumber", default=100)),
                "isRequired": required,
            },
        }
    if item_type == "IMAGE_UPLOAD":
        return {**base, "validators": {"__typename": "ImageUploadValidators", "isRequired": required}}
    if item_type == "FILE_ATTACHMENT":
        return {**base, "validators": {"__typename": "FileUploadValidators", "isRequired": required}}
    if item_type == "SINGLE_SELECT":
        return {
            **base,
            "options": build_options(field, where),
            "validators": {"__typename": "SingleSelectValidators", "isRequired": required},
        }
    if item_type == "MULTI_SELECT":
        return {
            **base,
            "options": build_options(field, where),
            "validators": {"__typename": "MultiSelectValidators", "isRequired": required},
        }
    if item_type == "CHECKBOX":
        return {**base, "validators": {"__typename": "CheckBoxValidators", "isRequiredTrue": required}}
    if item_type == "DATE":
        return {**base, "validators": {"__typename": "DateItemValidators", "isRequired": required}}
    if item_type == "SECTION_HEADING":
        # No validators, and no isHidedFromSiteRequest — see references/json-contract.md.
        return {
            "__typename": "SectionHeading",
            "id": base["id"],
            "index": index,
            "type": item_type,
            "title": title,
            "description": description,
        }
    if item_type == "INSTRUCTION":
        return {
            "__typename": "Instruction",
            "id": base["id"],
            "index": index,
            "type": item_type,
            "title": title,
            "richText": build_rich_text(field, where),
            "isHidedFromSiteRequest": hidden,
        }
    return None


def build_workflow(workflow, index):
    where = f"workflows[{index}]"
    workflow_type = str(workflow.get("type") or "ACTIONED").strip().upper()
    if workflow_type not in ("UNACTIONED", "ACTIONED", "COMPLETED"):
        fail(f"{where}: type must be UNACTIONED, ACTIONED or COMPLETED (got {json.dumps(workflow.get('type'))})")
    name = str(first(workflow, "name", "title", default="")).strip()
    if not name:
        fail(f"{where}: name is required and may not be empty")
    # The API rejects an empty description, so fall back to the status name rather than "".
    description = str(workflow.get("description") or "").strip() or name
    return {
        "__typename": "FormWorkflow",
        "id": new_id(),
        "color": str(workflow.get("color") or "#0880EA").strip(),
        "name": name,
        "type": workflow_type,
        "description": description,
        "index": index,
    }


def build(spec):
    title = str(spec.get("title") or "").strip()
    description = str(spec.get("description") or "").strip()
    if not title:
        fail("title is required and may not be empty")
    if not description:
        fail('description is required and may not be empty (the API rejects "")')

    fields = spec.get("fields") if isinstance(spec.get("fields"), list) else spec.get("items")
    fields = fields if isinstance(fields, list) else []
    if not fields:
        fail("fields: a template needs at least one field")
    items = [item for item in (build_item(field, index) for index, field in enumerate(fields)) if item]

    summaries = [i for i in items if i["type"] == "SHORT_TEXT" and i.get("showAsSummary")]
    if len(summaries) > 1:
        named = ", ".join(json.dumps(i["title"]) for i in summaries)
        fail(f"only one SHORT_TEXT may set summary: true (got {named})")

    workflow_spec = spec.get("workflows") if isinstance(spec.get("workflows"), list) and spec["workflows"] else DEFAULT_WORKFLOWS
    workflows = [build_workflow(workflow, index) for index, workflow in enumerate(workflow_spec)]

    options = {**DEFAULT_OPTIONS, **(spec.get("options") or {})}
    if options["isShowPopupMessage"] and not str(options.get("popupMessage") or "").strip():
        fail("options.popupMessage is required when isShowPopupMessage is true")
    if options["isAutoCloseInactiveEnabled"]:
        try:
            enough = float(options.get("autoCloseInactiveDays")) >= 1
        except (TypeError, ValueError):
            enough = False
        if not enough:
            fail("options.autoCloseInactiveDays must be 1 or more when isAutoCloseInactiveEnabled is true")

    return {
        "__typename": "Form",
        "title": title,
        "description": description,
        "mainImages": [],
        "attachments": [],
        "currentFormVersion": {"__typename": "FormVersion", "id": "", "items": items, "workflows": workflows},
        **options,
    }


def command_build(args):
    try:
        with open(args.spec, "r", encoding="utf-8-sig") as handle:
            spec = json.load(handle)
    except (OSError, ValueError) as error:
        raise SystemExit(f"could not read {args.spec}: {error}")

    if isinstance(spec, dict) and spec.get("currentFormVersion"):
        print(f'{args.spec} is already a built template, not a spec — it has "currentFormVersion".', file=sys.stderr)
        print("Check it instead of rebuilding it:", file=sys.stderr)
        print(f"  python3 scripts/template_tool.py validate {json.dumps(args.spec)}", file=sys.stderr)
        raise SystemExit(1)

    template = build(spec)

    if problems:
        print(f"{len(problems)} problem(s) in {args.spec}:", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        raise SystemExit(1)

    payload = json.dumps(template, indent=2, ensure_ascii=False) + "\n"
    if args.out:
        with open(args.out, "w", encoding="utf-8") as handle:
            handle.write(payload)
        items = len(template["currentFormVersion"]["items"])
        workflows = len(template["currentFormVersion"]["workflows"])
        print(f"wrote {args.out} — {items} fields, {workflows} statuses", file=sys.stderr)
        print(f"now run: python3 {sys.argv[0]} validate {json.dumps(args.out)}", file=sys.stderr)
    else:
        sys.stdout.write(payload)


# --------------------------------------------------------------------------------------
# validate — the same four gates validate-template.mjs checks
# --------------------------------------------------------------------------------------

ITEM_TYPES = list(TYPENAMES)

errors = []
warnings = []


def error(where, message):
    errors.append(f"{where}: {message}")


def is_present(value):
    """The "present" check — '' and [] count as absent, False and 0 do not."""
    if value is None:
        return False
    if isinstance(value, str) and value == "":
        return False
    if isinstance(value, list) and not value:
        return False
    return True


def check_boolean(where, key, value, optional=False):
    if value is None and optional:
        return
    if not isinstance(value, bool):
        error(where, f"{key} must be a boolean (the importer's zod rejects {json.dumps(value)})")


def check_top_level(form):
    for key in ("title", "description"):
        value = form.get(key)
        if not isinstance(value, str):
            error("template", f"{key} must be a string")
        elif not is_present(value.strip()):
            error("template", f'{key} may not be empty — the API rejects it with "{key.capitalize()} is required"')

    for key in ("mainImages", "attachments"):
        value = form.get(key)
        if not isinstance(value, list):
            error("template", f"{key} must be an array (use [] when there are none)")
        elif any(not isinstance(blob, dict) or not isinstance(blob.get("id"), str) for blob in value):
            error("template", f"every entry in {key} needs a string id")
        elif value:
            warnings.append(
                f"template: {key} carries Blob ids — they only resolve in the account they were uploaded to"
            )

    check_boolean("template", "isEnableEditSubmission", form.get("isEnableEditSubmission"))
    check_boolean("template", "isShowPopupMessage", form.get("isShowPopupMessage"))
    check_boolean("template", "isSharableOnApp", form.get("isSharableOnApp"))
    check_boolean("template", "isVisibleToCommitteeMembers", form.get("isVisibleToCommitteeMembers"))
    check_boolean("template", "isInternalAdminWorkflow", form.get("isInternalAdminWorkflow"))
    check_boolean("template", "isUsedForJobs", form.get("isUsedForJobs"), optional=True)
    check_boolean("template", "isAutoCloseInactiveEnabled", form.get("isAutoCloseInactiveEnabled"), optional=True)

    if "popupMessage" in form and form["popupMessage"] is not None and not isinstance(form["popupMessage"], str):
        error("template", "popupMessage must be a string when present")
    if form.get("isShowPopupMessage") and not is_present(str(form.get("popupMessage") or "").strip()):
        error("template", "popupMessage is required when isShowPopupMessage is true")

    for key in ("paymentAmount", "autoCloseInactiveDays"):
        value = form.get(key)
        if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float))):
            error("template", f"{key} must be a number or null")

    if form.get("isAutoCloseInactiveEnabled"):
        days = form.get("autoCloseInactiveDays")
        if isinstance(days, bool) or not isinstance(days, (int, float)) or days < 1:
            error("template", "autoCloseInactiveDays must be 1 or more when isAutoCloseInactiveEnabled is true")


def check_workflows(workflows):
    if not isinstance(workflows, list) or not workflows:
        error("currentFormVersion.workflows", "at least one status is required")
        return
    for index, workflow in enumerate(workflows):
        where = f"workflows[{index}]"
        workflow = workflow if isinstance(workflow, dict) else {}
        if not is_present(workflow.get("id")):
            error(where, "id is required (the importer re-mints it, but it must be there)")
        for key in ("color", "name", "description"):
            value = workflow.get(key)
            if not isinstance(value, str):
                error(where, f"{key} must be a string")
            elif not is_present(value):
                error(where, f"{key} may not be empty — the API rejects it")
        if isinstance(workflow.get("index"), bool) or not isinstance(workflow.get("index"), (int, float)):
            error(where, "index must be a number")
        if workflow.get("type") not in ("UNACTIONED", "ACTIONED", "COMPLETED"):
            error(where, f"type must be UNACTIONED, ACTIONED or COMPLETED (got {json.dumps(workflow.get('type'))})")

    opener = workflows[0] if isinstance(workflows[0], dict) else {}
    if opener.get("type") == "COMPLETED":
        warnings.append(
            f"workflows[0] ({json.dumps(opener.get('name'))}) is the status new submissions open in, "
            "and it is typed COMPLETED"
        )


def check_options(item, where):
    options = item.get("options")
    if not isinstance(options, list) or not options:
        error(where, f"{item['type']} needs a non-empty options array")
        return
    for index, option in enumerate(options):
        at = f"{where}.options[{index}]"
        option = option if isinstance(option, dict) else {}
        if not is_present(option.get("id")):
            error(at, "id is required")
        if not is_present(option.get("title")):
            error(at, "title is required and may not be empty")
        option_index = option.get("index")
        if isinstance(option_index, bool) or not isinstance(option_index, (int, float)):
            error(at, "index must be a number")
        elif option_index < 0 or option_index >= len(options):
            error(at, f"index must be between 0 and {len(options) - 1}")


def check_items(items):
    if not isinstance(items, list) or not items:
        error("currentFormVersion.items", "at least one field is required")
        return

    for index, item in enumerate(items):
        item = item if isinstance(item, dict) else {}
        label = f" ({json.dumps(item.get('title'))})" if item.get("title") else ""
        where = f"items[{index}]{label}"

        if not is_present(item.get("id")):
            error(where, "id is required")
        item_index = item.get("index")
        if isinstance(item_index, bool) or not isinstance(item_index, (int, float)):
            error(where, "index must be a number")
        elif item_index < 0 or item_index >= len(items):
            error(where, f"index must be between 0 and {len(items) - 1}")

        item_type = item.get("type")
        if item_type not in ITEM_TYPES:
            error(where, f"type must be one of {', '.join(ITEM_TYPES)} (got {json.dumps(item_type)})")
            continue

        typename = item.get("__typename")
        if typename is not None and typename != TYPENAMES[item_type]:
            error(where, f'__typename for {item_type} is "{TYPENAMES[item_type]}", not {json.dumps(typename)}')
        if not is_present(item.get("title")):
            error(where, f"({item_type}) title is required and may not be empty")

        if item_type != "SECTION_HEADING" and not is_present(item.get("isHidedFromSiteRequest")):
            error(where, f"({item_type}) isHidedFromSiteRequest is required")

        validators = item.get("validators")

        def require_validator(key):
            if not is_present(validators):
                error(where, f"({item_type}) validators is required")
            elif not is_present(validators.get(key)):
                error(where, f"({item_type}) validator {key} is required")

        if item_type in ("SHORT_TEXT", "LONG_TEXT", "IMAGE_UPLOAD", "FILE_ATTACHMENT", "DATE"):
            require_validator("isRequired")
        elif item_type == "NUMBER":
            require_validator("isRequired")
            require_validator("minNumber")
            require_validator("maxNumber")
            if isinstance(validators, dict):
                low, high = validators.get("minNumber"), validators.get("maxNumber")
                if isinstance(low, (int, float)) and isinstance(high, (int, float)) and low > high:
                    warnings.append(f"{where}: minNumber is greater than maxNumber")
        elif item_type in ("SINGLE_SELECT", "MULTI_SELECT"):
            require_validator("isRequired")
            check_options(item, where)
        elif item_type == "CHECKBOX":
            require_validator("isRequiredTrue")
            if isinstance(validators, dict) and "isRequired" in validators and "isRequiredTrue" not in validators:
                error(where, "(CHECKBOX) validators use isRequiredTrue, not isRequired")
        elif item_type == "INSTRUCTION":
            rich_text = item.get("richText")
            if not isinstance(rich_text, dict) or not rich_text.get("ops"):
                error(where, "(INSTRUCTION) richText must be a Quill delta with a non-empty ops array")

    indexes = [item.get("index") if isinstance(item, dict) else None for item in items]
    if len({json.dumps(i) for i in indexes}) != len(indexes):
        warnings.append("items: two fields share an index — the form order is then undefined")

    summaries = [i for i in items if isinstance(i, dict) and i.get("type") == "SHORT_TEXT" and i.get("showAsSummary") is True]
    if len(summaries) > 1:
        named = ", ".join(json.dumps(i.get("title")) for i in summaries)
        error("items", f"only one SHORT_TEXT may set showAsSummary — createForm throws otherwise ({named})")


def command_validate(args):
    try:
        with open(args.file, "r", encoding="utf-8-sig") as handle:
            form = json.load(handle)
    except (OSError, ValueError) as error_:
        raise SystemExit(f"{args.file}: {error_}")

    # The commonest mistake: importing the build spec instead of what the build produced.
    if not form.get("currentFormVersion") and (isinstance(form.get("fields"), list) or isinstance(form.get("items"), list)):
        key = "fields" if isinstance(form.get("fields"), list) else "items"
        print(f'{args.file} is a build spec, not a template — it has "{key}" and no "currentFormVersion".', file=sys.stderr)
        print("The admin console cannot import a spec. Build it first, then import the result:", file=sys.stderr)
        print(f"  python3 scripts/template_tool.py build {json.dumps(args.file)} -o \"<Title>.json\"", file=sys.stderr)
        raise SystemExit(1)

    check_top_level(form)
    version = form.get("currentFormVersion")
    if not isinstance(version, dict):
        error("template", "currentFormVersion is required")
    else:
        check_items(version.get("items"))
        check_workflows(version.get("workflows"))

    for warning in warnings:
        print(f"warning  {warning}", file=sys.stderr)

    if errors:
        print(f"\n{args.file} will NOT import — {len(errors)} problem(s):", file=sys.stderr)
        for message in errors:
            print(f"  - {message}", file=sys.stderr)
        raise SystemExit(1)

    version = version if isinstance(version, dict) else {}
    items = version.get("items") or []
    workflows = version.get("workflows") or []
    opener = json.dumps(workflows[0].get("name")) if workflows and isinstance(workflows[0], dict) else "null"
    print(
        f"{args.file} is importable — {len(items)} fields, {len(workflows)} statuses, opens on {opener}",
        file=sys.stderr,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)

    reader = commands.add_parser("read", help="print the rows of an .xlsx/.csv/.tsv as JSON")
    reader.add_argument("file")
    reader.add_argument("--sheet", help="sheet name, or 1-based position")
    reader.add_argument("--objects", action="store_true", help="first row becomes the keys")
    reader.set_defaults(handler=command_read)

    builder = commands.add_parser("build", help="build an importable template from a spec")
    builder.add_argument("spec")
    builder.add_argument("-o", "--out", help="write here instead of stdout")
    builder.set_defaults(handler=command_build)

    validator = commands.add_parser("validate", help="check a template against every import gate")
    validator.add_argument("file")
    validator.set_defaults(handler=command_validate)

    args = parser.parse_args()
    args.handler(args)


if __name__ == "__main__":
    main()
