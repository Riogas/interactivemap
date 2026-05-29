# Polling inteligente — demoras + moviles_zonas

**Fecha:** 2026-05-29
**Autor:** dmedaglia + Claude
**Estado:** Análisis + 4 alternativas — pendiente decisión del usuario antes del plan de implementación.

---

## 1. Contexto / problema

**Hoy:** Un timer en el cliente (cada N segundos, configurable desde Preferencias Globales — recién mudado en commit `ccf5d12`) dispara un re-fetch completo de:
- `/api/demoras` → toda la tabla de demoras por zona del escenario.
- `/api/moviles-zonas` → toda la tabla de asignaciones móvil↔zona.

Cada fetch:
1. Query a Supabase (potencialmente cientos/miles de filas).
2. Transferencia + parse en el cliente.
3. Recálculo de derivados (cap. de entrega, etc.).
4. Redraw de las capas del mapa (`DemorasZonasLayer`, `MovilesZonasLayer`).

**Realidad:** las APIs externas que actualizan esos datos sobre Supabase se ejecutan **decenas de veces al día**. El polling, en cambio, corre cada pocos minutos → el 95%+ de los ticks fetchean data idéntica. Costoso para nada (CPU del server, ancho de banda, render del cliente).

## 2. Objetivo

Saber si hay cambios reales en el server **antes** de hacer el fetch pesado. Si no hay → no hacer nada.

## 3. Detalle de modelo a aclarar (importante)

La propuesta original incluía guardar también el **DT del último repolling** en `escenario_settings`. Riesgo: `escenario_settings` es **compartido por escenario** (no por usuario/sesión).

**Caso problemático:**
- Usuario A polleó a las 10:00 → actualiza `last_repoll = 10:00`.
- API NO actualizó nada desde las 09:30 → `api_update = 09:30`.
- Usuario B abre el dashboard a las 10:05.
- Su timer dispara → ve `api_update (09:30) < last_repoll (10:00)` → "nada nuevo, no fetcheo".
- **Pero B nunca cargó la data** → queda con capas vacías.

**Solución:** el "último repolling" debe vivir **client-side** (memoria, ref, o localStorage). Cada cliente compara su propio `last_local_at` contra el `api_update_at` que es server-side. El `escenario_settings` solo guarda el DT del **lado del servidor** (cuándo cambió la data, no quién la leyó).

## 4. Building blocks necesarios

### 4.1 Marca server-side del último cambio

En `escenario_settings`, agregar 2 columnas:
```sql
ALTER TABLE escenario_settings
  ADD COLUMN demoras_last_api_update timestamptz,
  ADD COLUMN moviles_zonas_last_api_update timestamptz;
```

Estas columnas se tocan **cada vez que la data cambia**, por dos caminos posibles:

**Opción 4.1.a — Las APIs escriben la marca explícitamente**
La aplicación que llama a las APIs (la que las actualiza decenas de veces por día) tiene que recordar también hacer `UPDATE escenario_settings SET demoras_last_api_update = now() WHERE escenario_id = ?`. Riesgo: si alguien escribe a `demoras` o `moviles_zonas` por otro camino (SQL manual, futura API, otro servicio) → no se actualiza la marca → se pierden cambios.

**Opción 4.1.b — Trigger en DB (recomendada)**
Trigger `AFTER INSERT/UPDATE/DELETE` sobre `demoras` y `moviles_zonas` que actualiza la marca automáticamente.

```sql
CREATE OR REPLACE FUNCTION trg_demoras_marca_escenario_settings()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_escenario integer;
BEGIN
  v_escenario := COALESCE(NEW.escenario_id, OLD.escenario_id);
  UPDATE escenario_settings 
     SET demoras_last_api_update = now() 
   WHERE escenario_id = v_escenario;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_demoras_marca ON demoras;
CREATE TRIGGER trg_demoras_marca 
AFTER INSERT OR UPDATE OR DELETE ON demoras 
FOR EACH ROW EXECUTE FUNCTION trg_demoras_marca_escenario_settings();
```

(Análogo para `moviles_zonas`.)

**Ventaja decisiva:** funciona sin importar el camino (API, SQL manual, otra app), nunca pierde un cambio.

