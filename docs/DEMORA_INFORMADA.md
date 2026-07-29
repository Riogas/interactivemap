# Motor de demora informada — guía operativa

Función SQL pura + `pg_cron` que calcula, cada 10 minutos, cuánto va a demorar
un pedido por (zona, tipo de servicio) usando datos que TrackMovil ya tiene
(pedidos pendientes, móviles activos, historial real de cumplimiento), y lo
compara contra el número que informa el AS400.

> **El motor no alimenta a nadie.** El resultado se guarda en
> `demoras_calculadas` y se muestra como comparativa en el dashboard de
> métricas de cumplimiento (`/dashboard/metricas-cumplimiento`). El número
> **no se informa a ningún cliente todavía** — ver el riesgo R1 más abajo
> antes de considerarlo.

Diseño completo: `docs/superpowers/specs/2026-07-28-motor-demora-informada-design.md`.

---

## 1. Orden de aplicación en el SQL Editor de Supabase

Todo se aplica pegando el contenido del archivo en el **SQL Editor de
Supabase**, no con un script de migración normal (`psql`, herramienta de
migraciones, CI): el Postgres de producción está firewalleado y no hay
acceso directo desde fuera de Supabase. Es el mismo mecanismo que ya usa el
resto de `docs/sqls/` en este repo.

Los 7 archivos, **en este orden exacto**:

1. `docs/sqls/2026-07-29-demoras-acabado.sql` — función `demoras_acabado`:
   clamp → suavizado asimétrico → redondeo hacia arriba al escalón. El orden
   interno (crudo → clamp → suavizado → redondeo) es parte del contrato: si se
   redondea antes de suavizar, el suavizado opera sobre escalones y se traba
   en falso.
2. `docs/sqls/2026-07-29-demoras-capacidad.sql` — función `demoras_capacidad`:
   capacidad efectiva por (zona, tipo), prorrateando la presencia de cada
   móvil activo (peso 1 prioridad / `alpha` tránsito, normalizado por móvil
   dentro de cada tipo).
3. `docs/sqls/2026-07-29-demoras-ritmo.sql` — primera versión de
   `demoras_ritmo` (cascada `ZONA → GLOBAL`). **Queda superseded por el
   archivo 6**, que la reemplaza con `CREATE OR REPLACE FUNCTION` — que NO
   requiere que la función preexista, la crea si falta y la reemplaza si
   está. Este archivo se mantiene en la secuencia por prolijidad histórica
   (así se aplicó la primera vez) y porque aplicarlo no rompe nada, **no**
   porque el archivo 6 lo necesite: la dependencia real del archivo 6 es la
   tabla `demoras_config`, creada en el archivo 4.
4. `docs/sqls/2026-07-29-demoras-calculadas-tabla.sql` — crea
   `demoras_calculadas` (los hechos) y `demoras_config` (la configuración),
   con el seed de los tres tipos del escenario 1000.
5. `docs/sqls/2026-07-29-demoras-calcular-run.sql` — función
   `demoras_calcular_run`, el orquestador. Consume las tres funciones
   anteriores y escribe en `demoras_calculadas`.
6. `docs/sqls/2026-07-30-demoras-ritmo-cascada.sql` — **supersede** la
   versión del archivo 3. Sube `demoras_ritmo` de la cascada `ZONA → GLOBAL`
   a la cascada completa de 4 niveles `CHOFER → MOVIL → ZONA → GLOBAL`, con
   orden configurable desde `demoras_config.ritmo_cascada`. `CREATE OR
   REPLACE FUNCTION` sobre la misma firma, así que no requiere tocar nada
   que ya la llame.
7. `docs/sqls/2026-07-29-demoras-cron.sql` — programa los dos jobs de
   `pg_cron` (`demoras-calcular` cada 10 min, `demoras-purga` diario) y
   **requiere `pg_cron` habilitado** en el proyecto de Supabase (Database →
   Extensions → `pg_cron`).

Las 7 son idempotentes: se pueden volver a pegar sin romper nada si hay dudas
sobre si ya se aplicaron.

---

## 2. Verificación post-apply

