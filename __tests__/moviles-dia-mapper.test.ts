/**
 * Tests unitarios para lib/moviles/moviles-dia-mapper.ts
 *
 * Cubre la transformación de una fila moviles_dia → MovilData.
 *
 * Casos:
 *   1. Fila completa (todos los campos) → mapping correcto
 *   2. Fila sin GPS → currentPosition es undefined
 *   3. Fila de día pasado (tamano_lote/pendientes null, activo false) → sin crash, conteos en 0
 */

import { describe, it, expect } from 'vitest';
import { mapMovilDiaRowToMovilData, type MovilDiaRow } from '@/lib/moviles/moviles-dia-mapper';

const baseRow: MovilDiaRow = {
  escenario_id: 1,
  movil_id: 42,
  fecha: '2026-05-27',
  empresa_fletera_id: 3,
  matricula: 'ABC1234',
  descripcion: 'Movil Prueba',
  estado_nro: 1,
  estado_desc: 'ACTIVO',
  tamano_lote: 8,
  pedidos_pendientes: 3,
  services_pendientes: 2,
  last_gps_lat: -34.9,
  last_gps_lng: -56.1,
  last_gps_datetime: '2026-05-27T10:00:00Z',
  activo: true,
  oculto_operativo: false,
  inactivo_del_dia: false,
};

describe('mapMovilDiaRowToMovilData', () => {
  it('Caso 1: fila completa → todos los campos mapeados correctamente', () => {
    const result = mapMovilDiaRowToMovilData(baseRow);

    expect(result.id).toBe(42);
    expect(result.name).toBe('Movil Prueba');
    expect(result.matricula).toBe('ABC1234');
    expect(result.estadoNro).toBe(1);
    expect(result.estadoDesc).toBe('ACTIVO');
    expect(result.tamanoLote).toBe(8);
    expect(result.pedidosAsignados).toBe(3);
    expect(result.capacidad).toBe(3);
    expect(result.cant_ped).toBe(3);
    expect(result.cant_serv).toBe(2);
    expect(result.empresaFleteraId).toBe(3);
    expect(result.activo).toBe(true);
    expect(result.ocultoOperativo).toBe(false);
    expect(result.inactivoDelDia).toBe(false);

    // GPS presente → currentPosition definida con la forma MovilCoordinate
    expect(result.currentPosition).toBeDefined();
    expect(result.currentPosition?.coordX).toBe(-34.9);
    expect(result.currentPosition?.coordY).toBe(-56.1);
    expect(result.currentPosition?.fechaInsLog).toBe('2026-05-27T10:00:00Z');
  });

  it('Caso 2: fila sin GPS → currentPosition es undefined', () => {
    const row: MovilDiaRow = {
      ...baseRow,
      last_gps_lat: null,
      last_gps_lng: null,
      last_gps_datetime: null,
    };
    const result = mapMovilDiaRowToMovilData(row);
    expect(result.currentPosition).toBeUndefined();
  });

  it('Caso 2b: solo lat presente (lng null) → currentPosition es undefined', () => {
    const row: MovilDiaRow = {
      ...baseRow,
      last_gps_lat: -34.9,
      last_gps_lng: null,
      last_gps_datetime: null,
    };
    const result = mapMovilDiaRowToMovilData(row);
    expect(result.currentPosition).toBeUndefined();
  });

  it('Caso 3: fila de día pasado (nulls + activo false) → sin crash, conteos en 0', () => {
    const pastRow: MovilDiaRow = {
      escenario_id: 1,
      movil_id: 7,
      fecha: '2026-01-01',
      empresa_fletera_id: null,
      matricula: null,
      descripcion: null,
      estado_nro: null,
      estado_desc: null,
      tamano_lote: null,
      pedidos_pendientes: null,
      services_pendientes: null,
      last_gps_lat: null,
      last_gps_lng: null,
      last_gps_datetime: null,
      activo: false,
      oculto_operativo: false,
      inactivo_del_dia: true,
    };

    const result = mapMovilDiaRowToMovilData(pastRow);

    // No debe lanzar excepción
    expect(result.id).toBe(7);
    // Descripción null → fallback al id como string
    expect(result.name).toBe('7');
    expect(result.matricula).toBeUndefined();
    expect(result.estadoNro).toBeUndefined();
    expect(result.tamanoLote).toBeUndefined();
    // Counts con null → default 0
    expect(result.cant_ped).toBe(0);
    expect(result.cant_serv).toBe(0);
    expect(result.pedidosAsignados).toBe(0);
    expect(result.capacidad).toBe(0);
    expect(result.currentPosition).toBeUndefined();
    expect(result.activo).toBe(false);
    expect(result.inactivoDelDia).toBe(true);
  });

  // ── Color tests ──────────────────────────────────────────────────────────

  it('Color: estado_nro=3 → gris (#9CA3AF, NO ACTIVO)', () => {
    const result = mapMovilDiaRowToMovilData({ ...baseRow, estado_nro: 3 });
    expect(result.color).toBe('#9CA3AF');
  });

  it('Color: estado_nro=4 → violeta (#8B5CF6, BAJA MOMENTÁNEA)', () => {
    const result = mapMovilDiaRowToMovilData({ ...baseRow, estado_nro: 4 });
    expect(result.color).toBe('#8B5CF6');
  });

  it('Color: tamano_lote=4, pedidos_pendientes=4 → negro (#1F2937, lote completo)', () => {
    const result = mapMovilDiaRowToMovilData({
      ...baseRow,
      estado_nro: 1,
      tamano_lote: 4,
      pedidos_pendientes: 4,
    });
    expect(result.color).toBe('#1F2937');
  });

  it('Color: tamano_lote=4, pedidos_pendientes=1 → 75% disponible → verde (#22C55E)', () => {
    const result = mapMovilDiaRowToMovilData({
      ...baseRow,
      estado_nro: 1,
      tamano_lote: 4,
      pedidos_pendientes: 1,
    });
    expect(result.color).toBe('#22C55E');
  });

  it('Color: tamano_lote=4, pedidos_pendientes=3 → 25% disponible → amarillo (#F59E0B)', () => {
    const result = mapMovilDiaRowToMovilData({
      ...baseRow,
      estado_nro: 1,
      tamano_lote: 4,
      pedidos_pendientes: 3,
    });
    expect(result.color).toBe('#F59E0B');
  });
});
