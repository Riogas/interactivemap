# Design Spec — Arrastre de pendientes del día anterior en la vista de hoy

> **Estado:** Borrador para revisión
> **Fecha:** 2026-05-29
> **Branch:** `dev`
> **Autor:** Claude (asistido)
> **Repo:** `trackmovil` (Next.js + Supabase/Postgres + as400-api Python)

---

## 1. Resumen / objetivo

### Qué se quiere

Hoy, un pedido o service se considera **pendiente** cuando cumple `estado_nro = 1` **Y** `fch_para = <fecha seleccionada>` (coincidencia exacta de un único día). Se quiere que **SOLO en la vista del día actual** la definición de "pendiente" se amplíe a:

> `estado_nro = 1` **Y** `fch_para IN (hoy, ayer)`

Esta dualidad debe propagarse de forma consistente a **todas las superficies** que muestran pendientes:

- **Sidebar** (`MovilSelector.tsx`)
- **Mapa** (`MapView.tsx` + capas)
- **Read-model** `moviles_dia` (conteos `pedidos_pendientes` / `services_pendientes`)
- **Tabla extendida** (`PedidosTableModal.tsx`)

### El "por qué"

Dos motivos operativos concretos:

1. **Servicio nocturno que cruza la madrugada.** El reparto nocturno arranca a la noche (config `NIGHT_START_HOUR = 20.5` en `lib/horario-servicio.ts:17-77`) y se concreta de madrugada, ya en el día calendario siguiente. Lo que se cargó "ayer" sigue siendo trabajo en curso "hoy".
2. **Entregas laxas que se concretan al día siguiente.** Pedidos no finalizados al cierre del día quedan "colgados"; el operador necesita verlos junto con los de hoy para no perderlos de vista.

### Resultado esperado

En la **fecha actual** (y solo en ella), el operador ve **juntos** los pendientes no finalizados de **hoy** y de **ayer**, en sidebar, mapa, conteos y tabla, sin distinción visual. Esto permite detectar de un vistazo lo que quedó colgado. Los **finalizados no cambian**, y los **días pasados** mantienen exactamente el comportamiento actual.

---

## 2. Definiciones

| Término | Definición |
|---|---|
| **Pendiente** | Pedido/service con `estado_nro = 1`. (En `/api/pedidos-pendientes` el filtro incluye `[1,2]` + `sub_estado_desc='5'`; ver §6.) |
| **Finalizado** | `estado_nro = 2`. |
| **Hoy (Montevideo)** | `todayMontevideo()` (`lib/date-utils.ts:35-37`), basado en `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montevideo' })`. Formato `YYYY-MM-DD`. Uruguay no tiene DST → offset estable `-03:00`. |
| **Ayer (D-1)** | El día calendario inmediatamente anterior a "hoy Montevideo". **Estricto: D-1**, NO D-2 ni "día operativo previo" (decisión confirmada). |
| **Arrastre** | Pedido/service con `estado_nro = 1` y `fch_para = ayer`, que se muestra en la vista de **hoy** como un pendiente más. |
| **Regla de activación** | La dualidad aplica **únicamente** cuando `selectedDate === todayMontevideo()`. En cualquier otra fecha el comportamiento es el actual (un solo día, match exacto). |
| **`fch_para`** | Columna `DATE` en `pedidos`/`services`, pero **almacenada como `YYYYMMDD` sin guiones** (texto compacto). Ver `app/api/pedidos/route.ts:127`. |
| **`fch_hora_para`** | `TIMESTAMPTZ`. Usado en OR junto a `fch_para` para capturar pedidos por timestamp. |

> **Nota crítica de formato:** En `/api/pedidos` y en el frontend `fch_para` se compara como `YYYYMMDD` (sin guiones, ej. `20260529`). En cambio, `/api/pedidos-pendientes/route.ts:56` compara `.eq('fch_para', fecha)` donde `fecha` viene en `YYYY-MM-DD`. **Esta inconsistencia preexistente debe verificarse durante la implementación** (ver §8 / preguntas abiertas) — el almacenamiento real es `YYYYMMDD`.

---

## 3. Alcance

### Cambia (IN SCOPE)

