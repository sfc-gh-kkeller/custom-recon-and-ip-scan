import { describe, expect, it } from 'vitest';
import { bucketMinutes, num, parseWindow } from '../../lib/scanner';

describe('parseWindow', () => {
  it('accepts the supported windows', () => {
    for (const w of [15, 30, 60, 180, 720]) expect(parseWindow(String(w))).toBe(w);
  });
  it('falls back to 60 for anything else, so SQL never sees arbitrary input', () => {
    for (const bad of [null, '', 'abc', '61', '-5', '60; DROP TABLE x', '1e9']) expect(parseWindow(bad)).toBe(60);
  });
});

describe('bucketMinutes', () => {
  it('uses coarser buckets for longer windows', () => {
    expect(bucketMinutes(15)).toBe(1);
    expect(bucketMinutes(60)).toBe(1);
    expect(bucketMinutes(180)).toBe(5);
    expect(bucketMinutes(720)).toBe(15);
  });
});

describe('num', () => {
  it('converts numeric strings and guards against junk', () => {
    expect(num('42')).toBe(42);
    expect(num(7)).toBe(7);
    expect(num(null)).toBe(0);
    expect(num('x')).toBe(0);
  });
});
