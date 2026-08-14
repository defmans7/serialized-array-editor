/**
 * Full PHP serialize() format — parser and serializer.
 *
 * Supported types (https://www.php.net/manual/en/function.serialize.php):
 *   N;                 null
 *   b:0; b:1;          boolean
 *   i:-42;             integer (arbitrary precision — echoed, never coerced)
 *   d:1.5; d:1.0E+5;   float (also INF, -INF, NAN)
 *   s:5:"hello";       string (length is BYTE length; \ and " are escaped)
 *   S:3:"a\xC3\xA9";   string with hex escapes (parsed; re-serialized as s:)
 *   a:2:{...}          array (ordered key/value pairs)
 *   O:8:"stdClass":..  object (class name preserved, properties as key/value)
 *   r:2; R:2;          value/object reference (preserved, not resolved)
 *
 * Not supported (clear error): C: custom-serialized objects.
 */

const encoder = new TextEncoder();

export function utf8ByteLength(str) {
  return encoder.encode(str).length;
}

// PHP converts only canonical decimal integers (no leading zeros, no +, and
// only within PHP_INT_MIN..PHP_INT_MAX) into int keys. Everything else stays
// a string key.
const PHP_INT_MIN = -9223372036854775808n;
const PHP_INT_MAX = 9223372036854775807n;
const CANONICAL_INT_RE = /^-?(0|[1-9][0-9]*)$/;

export function isPhpInteger(text) {
  if (!CANONICAL_INT_RE.test(text)) return false;
  const n = BigInt(text);
  return n >= PHP_INT_MIN && n <= PHP_INT_MAX;
}

// --- parsing ---------------------------------------------------------------

function codePointAt(str, i) {
  const first = str.charCodeAt(i);
  if (first >= 0xd800 && first <= 0xdbff && i + 1 < str.length) {
    const second = str.charCodeAt(i + 1);
    if (second >= 0xdc00 && second <= 0xdfff) {
      return (first - 0xd800) * 0x400 + (second - 0xdc00) + 0x10000;
    }
  }
  return first;
}

function utf8LengthOfCodePoint(cp) {
  if (cp < 0x80) return 1;
  if (cp < 0x800) return 2;
  if (cp < 0x10000) return 3;
  return 4;
}

function fail(p, msg) {
  throw new Error(`Parse error at position ${p.pos}: ${msg}`);
}

function expectLiteral(p, lit) {
  if (!p.str.startsWith(lit, p.pos)) fail(p, `expected "${lit}"`);
  p.pos += lit.length;
}

function readDigits(p, { allowNegative = false } = {}) {
  const start = p.pos;
  if (allowNegative && p.str[p.pos] === '-') p.pos += 1;
  while (p.pos < p.str.length && p.str[p.pos] >= '0' && p.str[p.pos] <= '9') {
    p.pos += 1;
  }
  if (p.pos === start) fail(p, 'expected a number');
  return p.str.slice(start, p.pos);
}

function parseValue(p) {
  if (p.pos >= p.str.length) fail(p, 'unexpected end of input');
  const ch = p.str[p.pos];
  switch (ch) {
    case 'N':
      p.pos += 2; // "N;"
      return { type: 'null' };

    case 'b': {
      p.pos += 2; // "b:"
      const v = p.str[p.pos];
      p.pos += 1;
      if (v === '0' || v === '1') {
        expectLiteral(p, ';');
        return { type: 'bool', value: v === '1' ? 'true' : 'false' };
      }
      fail(p, 'expected 0 or 1 after "b:"');
      break;
    }

    case 'i': {
      p.pos += 2; // "i:"
      const digits = readDigits(p, { allowNegative: true });
      expectLiteral(p, ';');
      return { type: 'int', value: digits };
    }

    case 'd': {
      p.pos += 2; // "d:"
      const start = p.pos;
      while (p.pos < p.str.length && p.str[p.pos] !== ';') p.pos += 1;
      if (p.pos === start) fail(p, 'expected a float value');
      const token = p.str.slice(start, p.pos);
      p.pos += 1; // ";"
      if (token === 'INF' || token === '-INF' || token === 'NAN') {
        return { type: 'float', value: token };
      }
      if (Number.isNaN(Number(token))) fail(p, `invalid float "${token}"`);
      return { type: 'float', value: token };
    }

    case 's':
    case 'S':
      return parseString(p);

    case 'a':
      return parseArray(p);

    case 'O':
      return parseObject(p);

    case 'r':
    case 'R': {
      const letter = ch;
      p.pos += 2; // "r:" / "R:"
      const digits = readDigits(p);
      expectLiteral(p, ';');
      return { type: 'reference', letter, value: digits };
    }

    case 'C':
      fail(p, 'custom-serialized objects (C:) are not supported');

    default:
      fail(p, `unexpected token "${ch}"`);
  }
}