```sql
-- 1) Una corrida manual, fuera del cron
SELECT demoras_calcular_run(now());

-- 2) Qué escribió esa corrida
SELECT zona_id, tipo_servicio, demora_informada, demora_as400,
       pendientes_asignados + pendientes_sin_asignar AS pendientes,
       capacidad_efectiva, ritmo_usado, ritmo_origen, clampeado
  FROM demoras_calculadas
 WHERE corrida_at = (SELECT max(corrida_at) FROM demoras_calculadas)
 ORDER BY demora_informada DESC LIMIT 20;

-- 3) Los jobs quedaron programados
SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'demoras-%';
```

Si `demoras_calcular_run(now())` devuelve `0`, no es necesariamente un error:
puede ser que estés fuera de la ventana horaria de los tres tipos, o que
`motor_activo = false`. Revisá `demoras_config` antes de asumir que algo está
roto (ver §4).

Para confirmar que el cron efectivamente corrió (no solo que quedó
programado):

```sql
SELECT count(*), min(corrida_at), max(corrida_at) FROM demoras_calculadas;
```

---

## 3. La tabla `demoras_config`

Vive en `docs/sqls/2026-07-29-demoras-calculadas-tabla.sql`. La configuración
es **por `(escenario_id, tipo_servicio)`**, PK compuesta. Editable en caliente
por SQL (la pantalla en Preferencias Globales es un incremento posterior, una
vez que el motor haya corrido unos días).

**Un tipo sin fila no se calcula.** Es la forma de apagar un tipo entero sin
borrar histórico: basta con `DELETE FROM demoras_config WHERE escenario_id=1000
AND tipo_servicio='NOCTURNO'` y ese tipo deja de escribir filas nuevas (las
viejas quedan intactas para auditoría).

El seed inicial siembra los tres tipos del escenario 1000:

| escenario_id | tipo_servicio | hora_inicio | hora_fin |
|---|---|---|---|
| 1000 | URGENTE | 07:00 | 23:30 |
| 1000 | NOCTURNO | **18:00** | 23:30 |
| 1000 | SERVICE | 07:00 | 23:30 |

NOCTURNO arranca con su propia ventana (18:00–23:30), distinta de URGENTE y
SERVICE (07:00–23:30) — es el caso que motivó que la config fuera por-tipo en
vez de global: calcular demora de nocturnos a las 8 de la mañana no significa
nada.

### Columnas y defaults

| Columna | Default | Para qué |
|---|---|---|
| `motor_activo` | `true` | Interruptor del tipo. `false` = no se calcula, sin borrar histórico. |
| `min_minutos` | `30` | Piso del clamp. |
| `max_minutos` | `120` | Techo del clamp. También es lo que se informa cuando `capacidad_efectiva <= 0` (sin nadie trabajando la zona). |
| `escalon_minutos` | `15` | Redondeo hacia **arriba** al múltiplo, después del suavizado. |
| `subida_max` | `30` | Cuánto puede subir `demora_suavizada` por corrida (cada 10 min) respecto de la corrida anterior. |
| `bajada_max` | `15` | Cuánto puede bajar por corrida. Asimétrico a propósito: bajar es más lento que subir, para no informar una mejora que todavía no es real. |
| `estadistico` | `MEDIANA` | Cuál de las cuatro estadísticas del ritmo (`MEDIA`, `MEDIANA`, `P75`, `P90`) alimenta el cálculo. Las otras tres quedan guardadas igual, para reprocesar histórico sin recalcular. |
| `ritmo_cascada` | `CHOFER,MOVIL,ZONA,GLOBAL` | Orden de atribución del ritmo. Ver §3.1. |
| `ritmo_default_minutos` | `30` | Piso cuando no hay ninguna estadística disponible (ni zona ni global). Se persiste en `demoras_calculadas.ritmo_usado` con `ritmo_origen='DEFECTO'`. |
| `factor_calibracion` | `1.0` | Multiplicador global del resultado crudo. Existe por el riesgo R1 — ver §6. |
| `hora_inicio` / `hora_fin` | `07:00` / `23:30` | Ventana operativa **de ese tipo**. Fuera de ventana, ese tipo no escribe fila. |
| `updated_at` | `now()` | Bookkeeping, no la actualiza el motor — es para auditar ediciones manuales de la config. |
| `updated_by` | `NULL` | Bookkeeping, texto libre; nadie la setea automáticamente hoy. |