**Optimización si las APIs hacen bulk updates de 100+ filas:** cambiar a `FOR EACH STATEMENT` (el trigger se dispara una sola vez por statement, no por fila). Para los volúmenes actuales (decenas/día) probablemente no haga falta.

### 4.2 Marca client-side del último fetch

Cada cliente mantiene un `Map<string, Date>` (o un ref) con `{ demoras: <ts>, moviles_zonas: <ts> }` actualizado en cada fetch exitoso. Opcional persistirlo en `localStorage` para que sobreviva a reload de pestaña.

Comparación al chequear:
```ts
const needsFetchDemoras = !localLastFetch.demoras 
  || new Date(settings.demoras_last_api_update) > localLastFetch.demoras;
```

## 5. Cuatro alternativas (de menor a mayor complejidad)

### Alternativa A — Check liviano por timer

**Cómo:**
- Schema con la marca (4.1).
- Trigger sobre demoras/moviles_zonas (4.1.b).
- Client: cada tick, hace una query **mínima** a `escenario_settings` (1 fila, 2 timestamps).
- Si la marca es mayor que el `lastFetchedAt` local → hace el fetch pesado y actualiza el local.
- Si no → no hace nada.

**Pros:**
- Mínimamente invasivo, fácil de implementar.
- Elimina el 95%+ de los fetches inútiles.

**Contras:**
- Sigue habiendo "polling barato" (la query a `escenario_settings`) cada tick.
- Si el intervalo es 60s, la latencia entre cambio y refresh es hasta 60s.

---

### Alternativa B — Reactivo con Supabase Realtime

**Cómo:**
- Schema + trigger (igual que A).
- Cliente se suscribe a **realtime** sobre la fila de `escenario_settings` del escenario activo (filtro por `escenario_id`).
- Cuando llega un UPDATE → compara las marcas → si son nuevas, refetch + update local.
- El timer pasa a ser un **safety net** de baja frecuencia (cada 5-10 min) por si el canal de realtime se cae.

**Pros:**
- Latencia milisegundos entre cambio y refresh.
- Cero polling del check (solo el safety net).
- UX: la capa se actualiza sola sin que el usuario espere.

**Contras:**
- Un canal de realtime adicional abierto.
- Si ya hay muchos canales (gps_latest_positions, pedidos, services, moviles_dia), uno más.
- Implementación más sutil (debounce de eventos, fallback timer).

**Mitigación bulk:** si las APIs hacen muchos INSERTs en bulk → el trigger dispara muchos eventos → debouncing en el cliente (250ms-1s, igual que ya usamos para GPS y pedidos).

---

### Alternativa C — Delta fetch incremental

**Cómo:**
- Schema, trigger, check (cualquiera de A o B).
- Cuando hay que fetchear, no traer **toda** la data sino solo lo que cambió:
  ```
  GET /api/demoras?since=2026-05-29T15:00:00Z
  GET /api/moviles-zonas?since=2026-05-29T15:00:00Z
  ```
- El servidor devuelve solo filas con `updated_at > since` (más las eliminadas vía marker de soft-delete si aplica).
- Cliente mergea el delta sobre su cache local.

**Pros:**
- Aún más eficiente cuando los cambios son pocos.

**Contras:**
- Necesita endpoint que soporte `since`.
- Necesita columna `updated_at` en `demoras`/`moviles_zonas` (probablemente ya existen).
- Manejo de DELETE: si soft-delete, ok; si hard-delete, no se puede inferir → fallback a refresh completo periódico.
- Mucho más complejo de mantener (cache merge, conflict resolution).

**Cuándo vale la pena:** si los datasets son **grandes** (decenas de miles de filas) y los cambios son **pocos por update** (1-10 filas). Si los datasets son chicos (cientos/miles), la ganancia es marginal vs. fetch completo.

---

### Alternativa D — Híbrido (recomendada)

**Cómo:**
- Schema + trigger (4.1).
- Realtime sobre `escenario_settings` (alternativa B).
- Cuando llega un evento → fetch completo (alternativa A, no C). El delta-fetching queda para un escalón posterior si los volúmenes lo justifican.
- Safety-net timer de baja frecuencia (5-10 min) por si realtime se cae.
- Debounce del handler (1s) para absorber bulk updates.

