#!/usr/bin/env node
// Checks a workflow-template JSON against every gate a real import passes through:
//
//   1. the importer's zod schema   — apps/admin-console/.../import-button/import-button.tsx
//   2. the Form model validators   — apps/api/src/models/form.ts
//   3. the FormVersion validators  — apps/api/src/models/form-version.ts
//   4. the createForm resolver     — apps/api/src/apollo-servers/admin-server/modules/forms/resolvers.ts
//
//   node validate-template.mjs "Pet application.json"
//
// Exits 0 when the file will import, 1 when it will not.

import { readFileSync } from 'node:fs';

const errors = [];
const warnings = [];
const fail = (where, message) => errors.push(`${where}: ${message}`);

// apps/api/src/utils/object-helpers.ts — '' and [] count as absent, false and 0 do not.
const isPresent = (v) => !(v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0));

const ITEM_TYPES = [
  'SHORT_TEXT', 'LONG_TEXT', 'NUMBER', 'IMAGE_UPLOAD', 'FILE_ATTACHMENT',
  'SINGLE_SELECT', 'MULTI_SELECT', 'CHECKBOX', 'DATE', 'SECTION_HEADING', 'INSTRUCTION',
];
const TYPENAMES = {
  SHORT_TEXT: 'ShortText', LONG_TEXT: 'LongText', NUMBER: 'Number', IMAGE_UPLOAD: 'ImageUpload',
  FILE_ATTACHMENT: 'FileUpload', SINGLE_SELECT: 'SingleSelect', MULTI_SELECT: 'MultiSelect',
  CHECKBOX: 'CheckBox', DATE: 'DateItem', SECTION_HEADING: 'SectionHeading', INSTRUCTION: 'Instruction',
};

function checkBoolean(where, key, value, { optional = false } = {}) {
  if (value === undefined && optional) return;
  if (typeof value !== 'boolean') fail(where, `${key} must be a boolean (the importer's zod rejects ${JSON.stringify(value)})`);
}

function checkTopLevel(form) {
  for (const [key, value] of [['title', form.title], ['description', form.description]]) {
    if (typeof value !== 'string') fail('template', `${key} must be a string`);
    else if (!isPresent(value.trim())) fail('template', `${key} may not be empty — the API rejects it with "${key[0].toUpperCase()}${key.slice(1)} is required"`);
  }

  for (const key of ['mainImages', 'attachments']) {
    const value = form[key];
    if (!Array.isArray(value)) fail('template', `${key} must be an array (use [] when there are none)`);
    else if (value.some((b) => typeof b?.id !== 'string')) fail('template', `every entry in ${key} needs a string id`);
    else if (value.length > 0) warnings.push(`template: ${key} carries Blob ids — they only resolve in the account they were uploaded to`);
  }

  checkBoolean('template', 'isEnableEditSubmission', form.isEnableEditSubmission);
  checkBoolean('template', 'isShowPopupMessage', form.isShowPopupMessage);
  checkBoolean('template', 'isSharableOnApp', form.isSharableOnApp);
  checkBoolean('template', 'isVisibleToCommitteeMembers', form.isVisibleToCommitteeMembers);
  checkBoolean('template', 'isInternalAdminWorkflow', form.isInternalAdminWorkflow);
  checkBoolean('template', 'isUsedForJobs', form.isUsedForJobs, { optional: true });
  checkBoolean('template', 'isAutoCloseInactiveEnabled', form.isAutoCloseInactiveEnabled, { optional: true });

  if (form.popupMessage !== undefined && typeof form.popupMessage !== 'string') {
    fail('template', 'popupMessage must be a string when present');
  }
  if (form.isShowPopupMessage && !isPresent(String(form.popupMessage ?? '').trim())) {
    fail('template', 'popupMessage is required when isShowPopupMessage is true');
  }
  for (const key of ['paymentAmount', 'autoCloseInactiveDays']) {
    const value = form[key];
    if (value !== undefined && value !== null && typeof value !== 'number') fail('template', `${key} must be a number or null`);
  }
  if (form.isAutoCloseInactiveEnabled && !(Number(form.autoCloseInactiveDays) >= 1)) {
    fail('template', 'autoCloseInactiveDays must be 1 or more when isAutoCloseInactiveEnabled is true');
  }
}

function checkWorkflows(workflows) {
  if (!Array.isArray(workflows) || workflows.length === 0) {
    fail('currentFormVersion.workflows', 'at least one status is required');
    return;
  }
  workflows.forEach((workflow, i) => {
    const where = `workflows[${i}]`;
    if (!isPresent(workflow?.id)) fail(where, 'id is required (the importer re-mints it, but it must be there)');
    for (const key of ['color', 'name', 'description']) {
      if (typeof workflow?.[key] !== 'string') fail(where, `${key} must be a string`);
      else if (!isPresent(workflow[key])) fail(where, `${key} may not be empty — the API rejects it`);
    }
    if (typeof workflow?.index !== 'number') fail(where, 'index must be a number');
    if (!['UNACTIONED', 'ACTIONED', 'COMPLETED'].includes(workflow?.type)) {
      fail(where, `type must be UNACTIONED, ACTIONED or COMPLETED (got ${JSON.stringify(workflow?.type)})`);
    }
  });
  if (workflows[0]?.type === 'COMPLETED') {
    warnings.push(`workflows[0] (${JSON.stringify(workflows[0].name)}) is the status new submissions open in, and it is typed COMPLETED`);
  }
}

