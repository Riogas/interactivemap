# Sistema de Ruteo Dinámico de Pedidos — RioGas (TrackMovil)

> Documento maestro. Consolida TODO lo conversado sobre ruteo + amplificaciones y mejoras.
> Fecha: 2026-06-16. Origen de la charla: sesión `ad6f2180` (mayo 2026).
> Estado real: **infra de distancias (OSRM) montada y funcionando**; el **ruteador (algoritmo) y las tablas/jobs en Supabase NO están implementados todavía**.

---

## 0. Resumen ejecutivo (lo que entendí en una frase)

RioGas (distribución de supergas en Uruguay) tiene hoy un dashboard (**TrackMovil**) que **visualiza** móviles, zonas, pedidos y services en tiempo real, pero **la asignación de pedidos a móviles la hace un humano**. La idea es construir un **ruteador automático dinámico**: cuando entra un pedido sin asignar (`movil = 0`), el sistema decide a qué móvil dárselo, respetando zona, tipo de servicio, capacidad/lote, ventana horaria (urgente/nocturno) y, sobre todo, **si ese móvil puede cumplir el `fch_hora_max_ent_comp` (deadline) dada la ruta que ya tiene** — con la regla de oro de que **un pedido, una vez asignado, no se reasigna**.

Para poder medir tiempos/distancias reales (insumo del ruteador) montamos **OSRM self-hosted sobre OSM de Uruguay**, que ya está corriendo y validado. Falta construir el cerebro encima.

---

## 1. El dominio (cómo está modelado hoy)

### Entidades y relaciones

```
empresas_fleteras 1───* moviles ─────────── *───* zonas   (vía moviles_zonas)
                                │                  │
                                │                  ├── geojson (polígono)
                                │                  ├── demora_minutos
                                │                  ├── tipo_de_zona (Reparto / Tránsito / …)
                                │                  ├── tipo_de_servicio (GAS / AGUA / …)
                                │                  └── prioridad_o_transito
                                │
                                ├── tamano_lote   (capacidad MAX del móvil)
                                ├── cant_ped      (pedidos pendientes hoy)
                                ├── cant_serv     (services pendientes hoy)
                                ├── capacidad     (cant_ped + cant_serv)
                                ├── estado_nro    (0/1/2 activo, 3 no activo, 4 baja momentánea)
                                └── última posición GPS (gps_tracking_extended)

pedidos / services
  ├── escenario             (1000 = producción)
  ├── movil                 (0 = SIN ASIGNAR)
  ├── estado_nro            (1 pendiente, 2 entregado)
  ├── zona_nro
  ├── fch_para              (día comprometido)
  ├── fch_hora_max_ent_comp ← DEADLINE DURO
  ├── prioridad
  ├── latitud / longitud
  └── producto_cant / imp_bruto / cliente_*
```

Tabla derivada clave: **`zonas_cap_entrega(escenario, zona, tipo_servicio, movil, emp_fletera_id, lote_disponible)`** — materializa cuánto lote le queda a cada par móvil-zona. Se mantiene desde `lib/zonas-cap-entrega.ts` (en código, **no por triggers de DB**).

### Reglas de negocio ya implementadas

**Capacidad y lote**
- `lote_disponible_total = tamano_lote − capacidad` (puede ser negativo = sobrecupo).
- El lote del móvil se **prorratea** entre las zonas que cubre, con peso configurable por escenario (`peso_transito_alpha`, default 0.3):
  - Zonas de **Reparto** pesan 1.
  - Zonas de **Tránsito** pesan α (0.3 por defecto).
  - Por eso un mismo móvil aparece con distinta porción de lote según la zona.
- Indicador "Cap. Entrega" por zona = `capacidad_disponible − pedidos_sin_asignar`. Bandas de color: `<0` sin cap, `0` rojo, `1` naranja, `2-3` amarillo, `>3` verde.

**Asignación de zonas**
- Un móvil tiene N zonas activas en `moviles_zonas` (`activa = true`).
- Cada par móvil↔zona tiene `tipo_de_servicio` (GAS / AGUA / …) → un pedido de GAS solo puede ir a un móvil que cubra esa zona con `tipo_de_servicio = 'GAS'`.
- `prioridad_o_transito` ordena preferencia dentro de una zona.

