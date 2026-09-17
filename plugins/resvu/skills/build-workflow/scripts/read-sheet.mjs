#!/usr/bin/env node
// Prints the rows of a .xlsx, .csv or .tsv file as JSON. No dependencies: the workbook is
// unzipped and its sheet XML read directly.
//
//   node read-sheet.mjs form.xlsx
//   node read-sheet.mjs form.xlsx --sheet 2       (1-based position, or the sheet name)
//   node read-sheet.mjs form.csv --objects        (first row becomes the keys)

import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { basename } from 'node:path';

function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip archive — is this really an .xlsx?');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  if (off === 0xffffffff) throw new Error('ZIP64 workbook is not supported — re-save it, or export as CSV');

  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('corrupt central directory');
    const method = buf.readUInt16LE(off + 10);
    const compressedSize = buf.readUInt32LE(off + 20);
    const nameLength = buf.readUInt16LE(off + 28);
    const extraLength = buf.readUInt16LE(off + 30);
    const commentLength = buf.readUInt16LE(off + 32);
    const localOffset = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLength);

    const localNameLength = buf.readUInt16LE(localOffset + 26);
    const localExtraLength = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buf.subarray(start, start + compressedSize);
    files.set(name, method === 0 ? raw : inflateRawSync(raw));

    off += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function decodeXml(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function textOf(xml) {
  let out = '';
  for (const m of xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) out += decodeXml(m[1]);
  return out;
}

function columnIndex(letters) {
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

function readWorkbook(buf) {
  const files = unzip(buf);
  const read = (name) => (files.has(name) ? files.get(name).toString('utf8') : '');

  const strings = [];
  for (const m of read('xl/sharedStrings.xml').matchAll(/<si\b(?:[^>]*\/>|[^>]*>([\s\S]*?)<\/si>)/g)) {
    strings.push(m[1] ? textOf(m[1]) : '');
  }

  const rels = new Map();
  for (const m of read('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b([^>]*)\/>/g)) {
    const id = /Id="([^"]+)"/.exec(m[1])?.[1];
    const target = /Target="([^"]+)"/.exec(m[1])?.[1];
    if (id && target) rels.set(id, target.replace(/^\/?xl\//, '').replace(/^\//, ''));
  }

  const sheets = [];
  for (const m of read('xl/workbook.xml').matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = /name="([^"]*)"/.exec(m[1])?.[1];
    const relId = /r:id="([^"]+)"/.exec(m[1])?.[1];
    const path = `xl/${rels.get(relId) ?? ''}`;
    if (name && files.has(path)) sheets.push({ name: decodeXml(name), rows: readSheet(read(path), strings) });
  }
  if (sheets.length === 0) throw new Error('no worksheets found in the workbook');
  return sheets;
}

function readSheet(xml, strings) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowNumber = Number(/r="(\d+)"/.exec(rowMatch[1])?.[1] ?? rows.length + 1);
    const cells = [];
    for (const cellMatch of (rowMatch[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2] ?? '';
      const column = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const at = column ? columnIndex(column) : cells.length;
      const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? 'n';

      let value;
      if (type === 'inlineStr') {
        value = textOf(body);
      } else {
        const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '';
        value = type === 's' ? (strings[Number(raw)] ?? '') : decodeXml(raw);
        if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
      }
      cells[at] = value;
    }
    rows[rowNumber - 1] = Array.from(cells, (c) => c ?? '');
  }
  return Array.from(rows, (r) => r ?? []);
}

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let dirty = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') (field += '"'), i++;
      else quoted = false;
      continue;
    }
    if (c === '"') (quoted = true), (dirty = true);
    else if (c === delimiter) (row.push(field), (field = ''), (dirty = true));
    else if (c === '\n') (row.push(field), rows.push(row), (row = []), (field = ''), (dirty = false));
    else if (c !== '\r') (field += c), (dirty = true);
  }
  if (dirty || field !== '') (row.push(field), rows.push(row));
  return rows;
}

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const asObjects = args.includes('--objects');
const wanted = args.includes('--sheet') ? args[args.indexOf('--sheet') + 1] : null;

if (!file) {
  console.error('usage: read-sheet.mjs <file.xlsx|file.csv|file.tsv> [--sheet <n|name>] [--objects]');
  process.exit(2);
}

let sheets;
const buf = readFileSync(file);
if (/\.xlsx$/i.test(file)) {
  sheets = readWorkbook(buf);
} else {
  const text = buf.toString('utf8').replace(/^﻿/, '');
  const delimiter = /\.tsv$/i.test(file) ? '\t' : ',';
  sheets = [{ name: basename(file), rows: parseDelimited(text, delimiter) }];
}

if (wanted) {
  const byName = sheets.find((s) => s.name === wanted);
  const picked = byName ?? sheets[Number(wanted) - 1];
  if (!picked) {
    console.error(`no such sheet: ${wanted}. Available: ${sheets.map((s) => s.name).join(', ')}`);
    process.exit(1);
  }
  sheets = [picked];
}

const shape = (sheet) => {
  if (!asObjects) return sheet;
  const [header = [], ...rest] = sheet.rows;
  return {
    name: sheet.name,
    rows: rest.map((row) => Object.fromEntries(header.map((key, i) => [key || `column${i + 1}`, row[i] ?? '']))),
  };
};

console.log(JSON.stringify(sheets.length === 1 ? shape(sheets[0]) : sheets.map(shape), null, 2));
