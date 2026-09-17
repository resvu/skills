#!/usr/bin/env node
// Builds an importable workflow-template JSON from a compact spec.
//
//   node build-template.mjs spec.json -o "Pet application.json"
//   node build-template.mjs spec.json            (prints to stdout)
//
// See references/json-contract.md for the shape it produces and examples/spec.example.json for
// the shape it consumes.

import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const TYPE_ALIASES = {
  SHORT_TEXT: ['shorttext', 'text', 'short', 'string', 'line', 'name', 'singleline', 'onelinetext'],
  LONG_TEXT: ['longtext', 'paragraph', 'long', 'textarea', 'multiline', 'comments', 'details', 'description'],
  NUMBER: ['number', 'numeric', 'integer', 'decimal', 'qty', 'quantity', 'amount', 'currency'],
  IMAGE_UPLOAD: ['imageupload', 'image', 'photo', 'picture', 'photos'],
  FILE_ATTACHMENT: ['fileattachment', 'file', 'attachment', 'upload', 'document', 'files'],
  SINGLE_SELECT: ['singleselect', 'select', 'dropdown', 'radio', 'choice', 'list', 'picklist', 'yesno'],
  MULTI_SELECT: ['multiselect', 'multi', 'checkboxes', 'multichoice', 'tickall', 'multipleselect'],
  CHECKBOX: ['checkbox', 'consent', 'agree', 'agreement', 'acknowledgement', 'declaration', 'tick', 'confirm'],
  DATE: ['date', 'day', 'datepicker', 'calendar'],
  SECTION_HEADING: ['sectionheading', 'section', 'heading', 'header', 'group', 'title'],
  INSTRUCTION: ['instruction', 'note', 'info', 'notice', 'richtext', 'statement', 'text_block', 'message'],
};

const ALIAS_LOOKUP = new Map();
for (const [type, aliases] of Object.entries(TYPE_ALIASES)) {
  ALIAS_LOOKUP.set(type.toLowerCase().replace(/[^a-z0-9]/g, ''), type);
  for (const alias of aliases) ALIAS_LOOKUP.set(alias.replace(/[^a-z0-9]/g, ''), type);
}

const TYPENAMES = {
  SHORT_TEXT: 'ShortText',
  LONG_TEXT: 'LongText',
  NUMBER: 'Number',
  IMAGE_UPLOAD: 'ImageUpload',
  FILE_ATTACHMENT: 'FileUpload',
  SINGLE_SELECT: 'SingleSelect',
  MULTI_SELECT: 'MultiSelect',
  CHECKBOX: 'CheckBox',
  DATE: 'DateItem',
  SECTION_HEADING: 'SectionHeading',
  INSTRUCTION: 'Instruction',
};

// The set the admin console's blank template starts from, used when a spec names no statuses.
const DEFAULT_WORKFLOWS = [
  { name: 'New', type: 'UNACTIONED', description: 'Request has been created', color: '#79909C' },
  { name: 'In Progress', type: 'ACTIONED', description: 'Request is being worked on', color: '#1F96F3' },
  { name: 'In Review', type: 'ACTIONED', description: 'Pending approval from another party', color: '#7E57C2' },
  { name: 'Complete', type: 'COMPLETED', description: 'Request was completed successfully', color: '#66BB6A' },
  { name: 'Declined', type: 'COMPLETED', description: 'Request was invalid or cancelled', color: '#F03333' },
];

const DEFAULT_OPTIONS = {
  isEnableEditSubmission: false,
  isShowPopupMessage: false,
  popupMessage: '',
  paymentAmount: null,
  isSharableOnApp: true,
  isVisibleToCommitteeMembers: false,
  isInternalAdminWorkflow: false,
  isUsedForJobs: false,
  isAutoCloseInactiveEnabled: false,
  autoCloseInactiveDays: null,
};

const problems = [];
const fail = (message) => problems.push(message);

function resolveType(raw, where) {
  const key = String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  const type = ALIAS_LOOKUP.get(key);
  if (!type) fail(`${where}: unknown field type ${JSON.stringify(raw)} — see references/source-mapping.md`);
  return type;
}