**Ventanas horarias (urgente vs nocturno)**
- Default: **nocturno 20:30 → 06:00**, diurno 06:00 → 20:30. Configurable por escenario (`hora_ini_nocturno`, `hora_fin_nocturno`).
- `escenario_settings.aplica_serv_nocturno` decide si el escenario tiene capa nocturna; si no, todo queda como URGENTE.
- `determineServicePeriod()` devuelve `URGENTE | NOCTURNO` según hora del servidor.

**Pedidos sin asignar (visibilidad)**
- `escenario_settings.pedidos_sa_minutos_antes`: cuántos minutos antes del `fch_hora_max_ent_comp` un pedido sin asignar empieza a aparecer para distribuir.
- Atraso por pedido se calcula contra `fch_hora_max_ent_comp` (verde / amarillo / naranja / rojo).

**Estados de móvil**
- `0/1/2` = activo (asignable), `3` = no activo, `4` = baja momentánea (descartar del ruteo).

**Invariante crítica**
> Una vez asignado un pedido a un móvil, **no se reasigna**.
> El ruteador solo decide qué móvil recibe los pedidos que aún tienen `movil = 0`. Lo ya asignado queda firme. ⇒ Es un **greedy online**, no un VRP completo con re-optimización.

### Flujo operativo en tiempo real

1. **Origen**: pedidos vienen del **AS400 (ERP)** y se importan a **Supabase** con `movil = 0` si no están asignados.
2. **GPS**: la app del chofer empuja a `gps_tracking_extended` → **Realtime WebSocket** → frontend.
3. **Dashboard** consume: `moviles-extended` (con `tamano_lote`, `capacidad`, zonas), `pedidos`/`services` (filtrados por escenario+fecha+estado), `zonas` (polígonos), `zonas-cap-entrega` (capa visual de saturación).
4. **Despachador humano** ve el mapa y asigna manualmente (o desde el ERP). **El sistema actual NO rutea, solo visualiza.**

Stack: **Next.js 16 (Turbopack) + Supabase (Postgres + Realtime) + Leaflet** en VPS, deploy con script propio (`/var/www/track`, rama `dev`, repo `Riogas/interactivemap`, pnpm). App del chofer: Flutter (proyecto MoveIT/appmovil).

---

## 2. Variables que el ruteador debe considerar

| Categoría | Variable | Fuente |
|---|---|---|
| **Elegibilidad** | móvil activo (`estado_nro ∈ {0,1,2}`) | `moviles` |
| | móvil cubre la zona del pedido | `moviles_zonas` + `pedidos.zona_nro` |
| | tipo de servicio matchea (GAS/AGUA/…) | `moviles_zonas.tipo_de_servicio` |
| | móvil pertenece a fletera autorizada | `moviles.empresa_fletera_id` |
| **Capacidad** | `lote_disponible` del móvil para esa zona | `zonas_cap_entrega` |
| | `tamano_lote − capacidad` (global) | `moviles` |
| **Tiempo** | `fch_hora_max_ent_comp` (deadline) | `pedidos` |
| | demora estimada de la zona | `zonas.demora_minutos` |
| | distancia/tiempo GPS actual → cliente | OSRM + `pedidos.lat/lon` |
| | velocidad/tiempo de viaje | OSRM (+ factor de corrección por histórico) |
| **Recorrida actual** | pedidos ya asignados al móvil | `pedidos WHERE movil = X AND estado=1` |
| | orden actual de la ruta | **no existe hoy** — hay que crearlo |
| **Prioridad** | `prioridad` del pedido | `pedidos.prioridad` |
| | tipo zona (Reparto > Tránsito) | `moviles_zonas.tipo_de_zona` |
| | urgente / nocturno (ventana actual) | `determineServicePeriod()` |
| | `prioridad_o_transito` por móvil-zona | `moviles_zonas` |

---

## 3. Brechas a cubrir antes de rutear "en serio"

1. **No hay "orden de visita" persistido.** Sabemos qué pedidos tiene cada móvil, pero no en qué orden los hará. Sin orden, evaluar *"¿se cumple el deadline si le sumo este pedido?"* obliga a re-secuenciar cada vez.
2. **No había matriz de distancias/tiempos.** Solo coordenadas crudas → **RESUELTO con OSRM** (sección 4).
3. **No hay ETA por entrega.** Hay que calcularla y guardarla para medir el impacto de un pedido nuevo.
4. **`zonas.demora_minutos` sub-utilizado.** Es la única señal de cuánto tarda el chofer "en zona".
5. **El "no se reasigna" tensiona con lo dinámico.** Cada pedido nuevo se decide una sola vez y queda firme → greedy online.