Constraints en la tabla (la base valida en vez de confiar, porque es config
editable por gente): `min_minutos >= 0`, `max_minutos >= 0`, `max_minutos >=
min_minutos`, `escalon_minutos > 0`, `subida_max >= 0`, `bajada_max >= 0`,
`ritmo_default_minutos > 0`, `factor_calibracion > 0`, `estadistico IN
('MEDIA','MEDIANA','P75','P90')`, `tipo_servicio IN
('URGENTE','NOCTURNO','SERVICE')`.

### 3.1 `ritmo_cascada`: cómo se resuelve

CSV, se recorre de izquierda a derecha. **Gana el primer nivel que llegue al
mínimo de muestras** (`p_min_muestras`, default 5 en `demoras_ritmo`).
Niveles válidos: `CHOFER`, `MOVIL`, `ZONA`, `GLOBAL`. Niveles desconocidos en
el CSV se ignoran; una lista vacía o toda inválida cae al default completo.

**`GLOBAL` se evalúa siempre último, aunque no figure en la lista** — es la
red final: es imposible configurar el motor de forma que se quede sin ritmo.
Una lista de solo `GLOBAL` (`ritmo_cascada='GLOBAL'`) es una configuración
válida en sí misma (línea base estable cuando los datos de chofer no son
confiables), no se trata como lista vacía.

Si ni siquiera `GLOBAL` tiene una muestra en la ventana (el tipo de servicio
no tuvo un solo hecho en `metricas_cumplimiento` en los últimos días), no hay
ninguna estadística real que usar: `ritmo_usado` cae al piso configurado
(`ritmo_default_minutos`) y `ritmo_origen` queda `'DEFECTO'` — deliberadamente
distinto de `'GLOBAL'`, para no mentir que hubo un cálculo global que en
realidad nunca ocurrió.

---

## 4. Cómo apagar el motor en caliente

Motor entero (los tres tipos del escenario):

```sql
UPDATE demoras_config SET motor_activo = false WHERE escenario_id = 1000;
```

Un solo tipo (por ejemplo, si NOCTURNO da resultados ruidosos y hay que
pausarlo sin tocar URGENTE/SERVICE):

```sql
UPDATE demoras_config SET motor_activo = false
 WHERE escenario_id = 1000 AND tipo_servicio = 'NOCTURNO';
```

Volver a prender es el mismo `UPDATE` con `true`. El cron sigue disparando
cada 10 minutos igual (no hay que tocar `pg_cron`); la función simplemente no
escribe filas para el/los tipo(s) apagado(s), y el histórico queda intacto.

---

## 5. Cómo cambiar el estadístico o la cascada, por tipo

Cambiar cuál estadística alimenta el cálculo (por ejemplo, pasar URGENTE a
`P75` para ser más conservador):

```sql
UPDATE demoras_config SET estadistico = 'P75'
 WHERE escenario_id = 1000 AND tipo_servicio = 'URGENTE';
```

Cambiar el orden de la cascada (por ejemplo, saltear CHOFER si el dato de
chofer no es confiable para ese tipo):

```sql
UPDATE demoras_config SET ritmo_cascada = 'MOVIL,ZONA,GLOBAL'
 WHERE escenario_id = 1000 AND tipo_servicio = 'NOCTURNO';
```

Ningún cambio en `demoras_config` requiere deploy ni reinicio: la próxima
corrida del cron (máximo 10 minutos después) ya lo toma.

### Advertencia sobre el blend de CHOFER y MOVIL

**En los niveles `CHOFER` y `MOVIL`, las cuatro estadísticas (`media`,
`mediana`, `p75`, `p90`) son promedios ponderados por el aporte de cada móvil
a la zona — no percentiles recalculados sobre una población de valores
crudos.** Una zona tiene varios móviles activos, cada uno con su propio
historial; el nivel CHOFER/MOVIL resuelve la zona combinando el ritmo propio
de cada chofer/móvil, ponderado por el mismo prorrateo que usa
`demoras_capacidad` (peso 1 prioridad / `alpha` tránsito, normalizado).

