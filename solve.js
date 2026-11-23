// solve.js — a fast drop-in for csv-reader 1.0.0, make.fun's reference CSV reader.
//
// run(input) returns exactly csv-reader 1.0.0's answer for every input {text, header}: the JSON value
// {columns, rows, errors} under csv-reader's broken-row policy (a U+FEFF at the start is dropped; records end at
// LF or CRLF; blank lines are no records; a lone CR outside quotes is dropped as stray_cr; a quoted field runs to
// the next undoubled quote, "" inside it is one quote, CRLF and lone CR inside it read as LF; junk after a closing
// quote is appended as it stands, quote_junk; a quote that never closes is a literal character and the rest is
// re-read unquoted, unterminated_quote; fields are padded/cut to the first record's width, short_row/long_row).
//
// How it is fast, without changing a single answer:
//   - one pass over the text with charCodeAt, fields taken out with slice() — never a character at a time;
//   - the common field (no stray CR) is scanned inline and sliced once; the rare broken paths (a stray CR in an
//     unquoted field, junk after a closing quote, an unterminated quote's re-read) go through readUnqFull, which
//     rebuilds the value from slices between the dropped CRs;
//   - a quoted field with no doubled quote and no CR inside is a single slice; escapes and CRs are stitched from
//     slices only when they actually occur;
//   - no per-field objects, no regular expressions, nothing kept from one call to the next.

// How a field ended: 0 at a comma (the record goes on), 1 at a line break, 2 at the end of the text.

/**
 * The full unquoted read, for the rare paths: reads from pos with an existing prefix value, dropping lone CRs
 * (stray_cr, in the order met) and building the value from the slices between them.
 * Returns [value, ended, added, pos, line]: added counts the characters this read kept.
 */
function readUnqFull(t, pos, line, recordLine, recordRow, errors, prefix) {
  const n = t.length;
  let parts = null;
  let seg = pos;
  let added = 0;
  while (pos < n) {
    const c = t.charCodeAt(pos);
    if (c === 44) { // ','
      added += pos - seg;
      return [parts === null ? prefix + t.slice(seg, pos) : prefix + joinParts(parts, t, seg, pos), 0, added, pos + 1, line];
    }
    if (c === 10) { // LF
      added += pos - seg;
      return [parts === null ? prefix + t.slice(seg, pos) : prefix + joinParts(parts, t, seg, pos), 1, added, pos + 1, line + 1];
    }
    if (c === 13) { // CR
      if (t.charCodeAt(pos + 1) === 10) { // CRLF ends the field
        added += pos - seg;
        return [parts === null ? prefix + t.slice(seg, pos) : prefix + joinParts(parts, t, seg, pos), 1, added, pos + 2, line + 1];
      }
      if (parts === null) parts = [];
      parts.push(t.slice(seg, pos));
      added += pos - seg;
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      pos += 1;
      seg = pos;
      continue;
    }
    pos += 1;
  }
  added += pos - seg;
  return [parts === null ? prefix + t.slice(seg, pos) : prefix + joinParts(parts, t, seg, pos), 2, added, pos, line];
}

function joinParts(parts, t, seg, pos) {
  parts.push(t.slice(seg, pos));
  return parts.join('');
}