---

## 4. Motor de distancias/tiempos — OSRM (✅ MONTADO Y FUNCIONANDO)

### Por qué OSRM (y no Google/Mapbox ni los otros)

| Opción | Costo | Precisión | Setup | Veredicto |
|---|---|---|---|---|
| **A. Haversine** (línea recta × velocidad) | 0 | −30%/+50% error urbano | 1 h | solo fallback |
| **B. OSRM self-hosted** | 0 (solo VPS) | Muy buena, sin tráfico real | 1 día | **ELEGIDO** |
| **C. Mapbox / Google Matrix** | USD 0.005/elemento | Excelente con tráfico | 2 h | inviable a escala |
| **D. Histórico GPS propio** | 0 | La verdad de tus choferes | semanas | capa de calibración |

Cuenta que mató a Google: 50 móviles × 300 pedidos = 15.000 elementos × USD 5/1000 = **USD 75 por recomputación**; reasignando 10×/día = **USD 750/día**. Insostenible.

**Por qué OSRM y no Valhalla/GraphHopper:** el ruteador necesita constantemente la **matriz NxM** ("estos 30 móviles candidatos contra estos 200 pedidos") → OSRM `/table` la resuelve en **una sola llamada en milisegundos**. Valhalla brilla para **truck profile** (peso/altura/calles prohibidas para camiones de gas), ventanas horarias y **isócronas** → queda como **motor secundario de fase 2**. GraphHopper: matriz potente es de pago. El **tile server + Nominatim + Overpass** que RioGas ya tiene cumplen OTRA función (visualización y geocoding), no compiten con OSRM.

### Estado de la infra (lo que ya corre)

- VPS `osm` (`riogas@osm:~/osm`), repo de infra en `C:\Users\jgomez\Documents\Projects\osm`.
- `docker-compose.yml` con: **postgis + nominatim (7070) + tileserver (7080) + overpass (6060) + OSRM (5050)**.
- OSRM preprocesado de `uruguay-latest.osm.pbf` (Geofabrik): 6M nodos, 274K ways, ~7 s extract, ~3 s partition, ~2 s customize. RAM pico ~500 MB, runtime ~1 GB.
- Servicios de build con `profiles: [build]` (no arrancan en `up` normal):
  ```bash
  docker compose --profile build run --rm osrm-extract
  docker compose --profile build run --rm osrm-partition
  docker compose --profile build run --rm osrm-customize
  docker compose up -d osrm
  ```
- Runtime: `osrm-routed --algorithm mld --max-table-size 8000`, puerto **5050:5000**.
- **`OSRM_BASE_URL=http://<ip-del-vps-osm>:5050`** ← env var para TrackMovil.

> ⚠️ Gotcha que ya nos pasó: el YAML rompía por `volumes:` indentado dentro de `services:` y mezcla de 2/4 espacios (`yaml: line 150: did not find expected key`). Quedó resuelto con indentación estándar de 2 espacios y `volumes:` a columna 0.

### Endpoints OSRM (recordatorio: formato `lon,lat`, al revés de Google)

```bash
# Ruta entre 2 puntos
curl "http://localhost:5050/route/v1/driving/-56.1882,-34.9011;-56.1559,-34.9120?overview=false"

# Matriz NxN (EL endpoint clave del ruteador)
curl "http://localhost:5050/table/v1/driving/lon1,lat1;lon2,lat2;...?annotations=duration,distance"

# Snap a calle más cercana
curl "http://localhost:5050/nearest/v1/driving/-56.16,-34.90"

# Geometría para dibujar en mapa
curl ".../route/v1/driving/...?overview=full&geometries=geojson" | jq '.routes[0].geometry'

# Velocidades segmento a segmento
curl ".../route/v1/driving/...?annotations=speed,duration,distance"
```

Validado en vivo: Centro→Pocitos 3.75 km / 447 s; 18 de Julio y Ejido → Benito Blanco y Av. Brasil = **4.106 km / 410 s / 36 km/h**, ruta turn-by-turn coherente con las manos y canteros de Montevideo.

### Cómo calcula OSRM la velocidad (y por qué subestima)