function parseString(p) {
  const hexEscapes = p.str[p.pos] === 'S';
  p.pos += 2; // "s:" / "S:"
  const len = parseInt(readDigits(p), 10);
  expectLiteral(p, ':');
  expectLiteral(p, '"');

  let value = '';
  let bytes = 0;
  while (bytes < len) {
    if (p.pos >= p.str.length) fail(p, 'unexpected end of string data');
    const ch = p.str[p.pos];

    if (hexEscapes && ch === '\\' && (p.str[p.pos + 1] === 'x' || p.str[p.pos + 1] === 'X')) {
      // S: hex escape — one raw byte, mapped to the matching Latin-1 char.
      const hex = p.str.slice(p.pos + 2, p.pos + 4);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) fail(p, `invalid hex escape "\\x${hex}"`);
      value += String.fromCharCode(parseInt(hex, 16));
      bytes += 1;
      p.pos += 4;
    } else if (!hexEscapes && ch === '\\') {
      // s: escaped literal (\" or \\) — PHP only ever escapes these two.
      p.pos += 1;
      if (p.pos >= p.str.length) fail(p, 'unexpected end of string data');
      value += p.str[p.pos];
      bytes += 1;
      p.pos += 1;
    } else if (hexEscapes) {
      value += ch;
      bytes += 1;
      p.pos += 1;
    } else {
      const cp = codePointAt(p.str, p.pos);
      value += String.fromCodePoint(cp);
      bytes += utf8LengthOfCodePoint(cp);
      p.pos += cp > 0xffff ? 2 : 1;
    }
  }

  expectLiteral(p, '"');
  expectLiteral(p, ';');
  return { type: 'string', value };
}

// Array keys are either i:N; (int) or s:N:"..."; (string). Keys are stored as
// plain text; the int/string decision happens at serialization time using
// PHP's own conversion rules.
function parseKey(p) {
  if (p.str[p.pos] === 'i') {
    return { key: parseValue(p).value };
  }
  if (p.str[p.pos] === 's' || p.str[p.pos] === 'S') {
    return { key: parseString(p).value };
  }
  fail(p, 'expected an array key (i: or s:)');
}

function parseArray(p) {
  p.pos += 2; // "a:"
  const count = parseInt(readDigits(p), 10);
  expectLiteral(p, ':');
  expectLiteral(p, '{');
  const children = [];
  for (let i = 0; i < count; i += 1) {
    const key = parseKey(p);
    const value = parseValue(p);
    children.push({ key: key.key, ...value });
  }
  expectLiteral(p, '}');
  return { type: 'array', children };
}

function parseObject(p) {
  p.pos += 2; // "O:"
  const len = parseInt(readDigits(p), 10);
  expectLiteral(p, ':');
  expectLiteral(p, '"');
  const className = p.str.slice(p.pos, p.pos + len);
  p.pos += len;
  expectLiteral(p, '"');
  expectLiteral(p, ':'); // O:<len>:"<class>":<count>:{...} — no semicolon after the class name
  const count = parseInt(readDigits(p), 10);
  expectLiteral(p, ':');
  expectLiteral(p, '{');
  const children = [];
  for (let i = 0; i < count; i += 1) {
    const key = parseKey(p);
    const value = parseValue(p);
    children.push({ key: key.key, ...value });
  }
  expectLiteral(p, '}');
  return { type: 'object', className, children };
}