- **Solo la vista del día actual** (`selectedDate === todayMontevideo()`).
- **Pendientes** (`estado_nro = 1`): se amplían a `fch_para IN (hoy, ayer)`.
- Aplica **tanto a `pedidos` como a `services`** (derivada confirmada).
- Conteos en `moviles_dia` (server-side, vía `fn_moviles_dia_recompute_counts` + triggers).
- APIs: `/api/pedidos`, `/api/pedidos-pendientes`, `/api/pedidos-pendientes/[movilId]` y equivalentes de services.
- Frontend: filtros de dataset en `pedidosCompletos` / `servicesCompletos` + filtro de realtime.

### NO cambia (OUT OF SCOPE)

- **Finalizados** (`estado_nro = 2`): siguen `fch_para = hoy` solamente → **asimetría intencional** (ver §4).
- **Días pasados**: comportamiento actual intacto (un solo día). El switch automático a vista 'finalizados' (`dashboard/page.tsx:704-717`) se conserva.
- **Sin distinción visual**: el arrastre de ayer se ve igual que un pendiente de hoy (sin badge/color). En consecuencia, sidebar/mapa/tabla **NO cambian su filtro `estado===1`**; solo hay que garantizar que el pedido de ayer **entre al dataset**.
- **Sin limpieza de filas viejas** de `moviles_dia` (no se toca el rollover; ver §5c).
- No se modifica `lib/horario-servicio.ts` (servicio nocturno) — solo se tiene en cuenta para el cálculo de "hoy".

---

## 4. Comportamiento esperado (tabla de casos)

Asumimos `selectedDate === hoy` salvo indicación. `hoy = 2026-05-29`, `ayer = 2026-05-28`.

| # | Caso | `estado_nro` | `fch_para` | ¿Aparece en pendientes de HOY? | ¿Aparece en finalizados? | Conteo `moviles_dia` (fila HOY) |
|---|---|---|---|---|---|---|
| 1 | Pedido normal de hoy, pendiente | 1 | hoy | **Sí** | No | suma |
| 2 | **Arrastre**: pendiente de ayer | 1 | ayer | **Sí** (nuevo) | No | suma (nuevo) |
| 3 | Arrastre que se finaliza hoy | 2 | ayer | **No** (sale de pendientes) | Sí, en **finalizados de AYER** (keyed por su `fch_para` original) | resta de fila HOY |
| 4 | Móvil con 0 pendientes propios de hoy + N arrastres de ayer sin finalizar | 1 | ayer | **Sí** → el móvil **REAPARECE** en la vista de hoy mostrando N | No | N (la fila de hoy del móvil pasa a tener conteo > 0) |
| 5 | Vista **finalizados de hoy** | 2 | hoy | — | **Solo `fch_para = hoy`** (excluye explícitamente ayer) | — |
| 6 | Pedido de hoy ya finalizado | 2 | hoy | No | Sí, en finalizados de hoy | no suma a pendientes |
| 7 | Madrugada / servicio nocturno: pedido cargado ayer a las 22:00, en curso a las 01:00 de hoy | 1 | ayer | **Sí** (es exactamente el motivo de la feature) | No | suma |
| 8 | Vista de un **día pasado** (`selectedDate < hoy`) | 1 | cualquiera | N/A — días pasados nunca muestran pendientes (vista forzada a 'finalizados', `:704-717`) | finalizados de ese día | conteo del día (sin dualidad) |

### Asimetría intencional (caso clave)

En la **vista de hoy**:

- **Pendientes** = `fch_para IN (ayer, hoy)`
- **Finalizados** = `fch_para = hoy` solamente

Un arrastre que se finaliza (caso 3) **desaparece de pendientes de hoy** y **NO aparece en finalizados de hoy** — queda en finalizados de **ayer** (su `fch_para` original nunca se modifica). Esto es **correcto y deseado**: el trabajo finalizado se contabiliza el día en que estaba planificado.

---

## 5. Cambios SQL (`moviles_dia`)

> **Decisión 3 confirmada:** el conteo dual se calcula **server-side** (modificar la función de recompute + triggers). NO se calcula en el front.

Archivo nuevo versionado e **idempotente** (`CREATE OR REPLACE`):

```
docs/sqls/2026-05-29-moviles-dia-arrastre-dia-anterior.sql
```

### 5a. Modificar `fn_moviles_dia_recompute_counts`

Ubicación actual: `docs/sqls/2026-05-27-moviles-dia-functions.sql:69-169`.