`tiempo = Σ(longitud_segmento / velocidad_del_tag) + Σ penalidades(giros, semáforos, stops)`. Velocidades vienen del profile **`car.lua`** por tag `highway=` (motorway 90, primary 65, secondary 55, residential 25, service 15…), pisadas por `maxspeed` de OSM si existe.

**Problema detectado:** `traffic_light_penalty = 2` segundos es ridículo para Montevideo (ciclos de 60-90 s, espera real 12-25 s). Por eso da 36 km/h cuando los móviles reales andan a 20-25 km/h.

**Dos caminos para corregir:**
- **A) Editar `car.lua`** (extraerlo con `docker run --rm -v "$PWD/osrm-profiles:/out" ghcr.io/project-osrm/osrm-backend sh -c "cp -r /opt/* /out/"`, subir `traffic_light_penalty → 15`, `u_turn_penalty → 30-40`, stops 5-8 s; montar `./osrm-profiles:/profiles` y re-correr los 3 pasos). Mejora global "barata".
- **B) Factor de corrección por encima** con GPS histórico (recomendado como principal — sección 6, Capa 4).

> Recomendación dada: dejar `car.lua` lo más virgen posible (salvo el ajuste obvio del semáforo) y calibrar con datos reales, para no enmascarar el patrón horario.

---

## 5. El stack de distancias en 4 capas (diseño)

**Capa 1 — OSRM local (✅ hecho).** Backbone de rutas + matriz.

**Capa 2 — Caché en Supabase (pendiente).** Las calles no se mueven → cacheás pares por **geohash precisión 7 (~150m)**.
```sql
CREATE TABLE distancia_cache (
  origen_lat NUMERIC(9,6), origen_lon NUMERIC(9,6),
  destino_lat NUMERIC(9,6), destino_lon NUMERIC(9,6),
  distancia_m INT NOT NULL, duracion_seg INT NOT NULL,
  origen_celda TEXT NOT NULL,   -- geohash 7
  destino_celda TEXT NOT NULL,
  hits INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (origen_celda, destino_celda)
);
CREATE INDEX idx_dist_cache_lookup ON distancia_cache(origen_celda, destino_celda);
```
Flujo: geohash(A),geohash(B) → buscar cache → HIT devuelve / MISS llama OSRM, persiste, devuelve.

**Capa 3 — Matriz zona×zona (pendiente).** Decisiones macro ("¿llega de Pocitos a Carrasco en 20 min?") sin calcular pedido a pedido. Job nocturno: centroide→centroide de todas las zonas (30 zonas = 900 pares en 1 llamada `/table`).
```sql
CREATE TABLE zonas_matriz (
  zona_origen INT, zona_destino INT,
  distancia_m INT, duracion_seg INT, duracion_pico_seg INT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (zona_origen, zona_destino)
);
```

**Capa 4 — Calibración con GPS histórico (pendiente — "esto es ORO").** `gps_tracking_extended` tiene meses/años de recorridos reales. Ventaja injusta que nadie más tiene.
```sql
CREATE TABLE factor_correccion_zonas (
  zona_origen INT, zona_destino INT,
  hora_del_dia INT,   -- 0..23
  dia_semana INT,     -- 0..6
  factor NUMERIC(4,2), -- multiplica el tiempo OSRM
  muestras INT,        -- N viajes observados (mínimo 5 para no meter ruido)
  PRIMARY KEY (zona_origen, zona_destino, hora_del_dia, dia_semana)
);
```
Cron semanal: detectar viajes reales (sale del polígono A, entra al B), `factor = tiempo_real_promedio / tiempo_osrm`. Al consultar: `tiempo = OSRM × factor(zona_o, zona_d, hora, dia)`. Así el ruteador sabe que Pocitos→Centro tarda 35 min a las 18:30 (factor 1.6) pero 14 min a las 22:00 (factor 0.85).

### Interfaz que consume el ruteador
```ts
async function getTravelTime(
  origin: { lat: number, lon: number },
  dest:   { lat: number, lon: number },
  when?:  Date
): Promise<{ distanciaM: number, duracionSeg: number, fuente: 'cache'|'osrm'|'haversine' }>
```
Cascada interna: **cache → OSRM (timeout 500ms, retry 1x) → Haversine × 1.4** (factor empírico Uruguay urbano) marcando `fuente:'haversine'` para que el ruteador sepa que es estimación pobre. Para batch: `getTravelMatrix(origins[], dests[])` = una sola llamada `/table`.

