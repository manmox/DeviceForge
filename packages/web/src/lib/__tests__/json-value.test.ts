import { describe, expect, it } from 'vitest';
import {
  defaultValueForType,
  isTemplateString,
  jsonValueType,
  parseNumberInput,
  uniqueKey,
} from '../json-value';

describe('jsonValueType', () => {
  it('detects JSON value types', () => {
    expect(jsonValueType(null)).toBe('null');
    expect(jsonValueType([])).toBe('array');
    expect(jsonValueType({})).toBe('object');
    expect(jsonValueType('text')).toBe('string');
    expect(jsonValueType(1.5)).toBe('number');
    expect(jsonValueType(true)).toBe('boolean');
  });
});

describe('defaultValueForType', () => {
  it('returns a usable empty value for each type', () => {
    expect(defaultValueForType('string')).toBe('');
    expect(defaultValueForType('number')).toBe(0);
    expect(defaultValueForType('boolean')).toBe(true);
    expect(defaultValueForType('null')).toBeNull();
    expect(defaultValueForType('object')).toEqual({});
    expect(defaultValueForType('array')).toEqual([]);
  });
});

describe('isTemplateString', () => {
  it('recognizes whole-value paths and interpolation', () => {
    expect(isTemplateString('$state.temp')).toBe(true);
    expect(isTemplateString('temp=${state.temp}')).toBe(true);
    expect(isTemplateString('plain text')).toBe(false);
    expect(isTemplateString('$5.00')).toBe(false);
    expect(isTemplateString('$unknown')).toBe(false);
    expect(isTemplateString(12)).toBe(false);
  });
});

describe('parseNumberInput', () => {
  it('accepts finite numbers and rejects empty/non-finite input', () => {
    expect(parseNumberInput('1.5')).toBe(1.5);
    expect(parseNumberInput('-2')).toBe(-2);
    expect(parseNumberInput('')).toBeNull();
    expect(parseNumberInput('NaN')).toBeNull();
    expect(parseNumberInput('Infinity')).toBeNull();
  });
});

describe('uniqueKey', () => {
  it('finds the next unused key', () => {
    expect(uniqueKey({}, 'key')).toBe('key');
    expect(uniqueKey({ key: 1 }, 'key')).toBe('key2');
    expect(uniqueKey({ key: 1, key2: 2 }, 'key')).toBe('key3');
  });

  it('only treats own properties as collisions', () => {
    expect(uniqueKey({}, 'toString')).toBe('toString');
  });
});