function truthy(value) {
  if (typeof value === 'boolean') return value;
  if (value == null) return false;
  return ['y', 'yes', 'true', 'required', 'mandatory', 'x', '1', '✓', '✔'].includes(String(value).trim().toLowerCase());
}

function buildOptions(field, where) {
  const raw = field.options ?? field.choices ?? field.values ?? [];
  const list = Array.isArray(raw) ? raw : String(raw).split(/\s*[\/|;,\n]\s*/);
  const titles = list.map((o) => String(typeof o === 'object' && o ? (o.title ?? o.label ?? o.name) : o).trim()).filter(Boolean);
  if (titles.length === 0) fail(`${where}: ${field.type} needs at least one option`);
  return titles.map((title, index) => ({ __typename: 'SelectionOption', id: randomUUID(), title, index }));
}

function buildRichText(field, where) {
  if (field.richText?.ops?.length) return field.richText;
  const text = String(field.text ?? field.body ?? field.description ?? '').trim();
  if (!text) fail(`${where}: an instruction needs "text" (or a "richText" delta)`);
  return { ops: [{ insert: `${text}\n` }] };
}

function buildItem(field, index) {
  const where = `fields[${index}]`;
  const type = resolveType(field.type ?? field.kind, where);
  if (!type) return null;

  const title = String(field.title ?? field.label ?? field.question ?? '').trim();
  if (!title) fail(`${where}: title is required and may not be empty`);

  const required = truthy(field.required ?? field.isRequired ?? field.mandatory);
  const base = {
    __typename: TYPENAMES[type],
    id: randomUUID(),
    index,
    type,
    title,
    description: String(field.description ?? field.help ?? field.hint ?? ''),
    isHidedFromSiteRequest: truthy(field.hidden ?? field.isHidedFromSiteRequest),
  };

  switch (type) {
    case 'SHORT_TEXT':
      return {
        ...base,
        showAsSummary: truthy(field.summary ?? field.showAsSummary),
        validators: { __typename: 'ShortTextValidators', isRequired: required },
      };
    case 'LONG_TEXT':
      return { ...base, validators: { __typename: 'LongTextValidators', isRequired: required } };
    case 'NUMBER':
      return {
        ...base,
        validators: {
          __typename: 'NumberValidators',
          minNumber: Number(field.min ?? field.minNumber ?? 0),
          maxNumber: Number(field.max ?? field.maxNumber ?? 100),
          isRequired: required,
        },
      };
    case 'IMAGE_UPLOAD':
      return { ...base, validators: { __typename: 'ImageUploadValidators', isRequired: required } };
    case 'FILE_ATTACHMENT':
      return { ...base, validators: { __typename: 'FileUploadValidators', isRequired: required } };
    case 'SINGLE_SELECT':
      return {
        ...base,
        options: buildOptions(field, where),
        validators: { __typename: 'SingleSelectValidators', isRequired: required },
      };
    case 'MULTI_SELECT':
      return {
        ...base,
        options: buildOptions(field, where),
        validators: { __typename: 'MultiSelectValidators', isRequired: required },
      };
    case 'CHECKBOX':
      return { ...base, validators: { __typename: 'CheckBoxValidators', isRequiredTrue: required } };
    case 'DATE':
      return { ...base, validators: { __typename: 'DateItemValidators', isRequired: required } };
    case 'SECTION_HEADING':
      // No validators, and no isHidedFromSiteRequest — see references/json-contract.md.
      return { __typename: 'SectionHeading', id: base.id, index, type, title: base.title, description: base.description };
    case 'INSTRUCTION':
      return {
        __typename: 'Instruction',
        id: base.id,
        index,
        type,
        title: base.title,
        richText: buildRichText(field, where),
        isHidedFromSiteRequest: base.isHidedFromSiteRequest,
      };
    default:
      return null;
  }
}