---

## 6. El ruteador (esqueleto del algoritmo — greedy online)

```
Para cada pedido P sin asignar (estado=1, movil=0):
  1. CANDIDATOS = móviles que:
       - activos (estado_nro ∈ {0,1,2})
       - cubren P.zona_nro con tipo_servicio compatible
       - pertenecen a fletera autorizada
       - lote_disponible_zona(P.zona) >= 1  (zonas_cap_entrega)
  2. Para cada candidato M:
       a. ruta tentativa = ruta_actual(M) ∪ {P}   (cheapest insertion: mejor posición)
       b. ETA[i] = ETA[i-1] + tiempo_viaje(i-1 → i) + demora_zona(i)
       c. si algún ETA[i] > fch_hora_max_ent_comp[i] → DESCARTAR M
       d. Costo(M,P) = w1·distancia_extra
                     + w2·(1 − lote_disponible_zona/tamano_lote)   ← prioriza vacíos
                     + w3·(cant_ped + cant_serv)                   ← penaliza saturados
                     + w4·tipo_zona_penalty                        ← Tránsito penaliza
                     + w5·urgencia_relativa(P)                     ← más cerca del deadline pesa más
  3. Asignar P al M con menor Costo válido.
  4. UPDATE pedidos.movil = M.nro  → recomputar_movil_y_cap_entrega() (helper ya existe)
```

**Tres modos según período:**
- **Diurno normal**: distancia y lote ponderan parejo.
- **Urgente diurno** (pedido entra cerca del deadline): `w5` alto, ignora distancia si hace falta para cumplir.
- **Nocturno**: solo móviles con `aplica_serv_nocturno`; ventana horaria distinta.

---

## 7. Decisiones que faltan cerrar (7 preguntas abiertas)

1. **Motor de distancias** → ✅ cerrado: OSRM (+ Haversine fallback + factor GPS).
2. **Persistir orden de ruta**: ¿campo `orden_visita` en `pedidos` o tabla nueva `rutas_movil(movil, pedido, orden, eta_estimada)`? → **recomendado: tabla `rutas_movil`** (más limpia, soporta ETA).
3. **Trigger del ruteador**: ¿on-demand (botón "auto-asignar"), por cada insert (realtime), o por lotes cada X min?
4. **¿Asigna también el humano o solo la máquina?** Si conviven → columna `asignado_por: AUTO | MANUAL` para auditoría.
5. **Reversibilidad real del "no se reasigna"**: ¿aplica si el chofer pierde GPS, marca incidente, pasa a baja momentánea (estado 4)? Hay que listar excepciones.
6. **Pesos w1..w5**: ¿configurables en `escenario_settings` (root) o hardcodeados al inicio?
7. **Multi-tenant**: ¿el ruteador corre por fletera o global respetando el scope de cada fletera?

---

## 8. Estado real del proyecto

| Pieza | Estado |
|---|---|
| OSRM Docker (extract/partition/customize/runtime) | ✅ corriendo, validado |
| Endpoints `/route` `/table` `/nearest` | ✅ smoke-tested |
| `OSRM_BASE_URL` en env de TrackMovil | ⚠️ falta setear/confirmar |
| Ajuste de `car.lua` (semáforo 2→15 s, etc.) | ❌ pendiente (opcional) |
| Tablas `distancia_cache` / `zonas_matriz` / `factor_correccion_zonas` | ❌ no creadas |
| Helper `lib/routing/distance.ts` (+ `osrm-client.ts`, `geohash.ts`) | ❌ no escrito |
| Cron diario `recalcular-zonas-matriz` | ❌ |
| Cron semanal `calibrar-factores-gps` | ❌ |
| Tabla `rutas_movil` + ETA persistida | ❌ |
| **Ruteador (algoritmo greedy + endpoint)** | ❌ — el cerebro, sin empezar |
| Visualización de ruta en el mapa (Leaflet) | ❌ |

**Conclusión:** la base de medición está lista; falta TODO lo que decide y persiste. La charla terminó justo antes de armar el prompt de `/feature`.

---

## 9. Mejoras y amplificaciones (lo nuevo que propongo)