Promediar medianas no es la mediana del pool combinado. Con `P75`/`P90` el
sesgo es asimétrico — el blend aplasta la cola, que es justo el efecto que se
busca al elegir un estadístico conservador, pero significa que ese número no
es "el P75 real de la población de pedidos de la zona". Está acotado entre el
mínimo y el máximo de lo que combina, así que no puede inventar un valor fuera
de rango — pero **quien compare esa columna entre filas resueltas a distinto
nivel (una `ZONA` real contra un blend `CHOFER`) tiene que saber que no está
comparando lo mismo.**

Texto fuente completo en el `COMMENT ON FUNCTION demoras_ritmo(...)` de
`docs/sqls/2026-07-30-demoras-ritmo-cascada.sql`, y en el bloque de comentarios
sobre las CTEs `por_zona_movil` / `por_zona_chofer` del mismo archivo.

---

## 6. Riesgo R1 — copiado íntegro de la spec

> **R1 — El ritmo puede estar doble-contando la cola (ALTO).**
> `demora_efectiva_mins` mide asignación→cumplimiento, y ese tiempo **ya
> incluye la espera en cola** del momento en que se midió. Multiplicarlo por
> la cantidad de pendientes puede inflar el resultado, porque la espera se
> cuenta dos veces.
>
> Es una aproximación heurística, no una fórmula de teoría de colas.
> Mitigación: `demora_factor_calibracion` permite ajustar el nivel global sin
> tocar código, y la fase de comparación contra el AS400 existe precisamente
> para calibrarlo. Si la brecha resulta sistemática y proporcional, se ajusta
> el factor; si es errática, hay que repensar el modelo del ritmo.
>
> **Esto debe quedar claro antes de que el número se informe a un cliente.**

(En el código el campo se llama `demoras_config.factor_calibracion`; la spec
lo nombra `demora_factor_calibracion` en prosa. Es la misma columna.)

**El número calculado no debe informarse a un cliente por ningún canal hasta
que la brecha contra el AS400 esté calibrada.** Hoy el motor es solo
comparativa (§ arriba). Bajar el factor de calibración sin haber mirado la
serie de brecha en el dashboard es exactamente el escenario que R1 advierte.

---

## 7. Retención

180 días de detalle en `demoras_calculadas`, purgados por el job diario
`demoras-purga` (`cron.job`, 04:43 UTC). A ~254 filas por corrida × ~99
corridas/día (cada 10 min entre las ventanas de los tres tipos) da
**~25.000 filas/día, ~4,5M filas en régimen**.

Se eligieron 180 días y no 30 para poder comparar contra el AS400 sobre media
temporada, no sobre un mes suelto. Si el volumen se vuelve un problema,
achicar la retención es un solo `UPDATE` a la expresión del job de purga (no
requiere migración).

---

## 8. Por qué el cron corre cada 10 minutos las 24 horas

`docs/sqls/2026-07-29-demoras-cron.sql` programa `demoras-calcular` con
`*/10 * * * *` **sin acotar horario**, a propósito. La ventana operativa
(07:00–23:30 Montevideo para URGENTE/SERVICE, 18:00–23:30 para NOCTURNO) se
evalúa **adentro** de `demoras_calcular_run`, no en la expresión cron.

Motivo: `pg_cron` corre en **UTC**, y la ventana de Montevideo (UTC-3) cruza
la medianoche UTC — 07:00–23:30 Montevideo es 10:00–02:30 UTC del día
siguiente. Expresar eso en cron obligaría a partirlo en dos expresiones (una
antes y otra después de medianoche UTC) que se pueden desincronizar sin que
nadie lo note si algún día cambia la ventana. Con la lógica adentro de la
función, cambiar el horario de un tipo es el `UPDATE` de `demoras_config` del
§5 — no toca el cron.

Cuando la corrida cae fuera de ventana para los tres tipos (o los tres están
`motor_activo=false`), `demoras_calcular_run` no escribe nada y devuelve `0`
— no es un error, es el comportamiento esperado.

---

## 9. El advisory lock