Estado actual (líneas relevantes):
- Pedidos: `SELECT COUNT(*) ... WHERE escenario=p_escenario AND movil=p_movil AND estado_nro=1 AND fch_para = v_fecha_ymd` (`:94-99`).
- Services: `... estado_nro=1 AND ((fch_hora_para entre v_fecha_inicio y v_fecha_fin) OR fch_para = v_fecha_ymd)` (`:108-116`).

**Cambio propuesto:**

1. Calcular "hoy Montevideo" dentro de SQL con conversión de timezone **explícita** (no asumir el TZ de la sesión DB):
   ```sql
   v_hoy_mvd date := (now() AT TIME ZONE 'America/Montevideo')::date;
   ```
2. Determinar si esta fila corresponde a hoy y, en ese caso, construir el set de fechas `YYYYMMDD` a contar:
   ```sql
   v_fecha_ymd      := to_char(p_fecha, 'YYYYMMDD');
   v_fecha_prev_ymd := to_char(p_fecha - 1, 'YYYYMMDD');   -- D-1 estricto
   v_es_hoy         := (p_fecha = v_hoy_mvd);
   ```
3. **Pedidos** — reemplazar el predicado de fecha:
   ```sql
   AND estado_nro = 1
   AND (
     CASE WHEN v_es_hoy
       THEN fch_para IN (v_fecha_ymd, v_fecha_prev_ymd)
       ELSE fch_para = v_fecha_ymd
     END
   )
   ```
   (Equivalente más portable: `AND fch_para = v_fecha_ymd OR (v_es_hoy AND fch_para = v_fecha_prev_ymd)` con paréntesis correctos.)
4. **Services** — análogo, manteniendo el OR con `fch_hora_para`. Solo se amplía la rama `fch_para`:
   ```sql
   AND estado_nro = 1
   AND (
     (fch_hora_para >= v_fecha_inicio::timestamptz AND fch_hora_para <= v_fecha_fin::timestamptz)
     OR fch_para = v_fecha_ymd
     OR (v_es_hoy AND fch_para = v_fecha_prev_ymd)
   )
   ```
   > **Decisión de diseño a confirmar (§11):** para services, ¿el arrastre por `fch_hora_para` del día anterior también cuenta, o solo por `fch_para`? El feature está definido sobre `fch_para`. Propuesta: **solo `fch_para`** para el arrastre, dejando `fch_hora_para` como hoy. Marcar en preguntas abiertas.

5. **`tiene_op` / flags** (`:118-167`): NO se tocan. Siguen evaluando solo `v_fecha_ymd`. El arrastre afecta únicamente los **conteos de pendientes**, no la visibilidad operativa base (el móvil reaparece porque `pedidos_pendientes > 0`, no por `tiene_op`).
   > **A validar (§11):** confirmar que el mapper `mapMovilDiaRowToMovilData()` (`app/api/moviles-dia/route.ts:110`) y el filtro de "móvil visible" hacen reaparecer un móvil cuando `cant_ped_pendientes > 0` aunque sus flags base no lo marquen. Si la visibilidad depende de `tiene_op` y NO de los conteos, el caso 4 (móvil reaparece) no se cumpliría solo con tocar conteos. **Punto de riesgo a verificar en implementación.**

### 5b. Triggers — doble disparo

Ubicación: `docs/sqls/2026-05-28-moviles-dia-triggers-pedidos-services.sql:50-178`.

**Problema actual:** los triggers solo recomputan cuando `NEW/OLD.fch_para = current_date` (`:58, :67, :77, :90` para pedidos; `:127, :138, :150, :163` para services). Un pedido con `fch_para = ayer` que cambia de estado **no dispara nada**, por lo que la fila de HOY del móvil no se actualizaría.

**Cambio propuesto (doble disparo):** cuando el row afectado tiene `fch_para = ayer` (= `v_hoy_mvd - 1`), además de (o en vez de) recomputar la fila de su propia fecha, **recomputar la fila de HOY del mismo móvil**.

Concretamente, en cada rama (INSERT/DELETE/UPDATE-old/UPDATE-new) de **ambas** trigger functions:

1. Calcular `v_hoy := (now() AT TIME ZONE 'America/Montevideo')::date;` y `v_ayer := v_hoy - 1;`.
2. Si `<row>.fch_para = v_hoy` → recompute fila de `v_hoy` (comportamiento actual, reemplazando `current_date` por `v_hoy` para coherencia de TZ — ver nota §5d).
3. **Nuevo:** si `<row>.fch_para = v_ayer` → recompute fila de `v_hoy` del mismo móvil:
   ```sql
   PERFORM fn_moviles_dia_recompute_counts(NEW.escenario, NEW.movil, v_hoy);
   ```
   (La función recomputa la fila de hoy y, por 5a, contará el arrastre. La fila de ayer no necesita recompute para el conteo dual; ver §5c.)

Detalles por trigger:
- **`trg_pedidos_to_moviles_dia_fn`**: derivar la fecha objetivo desde `NEW.fch_para` (INSERT/UPDATE-new) y `OLD.fch_para` (DELETE/UPDATE-old). En reasignación A→B, el doble disparo debe aplicar a ambos móviles si su `fch_para` era ayer.
- **`trg_services_to_moviles_dia_fn`**: ídem, considerando además `fch_hora_para::date` (el OR ya existente en `:127-128`, `:138-139`, etc.). Decidir si el doble disparo también se gatilla por `fch_hora_para::date = v_ayer` (coherente con 5a punto 4) — recomendado: alinear con la decisión de §5a.4.

> **Cuidado con `RETURN NULL`:** las trigger functions son `AFTER ... FOR EACH ROW` con `RETURN NULL` (`:96, :171`), correcto. No cambia.

### 5c. NO tocar rollover ni limpiar filas pasadas

- **Rollover cron** (`docs/sqls/2026-05-27-moviles-dia-rollover.sql:44-56`, pg_cron `'5 3 * * *'` = 00:05 UY) ejecuta `fn_moviles_dia_rebuild(current_date, current_date, NULL)` y **solo recomputa el día en curso**. NO se modifica.
- **Derivada confirmada:** cuando hoy pase a ser día pasado, su fila de `moviles_dia` queda con el conteo dual "sucio" (incluía ayer). Se **acepta**: los días pasados nunca muestran pendientes en la UI (`dashboard/page.tsx:704-717` fuerza 'finalizados'), así que el conteo sucio es **inofensivo**. **NO agregar limpieza al rollover.**
- `fn_moviles_dia_rebuild` (`2026-05-27-moviles-dia-functions.sql:215-339`): el CASE A (`v_fecha = current_date`) hace `PERFORM fn_moviles_dia_recompute_counts(...)` por cada fila (`:330-339`). Como esa función ya quedará con la lógica dual (5a) y `current_date` ≈ hoy, el rebuild de hoy contará automáticamente el arrastre. **Verificar** que `current_date` dentro del rebuild coincida con `v_hoy_mvd` (ver §5d). El CASE de fechas pasadas (solo finalizados) NO se toca.

### 5d. Nota de zona horaria (crítica)

- `fn_moviles_dia_recompute_counts` y los triggers usan hoy `current_date` (= fecha del TZ de la **sesión/servidor DB**), que **puede no ser** America/Montevideo. Entre **21:00 y 24:00 UY** (cuando UTC ya es el día siguiente), `current_date` en UTC adelanta un día → desfase.
- **Acción:** verificar el TZ de la sesión DB de Supabase (`SHOW timezone;`). Si no es `America/Montevideo`, usar **conversión explícita** `(now() AT TIME ZONE 'America/Montevideo')::date` en TODO punto que calcule "hoy" (recompute, triggers, y revisar el uso de `current_date` en triggers `:58` etc.).
- El front (`todayMontevideo()`), las APIs (mismo helper) y el SQL deben coincidir en su noción de "hoy". Discrepancia = arrastre fantasma o ausente en la franja nocturna (justo el escenario de uso).

---

## 6. Cambios de API

Patrón general: **si `fecha === todayMontevideo()`, el filtro de fecha para `estado=1` pasa a `fch_para IN (hoy, ayer)`** (formato `YYYYMMDD` sin guiones, manteniendo el OR con `fch_hora_para` donde aplique). Finalizados (`estado=2`) siguen `fch_para = hoy`.

### Helper compartido propuesto

En `lib/date-utils.ts`, agregar:

```ts
/**
 * Devuelve las fechas (YYYY-MM-DD) que cuentan como "pendiente" para `fecha`.
 * - Si `fecha` es hoy (Montevideo): [hoy, ayer]  (arrastre activo)
 * - En cualquier otra fecha: [fecha]
 */
export function pendienteDateRange(fecha: string, now: Date = new Date()): string[] {
  if (fecha !== todayMontevideo(now)) return [fecha];
  const ayer = daysAgoMontevideo(1, /* base = fecha @00:00 MVD */ ...);
  return [fecha, ayer];
}
```

> **Detalle de implementación:** `daysAgoMontevideo(1)` (`lib/date-utils.ts:66-69`) calcula sobre `now` real. Como `fecha === todayMontevideo()` en la rama de arrastre, `daysAgoMontevideo(1)` da el ayer correcto. Exponer también una variante que devuelva el formato compacto `YYYYMMDD` (o que el caller haga `.replace(/-/g,'')`), para `fch_para`. Cubrir con tests inyectando `now` (ver §9).

### 6a. `/api/pedidos` (`app/api/pedidos/route.ts:121-133`)

Endpoint general que trae **todos los estados** (filtro `estado` opcional, `:121-123`) y filtra fecha con OR (`:128-133`):

```ts
query.or(`and(fch_hora_para.gte.${fechaInicio},fch_hora_para.lte.${fechaFin}),fch_para.eq.${fechaSinGuiones}`)
```

**Problema:** ampliar el OR a incluir `fch_para = ayer` traería **también los finalizados de ayer** (no deseado en finalizados; §4 caso 5).

**Opciones:**

- **Opción A (recomendada, marcada):** ampliar el OR del backend para incluir el arrastre **solo cuando aplica** y dejar que el **cliente** separe por vista (el cliente ya filtra por `estado_nro` y vista en `pedidosForMap`/`pedidosCompletos`). Es decir: cuando `fecha === today`, agregar al OR `fch_para.eq.${ayerSinGuiones}`. El cliente, en vista 'finalizados', excluye explícitamente `fch_para = ayer` (§7). Ventaja: un solo round-trip, mínimo cambio backend. Desventaja: trae finalizados de ayer que el cliente descarta (volumen ~marginal; ver §8).
- **Opción B:** condicionar el OR al `estado` solicitado: si `estado=1` y `fecha=today` → incluir ayer; si `estado=2` → solo hoy. Más preciso pero el endpoint general suele llamarse **sin** `estado` (trae 1 y 2 juntos), así que no resuelve el caso mixto sin complicar el OR.

→ **Decisión: Opción A.** Backend amplía el dataset; cliente filtra por vista. Documentar que en vista 'finalizados' el cliente DEBE excluir `fch_para = ayer` (§7).

### 6b. `/api/pedidos-pendientes` (`route.ts:9-87`)

Trae pendientes globales del día. Hoy: `.eq('fch_para', fecha)` (`:56`) + `.in('estado_nro', [1,2])` (`:57`) + `.eq('sub_estado_desc','5')` (`:58`). Default `fecha = todayMontevideo()` (`:18`).

**Cambio:** reemplazar `.eq('fch_para', fecha)` por un filtro de rango cuando `fecha === todayMontevideo()`:
```ts
const rango = pendienteDateRange(fecha);          // [hoy] | [hoy, ayer]
const rangoCompact = rango.map(f => f.replace(/-/g, ''));
query = query.in('fch_para', rangoCompact);
```

> **Verificar formato:** `:56` hoy compara contra `fecha` en `YYYY-MM-DD`, pero el almacenamiento real es `YYYYMMDD` (ver §2 nota). Esto sugiere que **el filtro actual de este endpoint podría no estar matcheando** o que la columna en este escenario guarda `YYYY-MM-DD`. **Confirmar el formato real en producción** antes de implementar; usar el formato correcto consistentemente en el `.in()`.

### 6c. `/api/pedidos-pendientes/[movilId]` (`route.ts:37-81`)

Por móvil: `estado_nro=1`, `fch_para=fecha` (opcional), `movil=movilId`. Mismo cambio que 6b: cuando `fecha === today`, pasar a `.in('fch_para', [hoy, ayer])`. Sin fecha → mantener comportamiento actual (no filtra fecha).

### 6d. Equivalentes de services

Los endpoints de services (`/api/services` y, si existe, `/api/services-pendientes`/por-móvil) aplican el **mismo patrón**, manteniendo el OR `fch_hora_para` ∪ `fch_para`. Cuando `fecha === today` y `estado=1`, agregar la rama `fch_para = ayer` (alineado con la decisión de §5a.4 sobre `fch_hora_para` del arrastre).

