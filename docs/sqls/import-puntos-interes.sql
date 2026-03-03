-- ============================================================================
-- Puntos de Interés de Uruguay - Datos Reales para TrackMovil
-- ============================================================================
-- Tabla destino: puntos_interes
-- Total de registros: 62
-- Categorías: Plantas Riogas, Puntos de Venta, Intendencias, Sanatorios, Complejos
-- Fuentes: Google Maps, Wikipedia, riogas.com.uy
-- Fecha: 2025-07-28
-- ============================================================================
-- Ejecutar con:
--   docker exec -i supabase-db psql -U postgres -d postgres -f /tmp/import-puntos-interes.sql
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. PLANTAS Y DEPÓSITOS RIOGAS (🏭)
-- ============================================================================
INSERT INTO puntos_interes (nombre, descripcion, icono, latitud, longitud, tipo, visible, usuario_email)
VALUES
  ('Planta Principal Riogas - Maroñas',
   'Planta de envasado principal. Cno. Francisco Lecocq 1013, Montevideo',
   '🏭', -34.81964200, -56.23838470, 'publico', true, 'sistema@trackmovil.com'),

  ('Depósito Riogas - Garzón',
   'Centro de distribución. Av. Gral. Eugenio Garzón 1651, Montevideo',
   '🏭', -34.81348980, -56.22089130, 'publico', true, 'sistema@trackmovil.com'),

  ('Depósito Riogas - Las Piedras',
   'Centro logístico y distribución, Canelones',
   '🏭', -34.72830000, -56.22170000, 'publico', true, 'sistema@trackmovil.com'),

  ('Depósito Riogas - Maldonado',
   'Centro logístico y distribución, Maldonado',
   '🏭', -34.90930000, -54.95850000, 'publico', true, 'sistema@trackmovil.com'),

  ('Depósito Riogas - Salto',
   'Centro logístico y distribución, Salto',
   '🏭', -31.38830000, -57.96080000, 'publico', true, 'sistema@trackmovil.com'),

  ('Depósito Riogas - Tacuarembó',
   'Centro logístico y distribución, Tacuarembó',
   '🏭', -31.71420000, -55.98360000, 'publico', true, 'sistema@trackmovil.com')
ON CONFLICT (usuario_email, nombre) DO UPDATE SET
  descripcion = EXCLUDED.descripcion,
  icono = EXCLUDED.icono,
  latitud = EXCLUDED.latitud,
  longitud = EXCLUDED.longitud,
  tipo = EXCLUDED.tipo,
  visible = EXCLUDED.visible,
  updated_at = NOW();

-- ============================================================================
-- 2. PUNTOS DE VENTA RIOGAS (🔵)
-- ============================================================================
INSERT INTO puntos_interes (nombre, descripcion, icono, latitud, longitud, tipo, visible, usuario_email)
VALUES
  ('Riogas Lezica',
   'Punto de venta. C. Guanahani 1661, Montevideo',
   '🔵', -34.80041830, -56.25357540, 'publico', true, 'sistema@trackmovil.com'),

  ('Riogas 11 Águilas',
   'Punto de venta. Cno. Gral. Máximo Santos 5235, Montevideo',
   '🔵', -34.82354460, -56.22042460, 'publico', true, 'sistema@trackmovil.com'),

  ('Riogas Garzón',
   'Punto de venta. Av. Gral. Eugenio Garzón 162, Montevideo',
   '🔵', -34.85151790, -56.22390750, 'publico', true, 'sistema@trackmovil.com'),

  ('Riogas Paso de la Arena',
   'Punto de venta (Arenagas). Eduardo Paz Aguirre, Montevideo',
   '🔵', -34.83790760, -56.26299400, 'publico', true, 'sistema@trackmovil.com'),

  ('Riogas Las Chancles',
   'Punto de venta. Antonio María Márquez 5841, Montevideo',
   '🔵', -34.81554990, -56.23203280, 'publico', true, 'sistema@trackmovil.com'),

  ('Riogas Villa Colón',
   'Punto de venta. C. Pinta 1874bis, Montevideo',
   '🔵', -34.79851580, -56.24757320, 'publico', true, 'sistema@trackmovil.com'),

  ('Riogas Paysandú',
   'Punto de venta y distribución, Paysandú',
   '🔵', -32.32050000, -58.07350000, 'publico', true, 'sistema@trackmovil.com'),

  ('Riogas Mercedes',
   'Punto de venta y distribución, Soriano',
   '🔵', -33.25210000, -58.03160000, 'publico', true, 'sistema@trackmovil.com')
