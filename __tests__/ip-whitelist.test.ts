/**
 * Tests para lib/ip-whitelist.ts
 *
 * Cubre: isValidIpPattern, ipPatternToRegex, ipMatchesAnyPattern
 */

import { describe, it, expect } from 'vitest';
import { isValidIpPattern, ipPatternToRegex, ipMatchesAnyPattern } from '@/lib/ip-whitelist';

// ==============================================================================
// isValidIpPattern
// ==============================================================================

describe('isValidIpPattern', () => {
  describe('patrones validos', () => {
    it('acepta IP exacta', () => {
      expect(isValidIpPattern('192.168.1.5')).toBe(true);
    });

    it('acepta wildcard en ultimo octeto', () => {
      expect(isValidIpPattern('10.0.0.*')).toBe(true);
    });

    it('acepta wildcard en penultimo y ultimo octeto', () => {
      expect(isValidIpPattern('192.168.*.*')).toBe(true);
    });

    it('acepta wildcard en todos los octetos', () => {
      expect(isValidIpPattern('*.*.*.*')).toBe(true);
    });

    it('acepta loopback', () => {
      expect(isValidIpPattern('127.0.0.1')).toBe(true);
    });

    it('acepta octeto 0', () => {
      expect(isValidIpPattern('0.0.0.0')).toBe(true);
    });

    it('acepta octeto 255', () => {
      expect(isValidIpPattern('255.255.255.255')).toBe(true);
    });

    it('acepta mix wildcard y numerico', () => {
      expect(isValidIpPattern('172.16.*.*')).toBe(true);
    });
  });

  describe('patrones invalidos', () => {
    it('rechaza string vacio', () => {
      expect(isValidIpPattern('')).toBe(false);
    });

    it('rechaza null', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(isValidIpPattern(null as any)).toBe(false);
    });

    it('rechaza IP con solo 3 octetos', () => {
      expect(isValidIpPattern('192.168.1')).toBe(false);
    });

    it('rechaza IP con 5 octetos', () => {
      expect(isValidIpPattern('192.*.*.*.5')).toBe(false);
    });

    it('rechaza octeto 256', () => {
      expect(isValidIpPattern('192.168.*.256')).toBe(false);
    });

    it('rechaza octeto negativo', () => {
      expect(isValidIpPattern('192.168.*.-1')).toBe(false);
    });

    it('rechaza letras en octeto', () => {
      expect(isValidIpPattern('abc')).toBe(false);
    });

    it('rechaza octeto con letras mezcladas', () => {
      expect(isValidIpPattern('192.168.1.abc')).toBe(false);
    });

    it('rechaza doble wildcard en mismo octeto', () => {
      expect(isValidIpPattern('192.168.**.1')).toBe(false);
    });

    it('rechaza formato CIDR', () => {
      expect(isValidIpPattern('192.168.0.0/24')).toBe(false);
    });

    it('rechaza octeto con ceros a la izquierda', () => {
      expect(isValidIpPattern('192.168.01.1')).toBe(false);
    });

    it('rechaza ceros a la izquierda en 007', () => {
      expect(isValidIpPattern('007.0.0.1')).toBe(false);
    });
  });
});

// ==============================================================================
// ipPatternToRegex
// ==============================================================================