### 6e. `/api/moviles-dia` (`route.ts:81-96`)

**No requiere cambios de query** (`.eq('escenario_id',...).eq('fecha',...)`): los conteos duales ya vienen calculados server-side por la función SQL (§5). Solo se beneficia. Verificar que el mapper (`:110`) refleje el conteo ampliado (lo hace, porque lee `pedidos_pendientes`/`services_pendientes` tal cual).

---

## 7. Cambios de Frontend

> **Principio (decisión 2):** sin distinción visual. Sidebar/mapa/tabla **NO cambian su filtro `estado===1`**. Lo único que cambia es que el **dataset** ahora incluye el arrastre.

### 7a. `pedidosCompletos` (`app/dashboard/page.tsx:2433-2484`)

Filtro de fecha actual (`:2444-2451`):
```ts
if (p.fch_para && p.fch_para === selectedDateCompact) return true;
if (p.fch_hora_para && p.fch_hora_para.startsWith(selectedDate)) return true;
if (!p.fch_para && !p.fch_hora_para) return true;
return false;
```

**Cambio:** cuando `isToday`, aceptar también `fch_para === ayerCompact` para pendientes (`estado_nro === 1`). Propuesta:
```ts
const ayerCompact = isToday ? daysAgoMontevideo(1).replace(/-/g, '') : null;
// ...
let resultado = Array.from(pedidosMap.values()).filter(p => {
  if (p.fch_para && p.fch_para === selectedDateCompact) return true;
  if (isToday && ayerCompact && Number(p.estado_nro) === 1 && p.fch_para === ayerCompact) return true; // ARRASTRE
  if (p.fch_hora_para && p.fch_hora_para.startsWith(selectedDate)) return true;
  if (!p.fch_para && !p.fch_hora_para) return true;
  return false;
});
```
- Importante: el arrastre solo se acepta para `estado_nro === 1`. Un finalizado de ayer (`estado===2`) **NO** entra (mantiene asimetría §4).
- Agregar `isToday` a las deps del `useMemo` (`:2484`).

### 7b. Filtrado por vista (pendientes vs finalizados)

- **Vista 'pendientes'** (`pedidosForMap` con `targetEstado=1`, `dashboard/page.tsx:2788-2798`; sidebar `estado===1`; tabla `estado===1`): incluye ayer+hoy estado1. Con 7a, el arrastre ya está en el dataset; estos filtros (`estado_nro === 1`) lo dejan pasar **sin cambios**.
- **Vista 'finalizados'** (`targetEstado=2`): debe incluir **solo `fch_para = hoy` estado2**. Como 7a solo deja entrar el arrastre cuando `estado===1`, los finalizados de ayer ya no están en el dataset de hoy → no se requiere exclusión adicional. **Verificar** que ningún path (ej. `/api/pedidos` Opción A trayendo finalizados de ayer) inyecte un `estado===2 + fch_para=ayer` que pase el filtro de fecha de `pedidosCompletos`. Si Opción A los trae, el guard de 7a (arrastre solo si `estado===1`) los descarta — **confirmado seguro**.

### 7c. `servicesCompletos` (`dashboard/page.tsx:2487+`)

Aplicar el **mismo patrón** que 7a (arrastre `fch_para === ayer` solo si `estado===1` e `isToday`), respetando que services usa también `fch_hora_para`.

### 7d. Realtime

El filtro de realtime se aplica en el mismo `pedidosCompletos`/`servicesCompletos` (los maps combinan iniciales + realtime, `:2437-2440`). Con 7a, un evento realtime de un pedido de **ayer estado1** mientras se ve **hoy** entra correctamente. Un evento de ayer **estado2** se descarta. No se requiere tocar la suscripción WS; solo el filtro derivado.

### 7e. Sidebar / Mapa / Tabla — confirmación

- **Sidebar** `MovilSelector.tsx:637, :794`: filtro `estado_nro === 1`. **Sin cambios.**
- **Mapa** `MapView.tsx` / `pedidosForMap` (`:2788-2798`): `estado_nro === targetEstado`. **Sin cambios.**
- **Tabla** `PedidosTableModal.tsx:329, :418`: filtro `estado_nro === 1`. **Sin cambios.** `computeDelayMinutes()` (`:137-150`) computará demora del arrastre con su `fch_hora_para`/`fch_para` real — **verificar** que un arrastre de ayer no muestre una demora de +24h engañosa (ver §8 / §11).