### 9.1 Calidad del ruteo
- **Truck profile real (Valhalla, fase 2)**: camiones de gas tienen restricciones (peso, túneles, calles prohibidas, mercancía peligrosa/ADR). Valhalla lo soporta nativo; vale como motor secundario para casos donde `car.lua` miente.
- **Isócronas**: "polígono de todo lo que un móvil alcanza en 20 min desde donde está" → filtra candidatos antes de calcular matriz (baja costo computacional y mejora UX del despachador).
- **Cheapest-insertion mejorado con 2-opt local** sobre la ruta del móvil (sin violar "no reasignar lo ya entregado", solo reordenar lo pendiente-no-iniciado si la política lo permite).
- **Penalización por "desvío que rompe otras promesas"**: al insertar P, no solo chequear el deadline de P sino el delta de ETA de TODOS los pedidos posteriores del móvil (un buen insert para P puede arruinar al pedido siguiente).

### 9.2 Datos y aprendizaje
- **Calibración GPS como activo central** (Capa 4): además de factor por zona/hora/día, derivar **tiempo de servicio real por cliente/tipo** (cuánto tarda en cargar/descargar), que hoy se aproxima con `zonas.demora_minutos`. El GPS sabe cuánto estuvo quieto en cada parada.
- **Predicción de demanda estacional** (invierno = pico de gas) por zona → pre-balancear lotes antes de que entren los pedidos.
- **Detección de anomalías**: móvil que sistemáticamente incumple ETA, zona con factor que se dispara (corte de calle, obra).

### 9.3 Operación y control
- **Modo "sugerencia" antes de "automático"**: el ruteador propone, el despachador confirma con un click. Genera confianza + dataset de correcciones humanas (¿cuándo el humano sobreescribe a la máquina? → re-entrenar pesos).
- **Explicabilidad**: junto a cada asignación, mostrar *por qué* ("móvil 52: 4 km, lote 6 libre, llega 14:10 vs deadline 14:30"). Un ruteador caja-negra no lo adopta la operación.
- **Auditoría `asignado_por` + histórico de decisiones** para medir KPIs: % cumplimiento de deadline, km totales, ocupación de lote, pedidos sin asignar al cierre del día.
- **Simulador / replay**: correr el ruteador sobre un día histórico y comparar contra lo que hizo el humano (km, cumplimiento). Es la mejor venta interna del proyecto.

### 9.4 Resiliencia
- **Fallback en cascada ya diseñado** (cache→OSRM→Haversine); sumar **alarma a Telegram** si OSRM cae (encaja con el `monitoreo-agent` del ecosistema RioGas).
- **Replanificación ante incidencias**: si un móvil se cae (estado 4 / pierde GPS), sus pedidos pendientes-no-iniciados vuelven a la pila `movil=0` (excepción explícita al "no reasignar", a definir en pregunta 5).

### 9.5 Arquitectura
- **Servicio de ruteo desacoplado** (no embebido en el request del dashboard): un worker que escucha inserts realtime de `pedidos movil=0` y resuelve, así no bloquea la UI.
- **Versionar pesos y profile** en `escenario_settings` con fecha → poder hacer A/B y rollback.
- Encaja con el roster de agentes: un **`ruteo-agent`** dentro del enjambre de Logística (junto a `stock-cilindros-agent`, `demanda-agent`, `incidencias-agent`).

---

## 10. Próximo paso concreto recomendado

Cerrar las 7 preguntas de la sección 7 (sobre todo 2, 3, 5) y lanzar **un `/feature`** con el primer bloque, que NO es el algoritmo todavía sino la base que lo habilita, en una corrida:

1. Migraciones SQL: `distancia_cache`, `zonas_matriz`, `factor_correccion_zonas`, `rutas_movil`.
2. Helper TS `lib/routing/` (`osrm-client.ts` + `distance.ts` con cascada + `geohash.ts` con `ngeohash`).
3. Endpoint admin `POST /api/admin/routing/warmup-zonas-matriz` (popula `zonas_matriz` y sirve de smoke test de integración).

Fase 2: crones de calibración. Fase 3: el ruteador propiamente dicho (greedy + modos + explicabilidad) en modo sugerencia. Fase 4: automático + Valhalla truck profile.

---

*Documento reconstruido a partir de la sesión `ad6f2180-49f6-438c-88ed-f34fcfac6720`. Si algo del dominio cambió desde mayo 2026, verificar contra el código vivo de TrackMovil antes de implementar.*
