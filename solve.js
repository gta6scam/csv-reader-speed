// solve.js — QuadScan: a cold-optimized drop-in for csv-reader 1.0.0.
//
// Semantics are exactly csv-reader's (identical to challenger-r2's decisions):
// BOM dropped; records end at LF/CRLF; blank lines are no records; lone CR
// outside quotes dropped as stray_cr; a quoted field runs to the next
// undoubled quote, "" is one quote, CRLF/lone CR inside read as LF; junk
// after a closing quote is appended as it stands (quote_junk when the field
// ends, after any stray_cr met inside the junk); a quote that never closes
// is a literal and the rest is re-read unquoted (unterminated_quote, then
// stray_cr in that re-read as met); fields padded/cut to the first record's
// width (short_row with fields:, long_row with extra:); errors are
// {code, line, row} in the order met, line = the record's starting line,
// row = its index in rows (null for the header).
//
// Architecture "QuadScan" (new; no split fast path, no regex, no warmup):
//  - The main unquoted scan is an unrolled loop that consumes FOUR code
//    units per iteration when none of the four is a delimiter (comma 44,
//    quote 34, LF 10, CR 13): all four codes are checked, and if any is a
//    delimiter the loop falls into a scalar step-by-step handler for the
//    unit at the scan position; otherwise it advances 4 at once.
//  - Field values are slices of the input; a quoted field's value is one
//    slice when it holds no escape or line break, a join of slices else.
//  - Quoted fields are handled by a dedicated sub-loop (also 4-wide for
//    plain stretches, scalar at quote/CR/LF).
//  - Minimal module-level code: two small helpers only, no tables, no
//    self-warmup, so cold module init is near-zero. The rare paths that
//    must rescan a field (stray CR inside it, junk after a closing quote,
//    an unterminated quote's re-read) share readUnqFull, which
//    accumulates the field's pieces and joins them once (scalar, rare).

function joinParts(parts, t, seg, pos) {
  parts.push(t.slice(seg, pos));
  return parts.join('');
}

function readUnqFull(t, pos, line, recordLine, recordRow, errors, prefix) {
  const n = t.length;
  let parts = null;
  let seg = pos;
  let added = 0;
  while (pos < n) {
    const c = t.charCodeAt(pos);
    if (c === 44) {
      added += pos - seg;
      return [parts === null ? prefix + t.slice(seg, pos) : prefix + joinParts(parts, t, seg, pos), 0, added, pos + 1, line];
    }
    if (c === 10) {
      added += pos - seg;
      return [parts === null ? prefix + t.slice(seg, pos) : prefix + joinParts(parts, t, seg, pos), 1, added, pos + 1, line + 1];
    }
    if (c === 13) {
      if (t.charCodeAt(pos + 1) === 10) {
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

export function run(input) {
  const t = String(input.text);
  const header = input.header === true;
  const n = t.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (t.charCodeAt(0) === 0xFEFF) pos = 1;

  while (true) {
    // Blank lines (empty, or LF/CRLF only) are no records.
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
      fQuoted = pos < n && t.charCodeAt(pos) === 34;
      if (fQuoted) {
        // ---- dedicated quoted sub-loop ----
        const open = pos;
        let j = pos + 1;
        const seg0 = j;
        let seg = j;
        let parts = null;
        let scanLine = line;
        let closed = false;
        while (j < n) {
          // 4-wide plain stretch: none of the four is quote/CR/LF.
          if (j + 4 <= n) {
            const a = t.charCodeAt(j);
            const b = t.charCodeAt(j + 1);
            const c2 = t.charCodeAt(j + 2);
            const d = t.charCodeAt(j + 3);
            if (a !== 34 && a !== 13 && a !== 10 &&
                b !== 34 && b !== 13 && b !== 10 &&
                c2 !== 34 && c2 !== 13 && c2 !== 10 &&
                d !== 34 && d !== 13 && d !== 10) {
              j += 4;
              continue;
            }
          }
          // Scalar step for the unit at j.
          const c = t.charCodeAt(j);
          if (c === 34) {
            if (t.charCodeAt(j + 1) === 34) {
              if (parts === null) parts = [];
              parts.push(t.slice(seg, j), '"');
              j += 2;
              seg = j;
              continue;
            }
            closed = true;
            break;
          }
          if (c === 13) {
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
        const r = readUnqFull(t, pos, line, recordLine, recordRow, errors, value);
        if (r[2] > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        fields.push(r[0]);
        ended = r[1];
        pos = r[3];
        line = r[4];
        continue;
      }

      // ---- QuadScan main loop: unquoted field ----
      const start = pos;
      let j = pos;
      let endPos = n;
      let endType = 2;
      let after = n;
      let stray = false;
      while (j < n) {
        // Consume FOUR code units at once when none is a delimiter
        // (comma 44, quote 34, LF 10, CR 13).
        if (j + 4 <= n) {
          const a = t.charCodeAt(j);
          const b = t.charCodeAt(j + 1);
          const c2 = t.charCodeAt(j + 2);
          const d = t.charCodeAt(j + 3);
          if (a !== 44 && a !== 34 && a !== 10 && a !== 13 &&
              b !== 44 && b !== 34 && b !== 10 && b !== 13 &&
              c2 !== 44 && c2 !== 34 && c2 !== 10 && c2 !== 13 &&
              d !== 44 && d !== 34 && d !== 10 && d !== 13) {
            j += 4;
            continue;
          }
        }
        // Scalar step-by-step handler for the unit at j.
        const c = t.charCodeAt(j);
        if (c === 44) { endPos = j; endType = 0; after = j + 1; break; }
        if (c === 10) { endPos = j; endType = 1; after = j + 1; break; }
        if (c === 13) {
          if (t.charCodeAt(j + 1) === 10) { endPos = j; endType = 1; after = j + 2; }
          else stray = true;
          break;
        }
        // Quote inside an unquoted field is a literal character; any
        // other unit is literal too: advance one.
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

    // A line that held only stray CRs is left with no characters: no record.
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
