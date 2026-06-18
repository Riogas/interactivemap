/**
 * Tests de deteccion de navegadores/SO legacy (sin soporte oklch).
 * Ver lib/browser-compat.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  parseChromeVersion,
  parseWindowsNtVersion,
  getBrowserCompatInfo,
  MIN_CHROME_VERSION,
} from './browser-compat';

// UAs de referencia
const UA_WIN7_CHROME_70 =
  'Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/70.0.3538.110 Safari/537.36';
const UA_WIN10_CHROME_125 =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const UA_WIN10_CHROME_70 =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/70.0.3538.110 Safari/537.36';
const UA_WIN7_CHROME_120 =
  'Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const UA_FIREFOX =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0';

describe('parseChromeVersion()', () => {
  it('extrae la version mayor de Chrome', () => {
    expect(parseChromeVersion(UA_WIN10_CHROME_125)).toBe(125);
    expect(parseChromeVersion(UA_WIN7_CHROME_70)).toBe(70);
  });
  it('null si no es Chrome', () => {
    expect(parseChromeVersion(UA_FIREFOX)).toBeNull();
    expect(parseChromeVersion('')).toBeNull();
  });
});

describe('parseWindowsNtVersion()', () => {
  it('extrae la version de Windows NT', () => {
    expect(parseWindowsNtVersion(UA_WIN7_CHROME_70)).toBe(6.1);
    expect(parseWindowsNtVersion(UA_WIN10_CHROME_125)).toBe(10.0);
  });
  it('null si no es Windows', () => {
    expect(parseWindowsNtVersion('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBeNull();
  });
});

describe('getBrowserCompatInfo()', () => {
  it('Windows 7 + Chrome viejo → legacy (ambos motivos)', () => {
    const info = getBrowserCompatInfo(UA_WIN7_CHROME_70);
    expect(info.isOldWindows).toBe(true);
    expect(info.isOldChrome).toBe(true);
    expect(info.isLegacy).toBe(true);
  });

  it('Windows 10 + Chrome moderno → NO legacy', () => {
    const info = getBrowserCompatInfo(UA_WIN10_CHROME_125);
    expect(info.isOldWindows).toBe(false);
    expect(info.isOldChrome).toBe(false);
    expect(info.isLegacy).toBe(false);
  });

  it('Windows 10 + Chrome viejo → legacy por Chrome', () => {
    const info = getBrowserCompatInfo(UA_WIN10_CHROME_70);
    expect(info.isOldWindows).toBe(false);
    expect(info.isOldChrome).toBe(true);
    expect(info.isLegacy).toBe(true);
  });

  it('Windows 7 + Chrome moderno → legacy por SO', () => {
    const info = getBrowserCompatInfo(UA_WIN7_CHROME_120);
    expect(info.isOldWindows).toBe(true);
    expect(info.isOldChrome).toBe(false);
    expect(info.isLegacy).toBe(true);
  });

  it('borde: Chrome exactamente en MIN_CHROME_VERSION no es viejo', () => {
    const ua = `Mozilla/5.0 (Windows NT 10.0) Chrome/${MIN_CHROME_VERSION}.0.0.0 Safari/537.36`;
    expect(getBrowserCompatInfo(ua).isOldChrome).toBe(false);
  });
});