function checkOptions(item, where) {
  const options = item.options;
  if (!Array.isArray(options) || options.length === 0) {
    fail(where, `${item.type} needs a non-empty options array`);
    return;
  }
  options.forEach((option, i) => {
    const at = `${where}.options[${i}]`;
    if (!isPresent(option?.id)) fail(at, 'id is required');
    if (!isPresent(option?.title)) fail(at, 'title is required and may not be empty');
    if (typeof option?.index !== 'number') fail(at, 'index must be a number');
    else if (option.index < 0 || option.index >= options.length) {
      fail(at, `index must be between 0 and ${options.length - 1}`);
    }
  });
}

function checkItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    fail('currentFormVersion.items', 'at least one field is required');
    return;
  }

  items.forEach((item, i) => {
    const where = `items[${i}]${item?.title ? ` (${JSON.stringify(item.title)})` : ''}`;
    if (!isPresent(item?.id)) fail(where, 'id is required');
    if (typeof item?.index !== 'number') fail(where, 'index must be a number');
    else if (item.index < 0 || item.index >= items.length) {
      fail(where, `index must be between 0 and ${items.length - 1}`);
    }
    if (!ITEM_TYPES.includes(item?.type)) {
      fail(where, `type must be one of ${ITEM_TYPES.join(', ')} (got ${JSON.stringify(item?.type)})`);
      return;
    }
    if (item.__typename !== undefined && item.__typename !== TYPENAMES[item.type]) {
      fail(where, `__typename for ${item.type} is "${TYPENAMES[item.type]}", not ${JSON.stringify(item.__typename)}`);
    }
    if (!isPresent(item.title)) fail(where, `(${item.type}) title is required and may not be empty`);

    if (item.type !== 'SECTION_HEADING' && !isPresent(item.isHidedFromSiteRequest) && item.isHidedFromSiteRequest !== false) {
      fail(where, `(${item.type}) isHidedFromSiteRequest is required`);
    }

    const requireValidator = (key) => {
      if (!isPresent(item.validators)) fail(where, `(${item.type}) validators is required`);
      else if (!isPresent(item.validators[key]) && item.validators[key] !== false) {
        fail(where, `(${item.type}) validator ${key} is required`);
      }
    };

    switch (item.type) {
      case 'SHORT_TEXT':
      case 'LONG_TEXT':
      case 'IMAGE_UPLOAD':
      case 'FILE_ATTACHMENT':
      case 'DATE':
        requireValidator('isRequired');
        break;
      case 'NUMBER':
        requireValidator('isRequired');
        requireValidator('minNumber');
        requireValidator('maxNumber');
        if (Number(item.validators?.minNumber) > Number(item.validators?.maxNumber)) {
          warnings.push(`${where}: minNumber is greater than maxNumber`);
        }
        break;
      case 'SINGLE_SELECT':
      case 'MULTI_SELECT':
        requireValidator('isRequired');
        checkOptions(item, where);
        break;
      case 'CHECKBOX':
        requireValidator('isRequiredTrue');
        if (item.validators && 'isRequired' in item.validators && !('isRequiredTrue' in item.validators)) {
          fail(where, '(CHECKBOX) validators use isRequiredTrue, not isRequired');
        }
        break;
      case 'INSTRUCTION':
        if (!item.richText?.ops?.length) fail(where, '(INSTRUCTION) richText must be a Quill delta with a non-empty ops array');
        break;
      case 'SECTION_HEADING':
        break;
    }
  });

  const indexes = items.map((i) => i?.index);
  if (new Set(indexes).size !== indexes.length) warnings.push('items: two fields share an index — the form order is then undefined');

  const summaries = items.filter((i) => i?.type === 'SHORT_TEXT' && i.showAsSummary === true);
  if (summaries.length > 1) {
    fail('items', `only one SHORT_TEXT may set showAsSummary — createForm throws otherwise (${summaries.map((i) => JSON.stringify(i.title)).join(', ')})`);
  }
}

const file = process.argv[2];
if (!file) {
  console.error('usage: validate-template.mjs <template.json>');
  process.exit(2);
}

let form;
try {
  // .trim() also drops a UTF-8 BOM, which is what the real importer does before parsing.
  form = JSON.parse(readFileSync(file, 'utf8').trim());
} catch (error) {
  console.error(`${file}: ${error.message}`);
  process.exit(1);
}

// The commonest mistake: importing the build spec instead of what the build produced.
if (!form.currentFormVersion && (Array.isArray(form.fields) || Array.isArray(form.items))) {
  console.error(`${file} is a build spec, not a template — it has "${Array.isArray(form.fields) ? 'fields' : 'items'}" and no "currentFormVersion".`);
  console.error('The admin console cannot import a spec. Build it first, then import the result:');
  console.error(`  node scripts/build-template.mjs ${JSON.stringify(file)} -o "<Title>.json"`);
  process.exit(1);
}

checkTopLevel(form);
if (!form.currentFormVersion || typeof form.currentFormVersion !== 'object') {
  fail('template', 'currentFormVersion is required');
} else {
  checkItems(form.currentFormVersion.items);
  checkWorkflows(form.currentFormVersion.workflows);
}

for (const warning of warnings) console.error(`warning  ${warning}`);

if (errors.length > 0) {
  console.error(`\n${file} will NOT import — ${errors.length} problem(s):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

const { items = [], workflows = [] } = form.currentFormVersion ?? {};
console.error(`${file} is importable — ${items.length} fields, ${workflows.length} statuses, opens on ${JSON.stringify(workflows[0]?.name)}`);