ON CONFLICT (usuario_email, nombre) DO UPDATE SET
  descripcion = EXCLUDED.descripcion,
  icono = EXCLUDED.icono,
  latitud = EXCLUDED.latitud,
  longitud = EXCLUDED.longitud,
  tipo = EXCLUDED.tipo,
  visible = EXCLUDED.visible,
  updated_at = NOW();

-- ============================================================================
-- 3. INTENDENCIAS DEPARTAMENTALES (🏛️) - 19 departamentos
-- ============================================================================
INSERT INTO puntos_interes (nombre, descripcion, icono, latitud, longitud, tipo, visible, usuario_email)
VALUES
  ('Intendencia de Montevideo',
   'Palacio Municipal, 18 de Julio 1360, Montevideo',
   '🏛️', -34.90592000, -56.18628000, 'publico', true, 'sistema@trackmovil.com'),

  ('Intendencia de Canelones',
   'Treinta y Tres esq. José Pedro Varela, Canelones',
   '🏛️', -34.52280000, -56.27830000, 'publico', true, 'sistema@trackmovil.com'),

  ('Intendencia de Maldonado',
   'Sarandí y Dodera, Maldonado',
   '🏛️', -34.90970000, -54.95700000, 'publico', true, 'sistema@trackmovil.com'),

  ('Intendencia de Rocha',
   'General Artigas y 25 de Agosto, Rocha',
   '🏛️', -34.48330000, -54.30000000, 'publico', true, 'sistema@trackmovil.com'),

  ('Intendencia de Colonia',
   'Av. Gral. Flores 481, Colonia del Sacramento',
   '🏛️', -34.46260000, -57.84000000, 'publico', true, 'sistema@trackmovil.com'),

  ('Intendencia de Soriano',
   'Colón y Rodó, Mercedes',
   '🏛️', -33.25130000, -58.03440000, 'publico', true, 'sistema@trackmovil.com'),

  ('Intendencia de Paysandú',
   '18 de Julio y Zorrilla de San Martín, Paysandú',
   '🏛️', -32.32140000, -58.07560000, 'publico', true, 'sistema@trackmovil.com'),

  ('Intendencia de Salto',
   'Uruguay y Treinta y Tres, Salto',
   '🏛️', -31.38830000, -57.96080000, 'publico', true, 'sistema@trackmovil.com'),

  ('Intendencia de Artigas',
   'Lecueder y Rivera, Artigas',
   '🏛️', -30.40280000, -56.47360000, 'publico', true, 'sistema@trackmovil.com'),

  ('Intendencia de Rivera',
   'Av. Sarandí 543, Rivera',
   '🏛️', -30.90500000, -55.55000000, 'publico', true, 'sistema@trackmovil.com'),

  ('Intendencia de Tacuarembó',
   '18 de Julio 162, Tacuarembó',
   '🏛️', -31.71000000, -55.98000000, 'publico', true, 'sistema@trackmovil.com'),

  ('Intendencia de Cerro Largo',
   'Javier de Viana y Juan A. Lavalleja, Melo',
   '🏛️', -32.36670000, -54.16670000, 'publico', true, 'sistema@trackmovil.com'),

  ('Intendencia de Treinta y Tres',
   'Juan Antonio Lavalleja y Pablo Zufriategui, Treinta y Tres',
   '🏛️', -33.23330000, -54.38330000, 'publico', true, 'sistema@trackmovil.com'),

  ('Intendencia de Lavalleja',
   'Sarandí y Juan Antonio Lavalleja, Minas',
   '🏛️', -34.37500000, -55.23330000, 'publico', true, 'sistema@trackmovil.com'),

  ('Intendencia de Florida',
   'Independencia y Barreiro, Florida',
   '🏛️', -34.09560000, -56.21530000, 'publico', true, 'sistema@trackmovil.com'),

  ('Intendencia de Durazno',
   'Dr. Luis A. de Herrera y Rivera, Durazno',
   '🏛️', -33.38670000, -56.52330000, 'publico', true, 'sistema@trackmovil.com'),

  ('Intendencia de Flores',
   'Treinta y Tres y Florencio Sánchez, Trinidad',
   '🏛️', -33.51440000, -56.89940000, 'publico', true, 'sistema@trackmovil.com'),

  ('Intendencia de San José',
   '25 de Mayo y Asamblea, San José de Mayo',
   '🏛️', -34.33780000, -56.71330000, 'publico', true, 'sistema@trackmovil.com'),

  ('Intendencia de Río Negro',
   'Treinta y Tres y Lavalleja, Fray Bentos',
   '🏛️', -33.11670000, -58.30220000, 'publico', true, 'sistema@trackmovil.com')