`demoras_calcular_run` toma `pg_try_advisory_xact_lock(2180637405)` como
primera línea. Si ya hay una corrida en curso (por ejemplo, una corrida
manual larga solapándose con el disparo del cron), la segunda no espera: hace
`RAISE NOTICE` y devuelve `0` inmediatamente. El lock es de **transacción**
(`_xact_`), así que se libera solo al terminar — por commit, por rollback ante
excepción, o por cancelación (`statement_timeout`, `pg_cancel_backend`) —, sin
riesgo de quedar pegado para la sesión.

Si ves corridas devolviendo `0` de forma repetida sin estar fuera de ventana
ni con el motor apagado, es la señal a revisar: puede haber una corrida previa
trabada.

---

## 10. Diagnóstico: ¿el cron viene corriendo bien?

Que `cron.job` liste el job con `active=true` (§2) solo confirma que quedó
**programado** — no que siga **corriendo con éxito**. Como los cuerpos
`plpgsql` no se validan al crearse (§12), un error que no se disparó en la
corrida manual de la verificación post-apply puede aparecer recién con datos
reales seis semanas después, y el cron **falla en silencio** cada 10 minutos
hasta que alguien lo nota. Estas queries son la forma de notarlo antes:

```sql
-- ¿El cron de calculo viene corriendo bien? (status, duracion, ultimo error)
SELECT runid, status, start_time, end_time, return_message
  FROM cron.job_run_details
 WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'demoras-calcular')
 ORDER BY start_time DESC LIMIT 20;

-- Lo mismo para la purga diaria
SELECT runid, status, start_time, end_time, return_message
  FROM cron.job_run_details
 WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'demoras-purga')
 ORDER BY start_time DESC LIMIT 10;

-- ¿La retencion de 180 dias esta funcionando? (la fila mas vieja no deberia
-- superar esa antiguedad; si la supera, la purga diaria no esta corriendo)
SELECT min(corrida_at) AS mas_vieja, now() - min(corrida_at) AS antiguedad
  FROM demoras_calculadas;
```

`status = 'succeeded'` es lo esperado; `'failed'` con `return_message` no
vacío es la señal de que algo rompió (mismo patrón de diagnóstico que ya usa
el repo en `docs/sqls/2026-05-27-moviles-dia-rollover.sql` y
`docs/sqls/2026-07-22-metricas-cumplimiento-cron.sql`). Si `demoras-calcular`
viene en `'succeeded'` pero hace horas que `demoras_calculadas` no crece,
sospechá primero de la ventana horaria y de `motor_activo` (§4) antes que de
un bug — es el comportamiento esperado fuera de ventana (§8).

Estas mismas tres queries están comentadas al final de
`docs/sqls/2026-07-29-demoras-cron.sql`, junto a las del §2.

---

## 11. Qué falta fuera de las migraciones para que la card se vea

Aplicar las 7 migraciones deja el motor calculando y escribiendo en
`demoras_calculadas`, pero la card de comparativa en
`/dashboard/metricas-cumplimiento` (y el endpoint `GET
/api/demoras/comparativa` que la alimenta) tienen **dos gates adicionales**
que no dependen de SQL:

1. **`METRICAS_DASHBOARD_ALLOWED_EMAILS`** — variable de entorno, CSV de
   emails (case-insensitive) autorizados a ver el dashboard completo (comparte
   umbral con `GET /api/metricas/dashboard`, del que esta card es un
   apéndice). Sin esta env seteada en prod, el gate por email no bloquea
   (para no romper dev) y el endpoint queda dependiendo solo del gate por
   headers `x-track-*`, que **es forjable por el cliente**. Setearla en el
   `.env` de prod es obligatorio antes de exponer el dashboard — ver
   `.env.example` línea ~130 y la sección de seguridad de
   `docs/METRICAS_CUMPLIMIENTO.md`.

2. **Funcionalidad `Estadisticas Cumplimiento` en SecuritySuite** — el guard
   de `/dashboard/metricas-cumplimiento`
   (`app/dashboard/metricas-cumplimiento/layout.tsx`) exige `isRoot(user) ||
   hasFuncionalidad(user?.roles, 'Estadisticas Cumplimiento')`. Esa
   funcionalidad **hay que darla de alta en SecuritySuite** (nombre EXACTO
   `Estadisticas Cumplimiento`) y asignarla a los roles que deban ver la
   pantalla — es tarea de admin en secapi, no de este repo. Mientras no se dé
   de alta, solo usuarios `root` entran a la pantalla.