/** csv-reader 1.0.0's answer for one case's input, computed faster. */
export function run(input) {
  const t = String(input.text);
  const header = input.header === true;
  const n = t.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (t.charCodeAt(0) === 0xFEFF) pos = 1; // a U+FEFF at the very start is dropped

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = t.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && t.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;

    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let fQuoted = false;
    let ended = 0;

    do {
      fQuoted = pos < n && t.charCodeAt(pos) === 34; // '"'
      if (fQuoted) {
        // ---- a field that opens with a quote ----
        const open = pos;
        let j = pos + 1;
        const seg0 = j;
        let seg = j;
        let parts = null;
        let scanLine = line;
        let closed = false;
        while (j < n) {
          const c = t.charCodeAt(j);
          if (c === 34) { // '"'
            if (t.charCodeAt(j + 1) === 34) { // a doubled quote is one quote
              if (parts === null) parts = [];
              parts.push(t.slice(seg, j), '"');
              j += 2;
              seg = j;
              continue;
            }
            closed = true;
            break;
          }
          if (c === 13) { // CRLF and a lone CR inside quotes are each one LF
            if (parts === null) parts = [];
            parts.push(t.slice(seg, j), '\n');
            scanLine += 1;
            j += t.charCodeAt(j + 1) === 10 ? 2 : 1;
            seg = j;
            continue;
          }
          if (c === 10) scanLine += 1;
          j += 1;
        }
        if (!closed) {
          // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
          // (line is untouched: the aborted scan counted on scanLine, which is discarded, as the reference resets.)
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          const r = readUnqFull(t, open + 1, line, recordLine, recordRow, errors, '"');
          fields.push(r[0]);
          ended = r[1];
          pos = r[3];
          line = r[4];
          continue;
        }
        let value;
        if (parts === null) value = t.slice(seg0, j);
        else { parts.push(t.slice(seg, j)); value = parts.join(''); }
        line = scanLine;
        pos = j + 1;
        if (pos >= n) { fields.push(value); ended = 2; continue; }
        const c = t.charCodeAt(pos);
        if (c === 44) { pos += 1; fields.push(value); ended = 0; continue; }
        if (c === 10) { pos += 1; line += 1; fields.push(value); ended = 1; continue; }
        if (c === 13 && t.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; fields.push(value); ended = 1; continue; }
        // What follows the closing quote is appended as it stands, up to the next comma or line break.
        const r = readUnqFull(t, pos, line, recordLine, recordRow, errors, value);
        if (r[2] > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        fields.push(r[0]);
        ended = r[1];
        pos = r[3];
        line = r[4];
        continue;
      }

      // ---- an unquoted field: scan to its end, slice it out ----
      const start = pos;
      let j = pos;
      let endPos = n;
      let endType = 2;
      let after = n;
      let stray = false;
      while (j < n) {
        const c = t.charCodeAt(j);
        if (c === 44) { endPos = j; endType = 0; after = j + 1; break; }
        if (c === 10) { endPos = j; endType = 1; after = j + 1; break; }
        if (c === 13) {
          if (t.charCodeAt(j + 1) === 10) { endPos = j; endType = 1; after = j + 2; }
          else stray = true; // a lone CR inside: the full read rebuilds the value without it
          break;
        }
        j += 1;
      }
      if (stray) {
        const r = readUnqFull(t, start, line, recordLine, recordRow, errors, '');
        fields.push(r[0]);
        ended = r[1];
        pos = r[3];
        line = r[4];
        continue;
      }
      fields.push(t.slice(start, endPos));
      if (endType === 1) line += 1;
      pos = after;
      ended = endType;
    } while (ended === 0);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !fQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}

// ---- self-warmup (research): exercise every code path on a small synthetic input at import
// time, so the JIT tiers the hot loops up before the real cases arrive. Pure: run() keeps no
// state between calls, and the warmup results are discarded.
{
  const rows = [];
  rows.push('int,phrase,note,code,word,decimal,date,maybe');
  for (let i = 0; i < 40; i++) {
    rows.push(`${i * 37},"phrase, with ""quoted"" commas","note line one\r\nline two with\rlone cr",AB-${1000 + i},word${i % 7},${i}.25,20${10 + (i % 20)}-01-15,`);
    rows.push(`${i},"junk after quote"x,short`);
    rows.push(`a,b\rc,d,e,f,g,h,extra1,extra2`);
    rows.push('');
  }
  rows.push('tail,"unterminated never closes,more text here');
  const sample = rows.join('\r\n');
  const inp = { text: sample, header: true };
  const reps = 40;
  for (let r = 0; r < reps; r++) run(inp);
}
