import { describe, expect, test } from 'bun:test';
import { parseSerialized, serializeNode, validateNode, isPhpInteger } from '../src/php-serialize';

// Round-trip: parse then re-serialize; input must come back unchanged
// (canonical form), except where the serializer normalizes deliberately.
const roundTrip = (input) => serializeNode(parseSerialized(input));

describe('scalars', () => {
  test('null', () => {
    expect(roundTrip('N;')).toBe('N;');
  });

  test('booleans', () => {
    expect(roundTrip('b:1;')).toBe('b:1;');
    expect(roundTrip('b:0;')).toBe('b:0;');
  });

  test('integers (positive, negative, large)', () => {
    expect(roundTrip('i:0;')).toBe('i:0;');
    expect(roundTrip('i:42;')).toBe('i:42;');
    expect(roundTrip('i:-42;')).toBe('i:-42;');
    expect(roundTrip('i:9223372036854775807;')).toBe('i:9223372036854775807;');
    expect(roundTrip('i:-9223372036854775808;')).toBe('i:-9223372036854775808;');
  });

  test('floats', () => {
    expect(roundTrip('d:1.5;')).toBe('d:1.5;');
    expect(roundTrip('d:-1.25;')).toBe('d:-1.25;');
    expect(roundTrip('d:INF;')).toBe('d:INF;');
    expect(roundTrip('d:-INF;')).toBe('d:-INF;');
    expect(roundTrip('d:NAN;')).toBe('d:NAN;');
  });

  test('floats are normalized to a portable form (always a decimal point)', () => {
    expect(roundTrip('d:1;')).toBe('d:1.0;');
    expect(roundTrip('d:1.0E+5;')).toBe('d:100000.0;');
  });

  test('strings', () => {
    expect(roundTrip('s:0:"";')).toBe('s:0:"";');
    expect(roundTrip('s:5:"hello";')).toBe('s:5:"hello";');
  });

  test('strings escape quotes and backslashes', () => {
    expect(roundTrip('s:3:"a\\"b";')).toBe('s:3:"a\\"b";');
    expect(roundTrip('s:3:"a\\\\b";')).toBe('s:3:"a\\\\b";');
  });

  test('string lengths are byte lengths (UTF-8)', () => {
    // é = 2 bytes: h + é + l + l + o = 1 + 2 + 1 + 1 + 1 = 6 bytes
    expect(roundTrip('s:6:"h\u00e9llo";')).toBe('s:6:"h\u00e9llo";');
    // 你 + 好 + ab = 3 + 3 + 1 + 1 = 8 bytes
    expect(roundTrip('s:8:"\u4f60\u597dab";')).toBe('s:8:"\u4f60\u597dab";');
  });

  test('S: hex-escaped strings parse (bytes map to Latin-1, re-serialized as s:)', () => {
    // Raw bytes 0xC3 0xA9 (the UTF-8 encoding of é) become two Latin-1 chars,
    // which re-encode as 4 UTF-8 bytes.
    expect(roundTrip('S:2:"\\xC3\\xA9";')).toBe('s:4:"\u00c3\u00a9";');
  });
});

describe('arrays', () => {
  test('classic WordPress shape (int keys, string values)', () => {
    const input = 'a:2:{i:0;s:5:"hello";i:1;s:3:"foo";}';
    expect(roundTrip(input)).toBe(input);
  });

  test('empty array', () => {
    expect(roundTrip('a:0:{}')).toBe('a:0:{}');
  });

  test('string keys and mixed value types', () => {
    const input = 'a:3:{s:3:"foo";i:1;s:3:"bar";s:5:"hello";s:3:"baz";b:1;}';
    expect(roundTrip(input)).toBe(input);
  });

  test('nested arrays', () => {
    const input = 'a:1:{s:3:"cfg";a:2:{i:0;b:1;i:1;N;}}';
    expect(roundTrip(input)).toBe(input);
  });

  test('keys stored as text; canonical integers re-serialize as int keys', () => {
    // PHP converts numeric string keys to ints, so s:1:"0" cannot survive as a string
    expect(roundTrip('a:1:{s:1:"0";s:1:"x";}')).toBe('a:1:{i:0;s:1:"x";}');
  });

  test('non-canonical numeric keys stay strings (PHP semantics)', () => {
    expect(roundTrip('a:1:{s:2:"07";s:1:"x";}')).toBe('a:1:{s:2:"07";s:1:"x";}');
    // one past PHP_INT_MAX is a string key (19 digits)
    expect(roundTrip('a:1:{s:19:"9223372036854775808";s:1:"x";}')).toBe(
      'a:1:{s:19:"9223372036854775808";s:1:"x";}'
    );
  });
});

