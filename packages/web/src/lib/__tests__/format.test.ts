import { describe, expect, it } from 'vitest';
import { summarizeDecoded } from '../format';

describe('summarizeDecoded', () => {
  it('prefers the text codec summary', () => {
    expect(
      summarizeDecoded({
        _message: 'report',
        _summary: '数据上报 · dataCount=3 · sequence=3',
        groups: [{ id: '000' }, { id: '010' }, { id: '089' }],
      }),
    ).toBe('数据上报 · dataCount=3 · sequence=3');
  });

  it('keeps the existing field summary for raw/fields codecs', () => {
    expect(summarizeDecoded({ cmd: 1, temp: 25.5 })).toBe('cmd=1  temp=25.5');
    expect(summarizeDecoded({ kind: 'report', value: 1 })).toBe(
      'kind=report  value=1',
    );
  });
});
