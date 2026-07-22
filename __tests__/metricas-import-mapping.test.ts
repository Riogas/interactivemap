/**
 * Tests de call-site (AC2/AC14): importa los transformers REALES de
 * app/api/import/pedidos/route.ts y app/api/import/services/route.ts y
 * asserta el mapping de fch_hora_asignado (presente / ausente→null /
 * fallback snake_case) sin alterar otros campos del transform existente.
 *
 * Mocks de supabase/auth-middleware/zonas-cap-entrega: los route.ts importan
 * esos módulos a nivel top-level (getServerSupabaseClient crea el cliente al
 * importar lib/supabase.ts) — se mockean para poder importar el módulo sin
 * tocar red/env real (lección del repo: supabase-tests-require-mocks).
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn() },
  getServerSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/auth-middleware', () => ({
  requireApiKey: vi.fn(),
}));

vi.mock('@/lib/zonas-cap-entrega', () => ({
  recomputeMovilAndCapEntrega: vi.fn(),
}));

import { transformPedidoToSupabase } from '@/app/api/import/pedidos/route';
import { transformServiceToSupabase } from '@/app/api/import/services/route';

describe('transformPedidoToSupabase() — mapping fch_hora_asignado (AC2)', () => {
  it('payload con FchHoraAsignado (PascalCase) → mapeado', () => {
    const pedido = { id: 1, escenario: 1, FchHoraAsignado: '2026-07-21T14:00:00Z' };
    const result = transformPedidoToSupabase(pedido);
    expect(result.fch_hora_asignado).toBe('2026-07-21T14:00:00Z');
  });

  it('payload SIN FchHoraAsignado (estado actual del sender) → null, resto del import intacto', () => {
    const pedido = {
      id: 1,
      escenario: 1,
      ClienteNombre: 'Juan Perez',
      ServicioNombre: 'URGENTE',
      Movil: 40,
    };
    const result = transformPedidoToSupabase(pedido);
    expect(result.fch_hora_asignado).toBeNull();
    // Otros campos del mapping siguen funcionando sin regresión.
    expect(result.cliente_nombre).toBe('Juan Perez');
    expect(result.servicio_nombre).toBe('URGENTE');
    expect(result.movil).toBe(40);
  });

  it('fallback snake_case (fch_hora_asignado) cuando no viene FchHoraAsignado', () => {
    const pedido = { id: 1, escenario: 1, fch_hora_asignado: '2026-07-21T09:00:00Z' };
    const result = transformPedidoToSupabase(pedido);
    expect(result.fch_hora_asignado).toBe('2026-07-21T09:00:00Z');
  });

  it('fecha inválida de AS400 (0000-00-00) → null (misma regla que fch_hora_finalizacion)', () => {
    const pedido = { id: 1, escenario: 1, FchHoraAsignado: '0000-00-00T00:00:00' };
    const result = transformPedidoToSupabase(pedido);
    expect(result.fch_hora_asignado).toBeNull();
  });

  it('PascalCase tiene prioridad sobre snake_case cuando ambos vienen', () => {
    const pedido = {
      id: 1,
      escenario: 1,
      FchHoraAsignado: '2026-07-21T14:00:00Z',
      fch_hora_asignado: '2026-07-21T09:00:00Z',
    };
    const result = transformPedidoToSupabase(pedido);
    expect(result.fch_hora_asignado).toBe('2026-07-21T14:00:00Z');
  });
});

describe('transformServiceToSupabase() — mapping fch_hora_asignado (AC2)', () => {
  it('payload con FchHoraAsignado (PascalCase) → mapeado', () => {
    const service = { id: 1, escenario: 1, FchHoraAsignado: '2026-07-21T14:00:00Z' };
    const result = transformServiceToSupabase(service);
    expect(result.fch_hora_asignado).toBe('2026-07-21T14:00:00Z');
  });

  it('payload SIN FchHoraAsignado → null, resto del import intacto', () => {
    const service = {
      id: 1,
      escenario: 1,
      ClienteNombre: 'Maria Lopez',
      Movil: 55,
    };
    const result = transformServiceToSupabase(service);
    expect(result.fch_hora_asignado).toBeNull();
    expect(result.cliente_nombre).toBe('Maria Lopez');
    expect(result.movil).toBe(55);
    expect(result.tipo).toBe('Services'); // default existente, no debe romperse
  });

  it('fallback snake_case (fch_hora_asignado) cuando no viene FchHoraAsignado', () => {
    const service = { id: 1, escenario: 1, fch_hora_asignado: '2026-07-21T09:00:00Z' };
    const result = transformServiceToSupabase(service);
    expect(result.fch_hora_asignado).toBe('2026-07-21T09:00:00Z');
  });

  it('fecha inválida de AS400 (0000-00-00) → null', () => {
    const service = { id: 1, escenario: 1, FchHoraAsignado: '0000-00-00T00:00:00' };
    const result = transformServiceToSupabase(service);
    expect(result.fch_hora_asignado).toBeNull();
  });
});