describe('objects', () => {
  test('stdClass with one property', () => {
    const input = 'O:8:"stdClass":1:{s:3:"foo";s:1:"x";}';
    expect(roundTrip(input)).toBe(input);
  });

  test('empty object', () => {
    expect(roundTrip('O:8:"stdClass":0:{}')).toBe('O:8:"stdClass":0:{}');
  });

  test('non-stdClass class names are preserved', () => {
    const input = 'O:13:"WP_SomePlugin":1:{s:5:"count";i:3;}';
    expect(roundTrip(input)).toBe(input);
  });

  test('objects can hold nested arrays', () => {
    const input = 'O:8:"stdClass":1:{s:3:"cfg";a:1:{i:0;i:5;}}';
    expect(roundTrip(input)).toBe(input);
  });
});

describe('references', () => {
  test('r: value references round-trip as-is', () => {
    const input = 'a:2:{i:0;s:1:"a";i:1;r:2;}';
    expect(roundTrip(input)).toBe(input);
  });

  test('R: object references round-trip as-is', () => {
    const input = 'a:1:{i:0;R:1;}';
    expect(roundTrip(input)).toBe(input);
  });
});

describe('input tolerance', () => {
  test('surrounding whitespace is trimmed', () => {
    expect(roundTrip('  \n a:0:{} \n ')).toBe('a:0:{}');
  });

  test('a single trailing semicolon is tolerated', () => {
    expect(roundTrip('a:0:{};')).toBe('a:0:{}');
  });
});

describe('parse errors are meaningful', () => {
  test('empty input', () => {
    expect(() => parseSerialized('')).toThrow('Empty input');
    expect(() => parseSerialized('   ')).toThrow('Empty input');
  });

  test('garbage input', () => {
    expect(() => parseSerialized('garbage')).toThrow('unexpected token');
  });

  test('unbalanced arrays', () => {
    expect(() => parseSerialized('a:0:{')).toThrow();
    expect(() => parseSerialized('a:0:{}a:0:{}')).toThrow('trailing data');
  });

  test('declared count does not match content', () => {
    expect(() => parseSerialized('a:2:{i:0;s:1:"a";}')).toThrow();
  });

  test('string length does not match content', () => {
    expect(() => parseSerialized('s:3:"ab";')).toThrow();
  });

  test('custom-serialized objects (C:) are rejected with a clear message', () => {
    expect(() => parseSerialized('C:3:"Foo":5:{abcde}')).toThrow('custom-serialized');
  });

  test('error messages include a position', () => {
    expect(() => parseSerialized('a:1:{i:0;s:3:"ab";}')).toThrow(/position \d+/);
  });
});

describe('validateNode', () => {
  test('accepts valid scalars', () => {
    expect(validateNode({ type: 'int', value: '42' })).toBe('');
    expect(validateNode({ type: 'float', value: '1.5' })).toBe('');
    expect(validateNode({ type: 'float', value: 'INF' })).toBe('');
    expect(validateNode({ type: 'bool', value: 'true' })).toBe('');
  });

  test('rejects invalid scalars', () => {
    expect(validateNode({ type: 'int', value: 'abc' })).not.toBe('');
    expect(validateNode({ type: 'int', value: '1.5' })).not.toBe('');
    expect(validateNode({ type: 'float', value: 'xyz' })).not.toBe('');
    expect(validateNode({ type: 'bool', value: 'yes' })).not.toBe('');
  });
});

describe('isPhpInteger (PHP int-key semantics)', () => {
  test('canonical integers', () => {
    expect(isPhpInteger('0')).toBe(true);
    expect(isPhpInteger('42')).toBe(true);
    expect(isPhpInteger('-42')).toBe(true);
  });

  test('not integers', () => {
    expect(isPhpInteger('07')).toBe(false);
    expect(isPhpInteger('+1')).toBe(false);
    expect(isPhpInteger('1.5')).toBe(false);
    expect(isPhpInteger('9223372036854775808')).toBe(false);
    expect(isPhpInteger('-9223372036854775809')).toBe(false);
    expect(isPhpInteger('')).toBe(false);
    expect(isPhpInteger('abc')).toBe(false);
  });
});
