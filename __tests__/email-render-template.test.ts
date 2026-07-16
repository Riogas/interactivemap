/**
 * Tests para lib/email.ts — renderTemplate()
 *
 * Unit: sustituye todas las variables soportadas y deja intactas las
 * desconocidas (spec: "Notificación de incidentes por correo").
 */
import { describe, it, expect, vi } from 'vitest';

// lib/email.ts importa '@/lib/supabase' a nivel de módulo (crea el cliente),
// que a su vez requiere variables de entorno de Supabase. Mockeamos para
// poder testear renderTemplate() en aislamiento sin necesitar .env real.
vi.mock('@/lib/supabase', () => ({
  getServerSupabaseClient: vi.fn(),
}));

import { renderTemplate, DEFAULT_EMAIL_SETTINGS } from '@/lib/email';

describe('renderTemplate', () => {
  it('sustituye una única variable', () => {
    const result = renderTemplate('Incidente #{{id}}', { id: '42' });
    expect(result).toBe('Incidente #42');
  });

  it('sustituye todas las variables soportadas (id, usuario, reporter, celular, email, descripcion, fecha, link)', () => {
    const tpl = '{{id}}|{{usuario}}|{{reporter}}|{{celular}}|{{email}}|{{descripcion}}|{{fecha}}|{{link}}';
    const vars = {
      id: '7',
      usuario: 'jgomez',
      reporter: 'Juan Perez',
      celular: '099123456',
      email: 'juan@ejemplo.com',
      descripcion: 'Se rompio el GPS',
      fecha: '2026-07-08 10:00',
      link: 'https://track.example.com/admin/incidencias?id=7',
    };
    const result = renderTemplate(tpl, vars);
    expect(result).toBe(
      '7|jgomez|Juan Perez|099123456|juan@ejemplo.com|Se rompio el GPS|2026-07-08 10:00|https://track.example.com/admin/incidencias?id=7',
    );
  });

  it('deja intactas las variables desconocidas (sin match en vars)', () => {
    const result = renderTemplate('Hola {{nombre}}, incidente {{id}}', { id: '1' });
    expect(result).toBe('Hola {{nombre}}, incidente 1');
  });

  it('reemplaza la misma variable repetida varias veces', () => {
    const result = renderTemplate('{{id}} - {{id}} - {{id}}', { id: '5' });
    expect(result).toBe('5 - 5 - 5');
  });

  it('tolera espacios dentro de las llaves ({{ id }})', () => {
    const result = renderTemplate('Incidente #{{ id }}', { id: '9' });
    expect(result).toBe('Incidente #9');
  });

  it('renderiza correctamente la plantilla default de asunto', () => {
    const result = renderTemplate(DEFAULT_EMAIL_SETTINGS.subjectTemplate, { id: '123' });
    expect(result).toBe('Nuevo incidente #123 en TrackMovil');
  });

  it('renderiza correctamente la plantilla default de cuerpo', () => {
    const vars = {
      id: '1',
      usuario: 'operador1',
      reporter: 'Reporta Juan',
      celular: '099000000',
      email: 'a@b.com',
      descripcion: 'Descripcion del incidente',
      fecha: '08/07/2026 10:00',
      link: 'https://track.example.com/admin/incidencias?id=1',
    };
    const result = renderTemplate(DEFAULT_EMAIL_SETTINGS.bodyTemplate, vars);
    expect(result).toContain('Se reportó un incidente el 08/07/2026 10:00.');
    expect(result).toContain('Usuario: operador1');
    expect(result).toContain('Reporta: Reporta Juan');
    expect(result).toContain('Celular: 099000000');
    expect(result).toContain('Email: a@b.com');
    expect(result).toContain('Descripcion del incidente');
    expect(result).toContain('https://track.example.com/admin/incidencias?id=1');
  });
});