ON CONFLICT (usuario_email, nombre) DO UPDATE SET
  descripcion = EXCLUDED.descripcion,
  icono = EXCLUDED.icono,
  latitud = EXCLUDED.latitud,
  longitud = EXCLUDED.longitud,
  tipo = EXCLUDED.tipo,
  visible = EXCLUDED.visible,
  updated_at = NOW();

-- ============================================================================
-- 4. SANATORIOS Y HOSPITALES GRANDES (🏥)
-- ============================================================================
INSERT INTO puntos_interes (nombre, descripcion, icono, latitud, longitud, tipo, visible, usuario_email)
VALUES
  ('Hospital de Clínicas Dr. Manuel Quintela',
   'Hospital universitario público. Av. Italia s/n, Montevideo',
   '🏥', -34.88150000, -56.16340000, 'publico', true, 'sistema@trackmovil.com'),

  ('Hospital Maciel',
   'Hospital público ASSE. 25 de Mayo 174, Ciudad Vieja, Montevideo',
   '🏥', -34.90860000, -56.20240000, 'publico', true, 'sistema@trackmovil.com'),

  ('Hospital Pasteur',
   'Hospital público ASSE. Larravide 2458, Montevideo',
   '🏥', -34.86280000, -56.11860000, 'publico', true, 'sistema@trackmovil.com'),

  ('Hospital Italiano Umberto I',
   'Hospital mutualista. Bvar. Artigas 1632, Montevideo',
   '🏥', -34.89800000, -56.17600000, 'publico', true, 'sistema@trackmovil.com'),

  ('Hospital Pereira Rossell',
   'Hospital pediátrico y de la mujer ASSE. Bvar. Artigas 1550, Montevideo',
   '🏥', -34.89470000, -56.17470000, 'publico', true, 'sistema@trackmovil.com'),

  ('Sanatorio CASMU',
   'Centro de asistencia mutualista. 8 de Octubre 3310, Montevideo',
   '🏥', -34.87250000, -56.14390000, 'publico', true, 'sistema@trackmovil.com'),

  ('Hospital Británico',
   'Hospital mutualista. Av. Italia 2420, Montevideo',
   '🏥', -34.88400000, -56.15800000, 'publico', true, 'sistema@trackmovil.com'),

  ('Médica Uruguaya (MUCAM)',
   'Sede central mutualista. José Ellauri 857, Montevideo',
   '🏥', -34.91160000, -56.16480000, 'publico', true, 'sistema@trackmovil.com'),

  ('Asociación Española',
   'Hospital mutualista. Bvar. Artigas 1515, Montevideo',
   '🏥', -34.89360000, -56.17280000, 'publico', true, 'sistema@trackmovil.com'),

  ('Hospital Evangélico',
   'Hospital mutualista. Millán 4520, Montevideo',
   '🏥', -34.85830000, -56.18860000, 'publico', true, 'sistema@trackmovil.com'),

  ('Hospital Militar',
   'Hospital militar. Av. 8 de Octubre 3020, Montevideo',
   '🏥', -34.87500000, -56.14750000, 'publico', true, 'sistema@trackmovil.com'),

  ('Sanatorio Americano (SMI)',
   'Sociedad Médica Internacional. Gral. Urquiza 3314, Montevideo',
   '🏥', -34.87330000, -56.14610000, 'publico', true, 'sistema@trackmovil.com'),

  ('Hospital Policial',
   'Hospital del Ministerio del Interior. Av. 8 de Octubre 2760, Montevideo',
   '🏥', -34.87830000, -56.15250000, 'publico', true, 'sistema@trackmovil.com'),

  ('Hospital de Salto',
   'Hospital Regional ASSE. Viera y Agraciada, Salto',
   '🏥', -31.38440000, -57.95890000, 'publico', true, 'sistema@trackmovil.com'),

  ('Hospital de Paysandú',
   'Hospital Regional ASSE. Montevideo y Gral. Leandro Gómez, Paysandú',
   '🏥', -32.31970000, -58.07800000, 'publico', true, 'sistema@trackmovil.com'),

  ('Hospital de Maldonado',
   'Hospital Regional ASSE. Ventura Alegre esq. Rafael, Maldonado',
   '🏥', -34.90750000, -54.96580000, 'publico', true, 'sistema@trackmovil.com')