---

## 8. Edge cases / riesgos

1. **Asimetría pendientes/finalizados** (§4): documentada como **intencional**. Pendientes=`IN(ayer,hoy)`, finalizados=`hoy`. Un arrastre finalizado desaparece de hoy y vive en finalizados de ayer.
2. **Filas viejas de `moviles_dia` "sucias"** (§5c): aceptado. Días pasados no muestran pendientes → inofensivo. NO limpiar.
3. **Doble volumen en la vista de hoy** (~2x pedidos pendientes): impacto de performance esperado bajo-moderado. Existe `idx_pedidos_fch_para` (`supabase-full-migration.sql:438-442`) e `idx_pedidos_escenario_estado` que soportan el `.in('fch_para', [...])`. Verificar que el `.in()` use el índice (un `IN` de 2 valores lo hace). El doble dataset también pesa en render del mapa (thresholds de cluster 80/150 en `MapView.tsx:46-48`) — monitorear.
4. **Consistencia de "hoy" entre SQL/API/cliente** (§5d): TODOS deben usar America/Montevideo. Riesgo agudo en franja 21:00–24:00 UY. Es el bug más probable de esta feature.
5. **Switch automático de vista** (`:704-717`): solo cambia entre 'pendientes'/'finalizados' según `isToday`. No interfiere con el arrastre (que vive dentro de la vista 'pendientes' de hoy). Confirmar que al volver a hoy desde un día pasado el dataset se refetchea con el rango dual (depende de que `fetchPedidos` use el nuevo filtro/API).
6. **Realtime de un pedido de ayer mientras se ve hoy** (§7d): manejado por el filtro derivado.
7. **Demora engañosa en tabla** (§7e): un arrastre puede mostrar demora de >24h. **Decidir** si es aceptable (refleja la realidad: lleva colgado un día) o si hay que acotar. → preguntas abiertas.
8. **Reaparición de móvil (caso 4)** depende de que la visibilidad UI reaccione a `cant_ped_pendientes > 0` y no solo a flags base de `moviles_dia` (§5a punto 5). **Riesgo a verificar.**
9. **Formato `fch_para` `YYYY-MM-DD` vs `YYYYMMDD`** (§2, §6b): inconsistencia preexistente entre endpoints. Resolver el formato real antes de codear el `.in()`.

---

## 9. Plan de testing

Stack: **Vitest** (`vitest.config.ts`), tests en `__tests__/` (existen `date-utils.test.ts`, `dashboard-lifecycle.test.ts`, `estadoPedido.test.ts`, etc.).

### Unit
- `pendienteDateRange(fecha, now)`: con `fecha === todayMontevideo(now)` → `[hoy, ayer]`; con fecha pasada → `[fecha]`; inyectar `now` en franja nocturna (ej. `2026-05-29T23:30 UY = 2026-05-30T02:30Z`) para verificar TZ Montevideo. Ampliar `date-utils.test.ts`.
- Variante compacta `YYYYMMDD`.

### SQL (manual / script de verificación, estilo bloque al pie de los .sql)
- `fn_moviles_dia_recompute_counts` con `p_fecha = hoy`: cuenta `estado1 + fch_para IN (hoy, ayer)`.
- Con `p_fecha = pasada`: cuenta solo su día (sin arrastre).
- Trigger doble disparo: insertar/actualizar un pedido `fch_para = ayer estado1` → la fila de HOY del móvil incrementa `pedidos_pendientes`; finalizarlo (estado2) → decrementa la de hoy y la fila de ayer mantiene su finalizado.
- Verificar en franja nocturna que `(now() AT TIME ZONE 'America/Montevideo')::date` da el día UY correcto.

### Integración API
- `/api/pedidos?fecha=hoy`: devuelve pendientes de ayer+hoy (estado1).
- `/api/pedidos?fecha=pasada`: sin cambios (solo ese día).
- Finalizados de hoy: NO incluyen `fch_para = ayer` (tras filtro cliente; o backend si Opción B).
- `/api/pedidos-pendientes?fecha=hoy` y `/[movilId]`: incluyen arrastre. Verificar formato `fch_para`.