function buildWorkflow(workflow, index) {
  const where = `workflows[${index}]`;
  const type = String(workflow.type ?? 'ACTIONED').trim().toUpperCase();
  if (!['UNACTIONED', 'ACTIONED', 'COMPLETED'].includes(type)) {
    fail(`${where}: type must be UNACTIONED, ACTIONED or COMPLETED (got ${JSON.stringify(workflow.type)})`);
  }
  const name = String(workflow.name ?? workflow.title ?? '').trim();
  if (!name) fail(`${where}: name is required and may not be empty`);
  // The API rejects an empty description, so fall back to the status name rather than "".
  const description = String(workflow.description ?? '').trim() || name;
  return {
    __typename: 'FormWorkflow',
    id: randomUUID(),
    color: String(workflow.color ?? '#0880EA').trim(),
    name,
    type,
    description,
    index,
  };
}

function build(spec) {
  const title = String(spec.title ?? '').trim();
  const description = String(spec.description ?? '').trim();
  if (!title) fail('title is required and may not be empty');
  if (!description) fail('description is required and may not be empty (the API rejects "")');

  const fields = Array.isArray(spec.fields ?? spec.items) ? (spec.fields ?? spec.items) : [];
  if (fields.length === 0) fail('fields: a template needs at least one field');
  const items = fields.map(buildItem).filter(Boolean);

  const summaries = items.filter((i) => i.type === 'SHORT_TEXT' && i.showAsSummary);
  if (summaries.length > 1) {
    fail(`only one SHORT_TEXT may set summary: true (got ${summaries.map((i) => JSON.stringify(i.title)).join(', ')})`);
  }

  const workflowSpec = Array.isArray(spec.workflows) && spec.workflows.length > 0 ? spec.workflows : DEFAULT_WORKFLOWS;
  const workflows = workflowSpec.map(buildWorkflow);

  const options = { ...DEFAULT_OPTIONS, ...(spec.options ?? {}) };
  if (options.isShowPopupMessage && !String(options.popupMessage ?? '').trim()) {
    fail('options.popupMessage is required when isShowPopupMessage is true');
  }
  if (options.isAutoCloseInactiveEnabled && !(Number(options.autoCloseInactiveDays) >= 1)) {
    fail('options.autoCloseInactiveDays must be 1 or more when isAutoCloseInactiveEnabled is true');
  }

  return {
    __typename: 'Form',
    title,
    description,
    mainImages: [],
    attachments: [],
    currentFormVersion: { __typename: 'FormVersion', id: '', items, workflows },
    ...options,
  };
}

const args = process.argv.slice(2);
let specPath = null;
let outPath = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-o' || args[i] === '--out') outPath = args[++i];
  else if (!specPath) specPath = args[i];
}

if (!specPath) {
  console.error('usage: build-template.mjs <spec.json> [-o <template.json>]');
  process.exit(2);
}

let spec;
try {
  // .trim() also drops a UTF-8 BOM, which is what the real importer does before parsing.
  spec = JSON.parse(readFileSync(specPath, 'utf8').trim());
} catch (error) {
  console.error(`could not read ${specPath}: ${error.message}`);
  process.exit(1);
}

if (spec && typeof spec === 'object' && spec.currentFormVersion) {
  console.error(`${specPath} is already a built template, not a spec — it has "currentFormVersion".`);
  console.error('Check it instead of rebuilding it:');
  console.error(`  node scripts/validate-template.mjs ${JSON.stringify(specPath)}`);
  process.exit(1);
}

const template = build(spec);

if (problems.length > 0) {
  console.error(`${problems.length} problem(s) in ${specPath}:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

const json = `${JSON.stringify(template, null, 2)}\n`;
if (outPath) {
  writeFileSync(outPath, json);
  console.error(`wrote ${outPath} — ${template.currentFormVersion.items.length} fields, ${template.currentFormVersion.workflows.length} statuses`);
  const validator = fileURLToPath(new URL('validate-template.mjs', import.meta.url));
  console.error(`now run: node ${JSON.stringify(validator)} ${JSON.stringify(outPath)}`);
} else {
  process.stdout.write(json);
}