/**
 * Parse a PHP-serialized value into a plain node tree:
 *   scalars   { type, value }
 *   reference { type: 'reference', letter, value }
 *   array     { type: 'array', children: [{ key, ...node }] }
 *   object    { type: 'object', className, children: [{ key, ...node }] }
 */
export function parseSerialized(input) {
  const str = String(input ?? '').trim();
  if (!str) throw new Error('Empty input — nothing to parse');
  const p = { str, pos: 0 };
  const root = parseValue(p);
  // Tolerate one trailing ";" — some copy sources append it.
  if (p.str[p.pos] === ';') p.pos += 1;
  if (p.pos < p.str.length) fail(p, 'unexpected trailing data');
  return root;
}

// --- serialization ----------------------------------------------------------

function escapePhpString(str) {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function serializeString(value) {
  return `s:${utf8ByteLength(value)}:"${escapePhpString(value)}";`;
}

// PHP semantics: a canonical in-range integer becomes an int key, everything
// else is a string key.
function serializeKey(key) {
  return isPhpInteger(key) ? `i:${key};` : serializeString(key);
}

/**
 * Serialize a node tree (the same shape parseSerialized returns) back to PHP
 * serialize() format. Throws with a human-readable message on invalid values.
 */
export function serializeNode(node) {
  switch (node.type) {
    case 'null':
      return 'N;';

    case 'bool':
      if (node.value === 'true') return 'b:1;';
      if (node.value === 'false') return 'b:0;';
      throw new Error(`Invalid boolean "${node.value}"`);

    case 'int': {
      const t = node.value.trim();
      if (!/^-?\d+$/.test(t)) throw new Error(`Invalid integer "${node.value}"`);
      return `i:${t};`;
    }

    case 'float': {
      const t = node.value.trim();
      if (t === 'INF' || t === 'Infinity') return 'd:INF;';
      if (t === '-INF' || t === '-Infinity') return 'd:-INF;';
      if (t === 'NAN' || t === 'NaN') return 'd:NAN;';
      if (t === '' || Number.isNaN(Number(t))) throw new Error(`Invalid number "${node.value}"`);
      let s = String(Number(t));
      if (!/[.eE]/.test(s)) s += '.0'; // PHP 7.1+ emits d:1; but d:1.0; parses everywhere
      return `d:${s};`;
    }

    case 'string':
      return serializeString(node.value);

    case 'reference':
      return `${node.letter}:${node.value};`;

    case 'array': {
      let out = `a:${node.children.length}:{`;
      for (const child of node.children) {
        out += serializeKey(child.key);
        out += serializeNode(child);
      }
      return `${out}}`;
    }

    case 'object': {
      let out = `O:${utf8ByteLength(node.className)}:"${escapePhpString(node.className)}":${node.children.length}:{`;
      for (const child of node.children) {
        // Object properties are always string keys in PHP.
        out += serializeString(child.key);
        out += serializeNode(child);
      }
      return `${out}}`;
    }

    default:
      throw new Error(`Unknown node type "${node.type}"`);
  }
}

/**
 * Quick validation for a single scalar node. Returns an error message or ''.
 * Container nodes are always structurally fine; their children validate
 * recursively during serialization.
 */
export function validateNode(node) {
  switch (node.type) {
    case 'int':
      return /^-?\d+$/.test(node.value.trim()) ? '' : 'Must be a whole number';
    case 'float': {
      const t = node.value.trim();
      const specials = ['', 'INF', '-INF', 'NAN', 'Infinity', '-Infinity', 'NaN'];
      if (specials.includes(t)) return '';
      return Number.isNaN(Number(t)) ? 'Must be a number' : '';
    }
    case 'bool':
      return node.value === 'true' || node.value === 'false' ? '' : 'Invalid boolean';
    default:
      return '';
  }
}