ON CONFLICT (usuario_email, nombre) DO UPDATE SET
  descripcion = EXCLUDED.descripcion,
  icono = EXCLUDED.icono,
  latitud = EXCLUDED.latitud,
  longitud = EXCLUDED.longitud,
  tipo = EXCLUDED.tipo,
  visible = EXCLUDED.visible,
  updated_at = NOW();

-- ============================================================================
-- 5. COMPLEJOS HABITACIONALES (🏢)
-- ============================================================================
INSERT INTO puntos_interes (nombre, descripcion, icono, latitud, longitud, tipo, visible, usuario_email)
VALUES
  ('Complejo Habitacional Euskal Erria 71',
   'Gran complejo de viviendas BHU. Paso de la Arena, Montevideo',
   '🏢', -34.83390000, -56.25230000, 'publico', true, 'sistema@trackmovil.com'),

  ('Complejo Habitacional Bulevar',
   'Torres BHU. Bvar. Artigas y Garibaldi, Montevideo',
   '🏢', -34.89430000, -56.17280000, 'publico', true, 'sistema@trackmovil.com'),

  ('Complejo Habitacional Cerro Norte',
   'Complejo de viviendas en barrio Cerro, Montevideo',
   '🏢', -34.87780000, -56.23060000, 'publico', true, 'sistema@trackmovil.com'),

  ('Complejo Habitacional Malvín Norte',
   'Conjunto de edificios de vivienda, Malvín Norte, Montevideo',
   '🏢', -34.86830000, -56.13280000, 'publico', true, 'sistema@trackmovil.com'),

  ('Complejo Habitacional Casavalle',
   'Conjunto habitacional zona Casavalle, Montevideo',
   '🏢', -34.84330000, -56.15500000, 'publico', true, 'sistema@trackmovil.com'),

  ('Complejo Habitacional Piedras Blancas',
   'Conjunto de viviendas en Piedras Blancas, Montevideo',
   '🏢', -34.84170000, -56.12750000, 'publico', true, 'sistema@trackmovil.com'),

  ('Complejo Habitacional Jardines del Hipódromo',
   'Conjunto de viviendas en Jardines del Hipódromo, Montevideo',
   '🏢', -34.85420000, -56.14190000, 'publico', true, 'sistema@trackmovil.com'),

  ('Torres del Puerto',
   'Complejo residencial moderno. Rambla 25 de Agosto, Ciudad Vieja, Montevideo',
   '🏢', -34.90420000, -56.20670000, 'publico', true, 'sistema@trackmovil.com')
ON CONFLICT (usuario_email, nombre) DO UPDATE SET
  descripcion = EXCLUDED.descripcion,
  icono = EXCLUDED.icono,
  latitud = EXCLUDED.latitud,
  longitud = EXCLUDED.longitud,
  tipo = EXCLUDED.tipo,
  visible = EXCLUDED.visible,
  updated_at = NOW();

COMMIT;

-- ============================================================================
-- VERIFICACIÓN
-- ============================================================================
SELECT
  CASE
    WHEN icono = '🏭' THEN 'Planta/Depósito Riogas'
    WHEN icono = '🔵' THEN 'Punto de Venta Riogas'
    WHEN icono = '🏛️' THEN 'Intendencia Departamental'
    WHEN icono = '🏥' THEN 'Sanatorio/Hospital'
    WHEN icono = '🏢' THEN 'Complejo Habitacional'
    ELSE 'Otro'
  END AS categoria,
  COUNT(*) AS cantidad
FROM puntos_interes
WHERE usuario_email = 'sistema@trackmovil.com'
GROUP BY icono
ORDER BY cantidad DESC;

SELECT COUNT(*) AS total_puntos_importados
FROM puntos_interes
WHERE usuario_email = 'sistema@trackmovil.com';