### E2E / manual
- Móvil con solo arrastre **reaparece** en la vista de hoy mostrando N (caso 4).
- Arrastre finalizado **desaparece** de pendientes de hoy y **aparece** en finalizados de **ayer** (caso 3).
- Sin distinción visual: el arrastre se ve idéntico a un pendiente de hoy en sidebar/mapa/tabla.
- Días pasados: sin pendientes (vista forzada a finalizados), comportamiento intacto.

---

## 10. Archivos a tocar (checklist)

### SQL
- [ ] **NUEVO** `docs/sqls/2026-05-29-moviles-dia-arrastre-dia-anterior.sql` — `CREATE OR REPLACE` idempotente de:
  - [ ] `fn_moviles_dia_recompute_counts` (lógica dual hoy/ayer, TZ Montevideo) — port de `2026-05-27-moviles-dia-functions.sql:69-169`.
  - [ ] `trg_pedidos_to_moviles_dia_fn` (doble disparo) — port de `2026-05-28-moviles-dia-triggers-pedidos-services.sql:50-98`.
  - [ ] `trg_services_to_moviles_dia_fn` (doble disparo) — port de `:119-173`.
  - [ ] Bloque de verificación al pie.
  - [ ] NO tocar rollover (`2026-05-27-moviles-dia-rollover.sql`) ni `fn_moviles_dia_rebuild`.

### Backend / API
- [ ] `lib/date-utils.ts` — agregar `pendienteDateRange()` (y variante compacta).
- [ ] `app/api/pedidos/route.ts:128-133` — ampliar OR de fecha con `fch_para = ayer` cuando `fecha === today` (Opción A).
- [ ] `app/api/pedidos-pendientes/route.ts:56` — `.eq('fch_para',...)` → `.in('fch_para', rango)`. Resolver formato.
- [ ] `app/api/pedidos-pendientes/[movilId]/route.ts:37-81` — ídem por móvil.
- [ ] Endpoints de services equivalentes — mismo patrón (OR `fch_hora_para` ∪ `fch_para IN (hoy,ayer)`).

### Frontend
- [ ] `app/dashboard/page.tsx:2433-2484` (`pedidosCompletos`) — aceptar arrastre `fch_para===ayer` solo si `estado===1` e `isToday`; agregar `isToday` a deps.
- [ ] `app/dashboard/page.tsx` (`servicesCompletos`, ~`:2487+`) — mismo patrón.
- [ ] `fetchPedidos`/`fetchServices` (`:1078-1123`) — verificar que el cambio de API/filtro se propague (probablemente sin cambios si el backend amplía el dataset).
- [ ] (Verificación, sin cambios esperados) `MovilSelector.tsx:637,794`, `MapView.tsx`, `PedidosTableModal.tsx:329,418`.

### Tests
- [ ] `__tests__/date-utils.test.ts` — `pendienteDateRange`.
- [ ] Nuevos casos en tests de dashboard/API según §9.

---

## 11. Cambios y temas adicionales (pendiente de input del usuario)

> _Sección reservada: el usuario agregará más requerimientos y temas a profundizar._

Temas ya identificados que requieren decisión del usuario:

- [ ] **Services + `fch_hora_para` del arrastre** (§5a.4 / §6d): ¿el arrastre de services se define solo por `fch_para = ayer`, o también por `fch_hora_para::date = ayer`?
- [ ] **Demora >24h en tabla extendida** (§7e / §8.7): ¿aceptable mostrar la demora real acumulada del arrastre, o acotarla?
- [ ] **Reaparición de móvil (caso 4)** (§5a.5 / §8.8): confirmar que la visibilidad UI reacciona a `cant_ped_pendientes > 0`. Si no, definir el ajuste.
- [ ] **Formato real de `fch_para`** (§2 / §6b): `YYYYMMDD` vs `YYYY-MM-DD` — confirmar en producción para no romper el `.in()`.
- [ ] **TZ de la sesión DB de Supabase** (§5d): confirmar y decidir si se fuerza conversión explícita en todos los puntos.
- [ ] _(placeholder para nuevos requerimientos)_

---

## Metadata

| Campo | Valor |
|---|---|
| **Fecha** | 2026-05-29 |
| **Branch** | `dev` |
| **Estado** | Borrador para revisión |
| **Repo** | `trackmovil` |
| **Archivo** | `docs/superpowers/specs/2026-05-29-pendientes-arrastre-dia-anterior-design.md` |