Sin estos dos, la parte SQL corre igual (el cron sigue escribiendo
`demoras_calculadas`), pero nadie va a poder ver la card.

---

## 12. Cómo validar cambios futuros con el harness

Cualquier cambio a estas funciones (`demoras_acabado`, `demoras_capacidad`,
`demoras_ritmo`, `demoras_calcular_run`) se valida antes de aplicar en
producción con:

```bash
bash scripts/sql-harness/run.sh <migracion1.sql> [<migracion2.sql> ...] --assert <assert.sql>
```

El script (`scripts/sql-harness/run.sh`) levanta un Postgres 15 descartable
en Docker, aplica `scripts/sql-harness/00-stubs.sql` (tablas mínimas que
imitan el esquema real), aplica las migraciones pasadas **con
`--single-transaction`** (si algo falla, rollback completo, igual que el SQL
Editor de Supabase), y corre el archivo de asserts. Si el assert menciona
`advisory_xact_lock`, además lanza dos conexiones concurrentes para probar
que el lock efectivamente serializa. Al terminar (éxito o falla) tira abajo
el contenedor.

Ejemplo, para revalidar la cascada del ritmo:

```bash
bash scripts/sql-harness/run.sh \
  docs/sqls/2026-07-29-demoras-acabado.sql \
  docs/sqls/2026-07-29-demoras-capacidad.sql \
  docs/sqls/2026-07-29-demoras-ritmo.sql \
  docs/sqls/2026-07-29-demoras-calculadas-tabla.sql \
  docs/sqls/2026-07-29-demoras-calcular-run.sql \
  docs/sqls/2026-07-30-demoras-ritmo-cascada.sql \
  --assert scripts/sql-harness/assert-ritmo.sql
```

Asserts existentes: `assert-acabado.sql`, `assert-capacidad.sql`,
`assert-ritmo.sql`, `assert-run.sql`.

### Por qué existe

**Los cuerpos `plpgsql` no se validan al crearse.** `CREATE OR REPLACE
FUNCTION` con `LANGUAGE plpgsql` compila la sintaxis pero no ejecuta el
cuerpo — un `CASE` mal armado, una columna que no existe, un tipo que no
castea (el bug real que ya rompió esto una vez: `fch_para` es `DATE` en
producción, no `TEXT`, y compararlo con `to_char(...)` tira `operator does
not exist: date = text`, pero **solo al ejecutar**, no al aplicar la
migración) pasan el `CREATE` sin ningún error. El error solo salta la primera
vez que `pg_cron` dispara la función en producción — y si eso pasa, el cron
falla **callado** cada 10 minutos hasta que alguien lo nota. El harness existe
para mover ese descubrimiento de "en producción, en silencio" a "en el
laptop, antes del commit".

---

## 13. Preguntas frecuentes rápidas

- **¿Por qué hay dos números, `demora_suavizada` y `demora_informada`?**
  `demora_suavizada` es continua (sin redondear) y es el estado que arrastra
  la próxima corrida; `demora_informada` es la redondeada, la que se muestra.
  Sin separarlos, el redondeo se comería los incrementos chicos y el valor
  nunca se movería.
- **¿Por qué `sin_capacidad=true` informa el techo (`max_minutos`) y no el
  piso?** Porque si no hay ningún móvil activo en la zona, la respuesta
  honesta a "¿cuánto demora?" no es "poco": un pedido que entre ahora no
  tiene quién lo atienda. El piso solo aplica cuando SÍ hay capacidad y la
  cola está vacía — el caso genuinamente bueno.
- **¿Puedo aplicar solo el archivo 6 sin el 3?** En términos de dependencias,
  sí: `CREATE OR REPLACE FUNCTION` no requiere que la función preexista — la
  crea si falta, la reemplaza si está. El archivo 6 es una definición
  autosuficiente (mismo `RETURNS TABLE`, cuerpo completo, su propio
  `COMMENT`); su única dependencia real es la tabla `demoras_config`, que
  crea el archivo 4, no el 3. El archivo 3 se mantiene en el orden de
  aplicación por prolijidad histórica y porque es inofensivo aplicarlo, no
  porque el 6 lo necesite.