**Pros:**
- Lo mejor de A y B sin complejidad de C.
- Robusto a fallos de realtime (fallback timer).
- Predeciblemente performante.
- Cero polling estable cuando no hay cambios.

**Contras:**
- Más complejo que A (un canal + un handler con debounce).

---

## 6. Cambios concretos por capa

### 6.1 SQL (cualquier alternativa)
- `ALTER TABLE escenario_settings ADD COLUMN ...` (2 columnas timestamptz).
- 2 triggers (uno por tabla).
- *(Para Alternativa B/D)* — habilitar realtime sobre `escenario_settings` + política RLS si aplica.

### 6.2 Backend
- *(Si Alternativa C)* — endpoints `/api/demoras` y `/api/moviles-zonas` aceptan `?since=`.

### 6.3 Cliente
- Hook que maneja el polling actual (probablemente `useMapDataView.ts` u otro) se refactorea:
  - Estado `lastFetchedAt: { demoras: Date | null, moviles_zonas: Date | null }` en ref o en localStorage.
  - Función `checkAndFetch()` que consulta `escenario_settings` (modo A) o reacciona a realtime (modo B/D).
  - Timer del intervalo configurable → se convierte en "safety net" (intervalo más largo) en modo B/D.

### 6.4 Configuración (Preferencias Globales)
- Los sliders de "Vista Demoras" y "Vista Móviles en Zonas" (commit `ccf5d12`) cambian de semántica:
  - Modo A: siguen siendo el intervalo del check liviano.
  - Modo B/D: pasan a ser el intervalo del **safety net**, sugerencia: subirlos a 10 min por defecto.
- Idealmente agregar un toggle "Modo inteligente (realtime)" para que se pueda activar/desactivar — útil durante el rollout.

---

## 7. Edge cases / consideraciones

1. **Primera carga:** `lastFetchedAt = null` → siempre fetchea. ✅
2. **Múltiples pestañas:** cada una tiene su propio `lastFetchedAt`. Independientes. ✅
3. **Realtime disconnect (B/D):** safety net del timer cubre. ✅
4. **Reloj cliente:** las comparaciones son siempre `serverDT > localDT`. El servidor genera todos los DTs con `now()` server-side, no hay clock-skew. ✅
5. **Bulk updates de 100+ filas:** trigger por fila vs por statement (4.1.b nota). Mitigación con debounce en cliente.
6. **Tabs en background:** si el browser pausa timers, el realtime sigue funcionando (mejor en modo B/D).
7. **Cierre/reapertura de sesión:** si guardamos `lastFetchedAt` en localStorage, evitamos un refetch inicial si la data no cambió en el mientras. Recomendable.

---

## 8. Recomendación

**Alternativa D (Híbrido).** Es el mejor balance complejidad/beneficio para los volúmenes y patrones de uso descritos.

Plan en 3 pasos:
1. **Paso 1 — Schema + triggers** (SQL, día 1). Aplicar `.sql` con las 2 columnas + los 2 triggers. Sin cambios de cliente todavía: la data se acumula pero nadie la consume aún. Riesgo: cero.
2. **Paso 2 — Cliente con realtime + safety net** (día 1-2). Implementar el hook + suscripción + debounce + fallback timer. Detrás de un feature flag (`NEXT_PUBLIC_SMART_POLLING_ZONAS=true`) para rollback fácil. Probar en staging/prod con flag off, prender en producción cuando confirmado.
3. **Paso 3 (opcional, defer)** — Delta-fetching con `?since=` si las métricas muestran que el fetch completo sigue siendo pesado.

---

## 9. Puntos abiertos a confirmar

- ¿La columna `updated_at` ya existe en `demoras` y `moviles_zonas`? *(no es bloqueante para A/B/D, sí para C)*
- ¿Hay cómo identificar al escenario desde la fila de `demoras`/`moviles_zonas`? Probablemente sí (`escenario_id` o vía join con `zonas`), pero confirmarlo para el trigger.
- ¿Las APIs externas que actualizan estos datos son nuestras o de un tercero? *(no cambia el diseño, pero condiciona si las dejamos como están o las tocamos como fallback en Opción 4.1.a)*
- ¿Hay otras vistas/capas que también se podrían beneficiar del mismo patrón? *(p. ej. zonas, demoras-sin-móvil, etc.)*