describe('ipPatternToRegex', () => {
  describe('192.168.*.*', () => {
    const re = ipPatternToRegex('192.168.*.*');

    it('matchea 192.168.1.5', () => {
      expect(re.test('192.168.1.5')).toBe(true);
    });

    it('matchea 192.168.255.255', () => {
      expect(re.test('192.168.255.255')).toBe(true);
    });

    it('matchea 192.168.0.0', () => {
      expect(re.test('192.168.0.0')).toBe(true);
    });

    it('no matchea 10.0.0.1 (prefijo diferente)', () => {
      expect(re.test('10.0.0.1')).toBe(false);
    });

    it('no matchea 192.169.1.1 (segundo octeto diferente)', () => {
      expect(re.test('192.169.1.1')).toBe(false);
    });

    it('no matchea IP con octeto > 255 (seria string invalido pero no matchea)', () => {
      expect(re.test('192.168.1.256')).toBe(false);
    });

    it('no matchea string vacio', () => {
      expect(re.test('')).toBe(false);
    });

    it('no matchea IPv6', () => {
      expect(re.test('::1')).toBe(false);
    });
  });

  describe('10.0.0.*', () => {
    const re = ipPatternToRegex('10.0.0.*');

    it('matchea 10.0.0.1', () => {
      expect(re.test('10.0.0.1')).toBe(true);
    });

    it('matchea 10.0.0.254', () => {
      expect(re.test('10.0.0.254')).toBe(true);
    });

    it('no matchea 10.0.1.1 (tercer octeto diferente)', () => {
      expect(re.test('10.0.1.1')).toBe(false);
    });
  });

  describe('*.*.*.*', () => {
    const re = ipPatternToRegex('*.*.*.*');

    it('matchea cualquier IP valida', () => {
      expect(re.test('1.2.3.4')).toBe(true);
      expect(re.test('255.255.255.255')).toBe(true);
      expect(re.test('0.0.0.0')).toBe(true);
    });

    it('no matchea octeto 256', () => {
      expect(re.test('1.2.3.256')).toBe(false);
    });
  });

  describe('IP exacta (127.0.0.1)', () => {
    const re = ipPatternToRegex('127.0.0.1');

    it('matchea exactamente 127.0.0.1', () => {
      expect(re.test('127.0.0.1')).toBe(true);
    });

    it('no matchea 127.0.0.2', () => {
      expect(re.test('127.0.0.2')).toBe(false);
    });
  });
});

// ==============================================================================
// ipMatchesAnyPattern
// ==============================================================================

describe('ipMatchesAnyPattern', () => {
  it('retorna false con array vacio', () => {
    expect(ipMatchesAnyPattern('192.168.1.5', [])).toBe(false);
  });

  it('retorna true si la IP matchea el unico patron', () => {
    expect(ipMatchesAnyPattern('192.168.1.5', ['192.168.*.*'])).toBe(true);
  });

  it('retorna false si la IP no matchea ningun patron', () => {
    expect(ipMatchesAnyPattern('10.0.0.1', ['192.168.*.*'])).toBe(false);
  });

  it('retorna true si la IP matchea al menos uno de varios patrones', () => {
    expect(ipMatchesAnyPattern('10.0.0.1', ['192.168.*.*', '10.0.0.*'])).toBe(true);
  });

  it('ignora patrones invalidos silenciosamente', () => {
    // El patron invalido se ignora, el valido aplica
    expect(ipMatchesAnyPattern('10.0.0.1', ['INVALID', '10.0.0.*'])).toBe(true);
  });

  it('retorna false si solo hay patrones invalidos', () => {
    expect(ipMatchesAnyPattern('10.0.0.1', ['INVALID', 'abc.def'])).toBe(false);
  });

  it('retorna false con IP vacia', () => {
    expect(ipMatchesAnyPattern('', ['*.*.*.*'])).toBe(false);
  });

  it('retorna false con null como IP', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(ipMatchesAnyPattern(null as any, ['*.*.*.*'])).toBe(false);
  });

  it('matchea con patron wildcard total', () => {
    expect(ipMatchesAnyPattern('8.8.8.8', ['*.*.*.*'])).toBe(true);
  });

  it('retorna false para IP fuera de rango cuando patron tiene wildcards', () => {
    // 256 no es un octeto valido — el regex de wildcard valida 0-255
    expect(ipMatchesAnyPattern('192.168.1.256', ['192.168.*.*'])).toBe(false);
  });

  it('multiple matches devuelve true al primer match', () => {
    // Ambos patrones matchean — debe retornar true
    expect(ipMatchesAnyPattern('192.168.5.5', ['192.168.*.*', '192.168.5.*'])).toBe(true);
  });

  it('patron con un solo wildcard al final', () => {
    expect(ipMatchesAnyPattern('172.16.0.1', ['172.16.0.*'])).toBe(true);
    expect(ipMatchesAnyPattern('172.16.1.1', ['172.16.0.*'])).toBe(false);
  });
});
