-- =============================================================================
-- IMPORT: Puntos de Interés - Distribuidores
-- Tabla: puntos_interes
-- Fuente: DISTID / DISTNOM / DISTGEOX / DISTGEOY
-- Mapeo: nombre=DISTNOM, latitud=DISTGEOX, longitud=DISTGEOY
--        tipo='publico', visible=true, categoria='Punto de Venta'
--
-- NOTA: Los registros 112, 114, 118, 120 tienen GEOX/GEOY invertidos en el
--       origen (GEOX muestra ~-56 y GEOY ~-34). Se corrigen los valores.
--
-- UPSERT por ID: si el registro ya existe (por cambio de nombre), actualiza.
--
-- REEMPLAZAR 'admin@riogas.com.uy' por el email real antes de ejecutar.
-- =============================================================================

INSERT INTO public.puntos_interes
  (id, nombre, latitud, longitud, tipo, visible, categoria, icono, usuario_email)
VALUES
  (37,  'SOFIZEN BUCEO',            -34.886608, -56.132719, 'publico', true, 'Punto de Venta', '🏢', 'admin@riogas.com.uy'),
  (38,  'MONDELLI',                 -34.833015, -56.210447, 'publico', true, 'Punto de Venta', '🏢', 'admin@riogas.com.uy'),
  (41,  'CARLOS OJEDA - COLON',     -34.813733, -56.220661, 'publico', true, 'Punto de Venta', '🏢', 'admin@riogas.com.uy'),
  (42,  'SYN GAS BELVEDERE',        -34.851490, -56.224087, 'publico', true, 'Punto de Venta', '🏢', 'admin@riogas.com.uy'),
  (43,  'SYN GAS CERRO',            -34.874152, -56.262844, 'publico', true, 'Punto de Venta', '🏢', 'admin@riogas.com.uy'),
  (52,  'EL DUENDE SUPERGAS',       -34.871474, -56.175323, 'publico', true, 'Punto de Venta', '🏢', 'admin@riogas.com.uy'),
  (54,  'IBERICA LA COMERCIAL',     -34.884455, -56.182721, 'publico', true, 'Punto de Venta', '🏢', 'admin@riogas.com.uy'),
  (55,  'ROTUNAR - CERRITO',        -34.858050, -56.175773, 'publico', true, 'Punto de Venta', '🏢', 'admin@riogas.com.uy'),
  (57,  'RIOGAS MARONAS',           -34.851370, -56.128472, 'publico', true, 'Punto de Venta', '🏢', 'admin@riogas.com.uy'),
  (65,  'RIOGAS PLANTA',            -34.820356, -56.238104, 'publico', true, 'Punto de Venta', '🏢', 'admin@riogas.com.uy'),
  (66,  'IBERICA UNION',            -34.878273, -56.149351, 'publico', true, 'Punto de Venta', '🏢', 'admin@riogas.com.uy'),
  (68,  'RIOGAS SOLYMAR',           -34.836403, -55.964833, 'publico', true, 'Punto de Venta', '🏢', 'admin@riogas.com.uy'),
  (70,  'RIOGAS LAS PIEDRAS',       -34.737498, -56.223763, 'publico', true, 'Punto de Venta', '🏢', 'admin@riogas.com.uy'),
  (72,  'V. ERBURU',                -34.838156, -56.264503, 'publico', true, 'Punto de Venta', '🏢', 'admin@riogas.com.uy'),
  (73,  'SOFIZEN POCITOS',          -34.894105, -56.143032, 'publico', true, 'Punto de Venta', '🏢', 'admin@riogas.com.uy'),
  (86,  'COSTA GAS',                -34.844549, -55.994822, 'publico', true, 'Punto de Venta', '🏢', 'admin@riogas.com.uy'),
  (91,  'T. ARRASCAETA - BBLANCOS', -34.751368, -55.996814, 'publico', true, 'Punto de Venta', '🏢', 'admin@riogas.com.uy'),
  (94,  'T. ARRASCAETA - PANDO',    -34.715453, -55.953102, 'publico', true, 'Punto de Venta', '🏢', 'admin@riogas.com.uy'),
  (102, 'GUSTAVO DANIEL MORENO',    -34.885320, -56.249030, 'publico', true, 'Punto de Venta', '🏢', 'admin@riogas.com.uy'),
  (104, 'LUIS ADRIAN GONZALEZ',     -34.838150, -56.133960, 'publico', true, 'Punto de Venta', '🏢', 'admin@riogas.com.uy'),
  (107, 'ALBERT PEREZ',             -34.813460, -56.042260, 'publico', true, 'Punto de Venta', '🏢', 'admin@riogas.com.uy'),
  (108, 'LAIMAR GAS',               -34.880780, -56.137400, 'publico', true, 'Punto de Venta', '🏢', 'admin@riogas.com.uy'),
  (109, 'CARLOS OJEDA CARRASCO',    -34.873320, -56.126800, 'publico', true, 'Punto de Venta', '🏢', 'admin@riogas.com.uy'),
  (110, 'CARLOS SOSA',              -34.882070, -56.110650, 'publico', true, 'Punto de Venta', '🏢', 'admin@riogas.com.uy'),
  -- Siguientes 4: GEOX/GEOY invertidos en origen → corregidos:
  (112, 'ALEJANDRO GRANA',          -34.800490, -56.253450, 'publico', true, 'Punto de Venta', '🏢', 'admin@riogas.com.uy'),
  (114, 'DIEGO LOZA',               -34.782570, -56.137980, 'publico', true, 'Punto de Venta', '🏢', 'admin@riogas.com.uy'),
  (118, 'KATHERINE PIZOTO',         -34.801070, -56.145330, 'publico', true, 'Punto de Venta', '🏢', 'admin@riogas.com.uy'),
  (120, 'RIOGAS SUCURSAL CENTRO',   -34.910980, -56.191920, 'publico', true, 'Punto de Venta', '🏢', 'admin@riogas.com.uy')
ON CONFLICT (id) DO UPDATE SET
  nombre     = EXCLUDED.nombre,
  latitud    = EXCLUDED.latitud,
  longitud   = EXCLUDED.longitud,
  tipo       = EXCLUDED.tipo,
  visible    = EXCLUDED.visible,
  categoria  = EXCLUDED.categoria,
  icono      = EXCLUDED.icono,
  updated_at = now();

-- Limpiar registros anteriores con IDs que cambiaron (46→52, 105→104, 115→118)
-- Solo ejecutar si los IDs viejos existen con el email correcto:
-- DELETE FROM public.puntos_interes WHERE id IN (46, 105, 115) AND usuario_email = 'admin@riogas.com.uy';
