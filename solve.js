// csv-reader-speed-01-run-20261121: my own faster drop-in for csv-reader 1.0.0.
// run(input) returns exactly what csv-reader 1.0.0 returns for {text, header}:
// {columns, rows, errors}. The reading policy, restated from the competition's
// rules so this file stands on its own:
//
// - A U+FEFF at the very start of the text is dropped.
// - A record ends at LF or CRLF, and a line left with no characters is no record.
// - Outside quotes a CR not followed by LF is dropped (error stray_cr).
// - A field that opens with a quote runs to the next quote that is not doubled;
//   "" inside it is one quote, each CRLF or lone CR inside it reads as LF; what
//   follows its closing quote, up to the next comma or line break, is appended
//   as it stands (quote_junk, when the field ends); a quote that never closes
//   is a literal character, and the text after it is read again as unquoted
//   (unterminated_quote). A quote inside an unquoted field is a literal.
// - Fields stay strings, never trimmed or converted.
// - columns is the first record when header is true, else null; rows holds the
//   records after it (every record when header is false), each padded with
//   empty strings (short_row, with fields: its field count) or cut (long_row,
//   with extra: the cut fields) to the first record's width.
// - Each error is {code, line, row}, in the order met; a record's short_row or
//   long_row when it ends: line the 1-based line its record starts on, counting
//   every LF, CRLF and lone CR inside quotes, and row its record's index in
//   rows, null for the header.
//
// Speed: instead of walking the text one character at a time, the reader jumps
// from delimiter to delimiter (one native regex scan for , CR LF in unquoted
// fields, indexOf for the next quote in quoted ones) and slices each field's
// text out whole. Line numbers inside quoted fields are counted once, from
// the span, after the closing quote is found.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

const QUOTE = 34; // "
const COMMA_CODE = 44; // ,
const LF = 10; // \n
const CR = 13; // \r
const BOM = 0xfeff;

/** The next comma, CR or LF at or after `from`, as a regex match. */
const DELIM = /[,\r\n]/g;
/** One line break inside a quoted field: CRLF counts once, as does a lone CR. */
const BREAKS = /\r\n|\r|\n/g;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  const n = text.length;
  let columns = null;
  let width = -1;

  let pos = text.charCodeAt(0) === BOM ? 1 : 0;
  let line = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters from pos, starting from `start` ('' for a plain
  // field, '"' when a quote that never closed is re-read as unquoted). Returns
  // the field, how it ended, and how many characters were kept (`added`,
  // which the quote_junk check reads).
  function readUnquoted(start) {
    let value = start;
    let added = 0;
    let segStart = pos;
    DELIM.lastIndex = pos;
    for (;;) {
      const m = DELIM.exec(text);
      if (m === null) {
        if (segStart < n) {
          value += text.slice(segStart);
          added += n - segStart;
        }
        pos = n;
        return { value, ended: END, added };
      }
      const d = m.index;
      const ch = text.charCodeAt(d);
      if (ch === COMMA_CODE) {
        value += text.slice(segStart, d);
        added += d - segStart;
        pos = d + 1;
        return { value, ended: COMMA, added };
      }
      if (ch === LF) {
        value += text.slice(segStart, d);
        added += d - segStart;
        pos = d + 1;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      // A CR: a line break when followed by LF, a dropped stray otherwise.
      if (text.charCodeAt(d + 1) === LF) {
        value += text.slice(segStart, d);
        added += d - segStart;
        pos = d + 2;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      error('stray_cr');
      value += text.slice(segStart, d);
      added += d - segStart;
      pos = d + 1;
      segStart = d + 1;
      DELIM.lastIndex = pos;
    }
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    let segStart = pos + 1;
    let scan = pos + 1;
    let close = -1;
    for (;;) {
      const q = text.indexOf('"', scan);
      if (q === -1) break;
      if (text.charCodeAt(q + 1) === QUOTE) {
        // A doubled quote is one literal quote inside the field.
        value += text.slice(segStart, q) + '"';
        scan = q + 2;
        segStart = q + 2;
        continue;
      }
      close = q;
      value += text.slice(segStart, q);
      break;
    }
    if (close === -1) {
      // The quote never closes: it is a literal character, and the text after
      // it is read again as unquoted. The line is put back to the opening
      // quote's line; the re-read counts its own line breaks.
      pos = open + 1;
      line = openLine;
      error('unterminated_quote');
      return readUnquoted('"');
    }
    // Count the line breaks the quoted span holds, then step past the quote.
    const span = text.slice(open + 1, close);
    const breaks = span.match(BREAKS);
    if (breaks !== null) line += breaks.length;
    // Each CRLF or lone CR inside quotes reads as one LF in the value.
    if (value.indexOf('\r') !== -1) value = value.replace(/\r\n?/g, '\n');
    pos = close + 1;
    if (pos >= n) return { value, ended: END, added: 0 };
    const c = text.charCodeAt(pos);
    if (c === COMMA_CODE) {
      pos += 1;
      return { value, ended: COMMA, added: 0 };
    }
    if (c === LF) {
      pos += 1;
      line += 1;
      return { value, ended: LINE_BREAK, added: 0 };
    }
    if (c === CR && text.charCodeAt(pos + 1) === LF) {
      pos += 2;
      line += 1;
      return { value, ended: LINE_BREAK, added: 0 };
    }
    // What follows the closing quote is appended as it stands, up to the next
    // comma or line break.
    const junk = readUnquoted(value);
    if (junk.added > 0) error('quote_junk');
    return junk;
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === LF) {
        pos += 1;
        line += 1;
      } else if (c === CR && text.charCodeAt(pos + 1) === LF) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let field;
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === QUOTE;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

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
