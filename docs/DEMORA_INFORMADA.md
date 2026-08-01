# Motor de demora informada — guía operativa

Función SQL pura + `pg_cron` que calcula, cada 10 minutos, cuánto va a demorar
un pedido por (**escenario**, zona, tipo de servicio) usando datos que
TrackMovil ya tiene (pedidos pendientes, móviles activos, historial real de
cumplimiento), y lo compara contra el número que informa el AS400.

> **El motor no alimenta a nadie.** El resultado se guarda en
> `demoras_calculadas` y se muestra como comparativa en el dashboard de
> métricas de cumplimiento (`/dashboard/metricas-cumplimiento`). El número
> **no se informa a ningún cliente todavía** — ver el riesgo R1 más abajo
> antes de considerarlo.

Diseño completo: `docs/superpowers/specs/2026-07-28-motor-demora-informada-design.md`,
[`DEMORA_MODELO.md`](DEMORA_MODELO.md) (el diagnóstico original y el primer
modelo, `CAPACIDAD_PROMEDIO`) y [`DEMORA_MODELO_TRAMOS.md`](DEMORA_MODELO_TRAMOS.md)
(el modelo vigente, `CONSUMO_TRAMOS`).

> **El modelo vigente es `CONSUMO_TRAMOS` y es el default.** Reemplaza a
> `PROXIMO_HUECO` (que a su vez había reemplazado a `CAPACIDAD_PROMEDIO`, el
> modelo original). La capacidad de una zona ya no es un número fijo ni el
> hueco de un solo móvil: crece por escalones a medida que los móviles
> compartidos con otras zonas terminan sus compromisos, y la demanda se
> consume tramo a tramo — ver `DEMORA_MODELO_TRAMOS.md` para el porqué y el
> algoritmo completo. `CAPACIDAD_PROMEDIO` (el modelo original) se conserva
> intacto, no como respaldo sino para poder correr los dos sobre los mismos
> datos y medir la diferencia en vez de discutirla: `demoras_modelo.modelo`
> elige cuál corre, y los dos escriben las mismas columnas de
> `demoras_calculadas` (con las columnas propias de cada uno en `NULL` para
> el otro) — ver §3. `PROXIMO_HUECO` fue retirado: ya no es un valor válido
> de `demoras_modelo.modelo` (el `CHECK` lo rechaza) y su código
> (`demoras_servidores`, `demoras_proximo_hueco`) queda deployado pero
> **obsoleto y sin consumidor** — ver §3.2.
>
> **El motor calcula todos los escenarios que tengan fila en
> `demoras_modelo`**, no solo el 1000. Hasta la tanda de `CONSUMO_TRAMOS` el
> orquestador tenía el escenario clavado en el código
> (`v_esc integer := 1000`); ahora recorre `FOR m IN SELECT * FROM
> demoras_modelo ...`. Cargarle una fila a `demoras_modelo` para otro
> escenario ya alcanza para que se calcule — ver §3 y §8.

---

## 1. Orden de aplicación en el SQL Editor de Supabase

Todo se aplica pegando el contenido del archivo en el **SQL Editor de
Supabase**, no con un script de migración normal (`psql`, herramienta de
migraciones, CI): el Postgres de producción está firewalleado y no hay
acceso directo desde fuera de Supabase. Es el mismo mecanismo que ya usa el
resto de `docs/sqls/` en este repo.

**El archivo único vigente es
[`docs/sqls/2026-08-01-MOTOR-DEMORA-TRAMOS-TODO.sql`](sqls/2026-08-01-MOTOR-DEMORA-TRAMOS-TODO.sql).**
Trae las **veinte** migraciones de las **dos tandas** (la de `PROXIMO_HUECO`
completa, más las siete de `CONSUMO_TRAMOS` encima), en el orden exacto que
se explica abajo, listas para pegar de una sola vez. El bundle anterior
(`docs/sqls/2026-07-31-MOTOR-DEMORA-TODO.sql`) queda como registro histórico
de la primera tanda; no hay que volver a pegarlo, el archivo nuevo ya lo
incluye completo.

> **Por qué el archivo nuevo trae las DOS tandas, no solo la diferencia.**
> Varias migraciones de la tanda anterior tienen efectos de esquema que sus
> reemplazos de esta tanda no repiten: el `DROP COLUMN` + backup de
> `2026-07-31-demoras-calcular-run-v2.sql` sobre `demoras_config`, y el
> `ADD COLUMN` de `cola_por_delante`/`moviles_considerados` sobre
> `demoras_calculadas` que la v3 de esta tanda **asume ya puesto** (no lo
> vuelve a agregar). Pegar solo "lo nuevo" sobre una base que no tuviera ya
> la tanda anterior aplicada deja columnas faltantes y el cron fallando en
> runtime. El archivo es idempotente incluso si la tanda anterior ya está
> aplicada (que es el caso real de producción hoy): repetir
> `CREATE OR REPLACE` / `ADD COLUMN IF NOT EXISTS` / `DROP ... IF EXISTS` no
> rompe ni duplica nada — **verificado pegando el archivo entero dos veces
> seguidas contra el harness** (ver §12).

> **Paso 0 — antes de pegar el archivo 1, sin excepción:**
>
> ```sql
> UPDATE demoras_config SET motor_activo = false;
> ```
>
> **Sin `WHERE escenario_id`, a diferencia de la guía de la tanda anterior.**
> El orquestador de `CONSUMO_TRAMOS` ya no tiene el escenario clavado: apagar
> solo el 1000 dejaría prendido cualquier otro escenario que ya se hubiera
> dado de alta para cuando esto se pegue — exactamente el riesgo que este
> paso existe para evitar. Hoy en producción solo existe el escenario 1000,
> así que el efecto práctico es el mismo que antes; la versión sin `WHERE`
> es la que sigue siendo correcta el día que exista un segundo escenario.
> Para apagar solo uno, agregar `WHERE escenario_id = 1000` (ver §4).
>
> Entre que se pega un archivo que cambia el esquema y el archivo que
> termina de migrar el orquestador, el motor queda en un estado
> **híbrido**: mitad esquema viejo, mitad nuevo. El cron **no se entera y
> no se detiene solo** — sigue disparando cada 10 minutos con lo que haya
> pegado hasta ese momento —, y esas corridas pueden escribir con
> `modelo_version = NULL` o con columnas a medio migrar. Este `UPDATE`
> apaga el motor para toda la ventana de la migración, sin depender de
> cuán rápido se peguen los 20 archivos siguientes, y se revierte en el
> **Paso final** de más abajo — recién después del último archivo y de la
> verificación del §2.

Las veinte migraciones, **en este orden exacto**:

**Tanda `PROXIMO_HUECO` (2026-07-29 / 2026-07-31), archivos 1 a 11 — sin
cambios de código de fondo, salvo la idempotencia del 9 y los `REVOKE`/`GRANT`
que le faltaban al 1 y al 2 (review final de rama):**

1. `docs/sqls/2026-07-29-demoras-acabado.sql` — función `demoras_acabado`:
   clamp → suavizado asimétrico → redondeo hacia arriba al escalón. Cuerpo
   sin cambios; gana su `REVOKE`/`GRANT` (no lo tenía desde 2026-07-29).
2. `docs/sqls/2026-07-29-demoras-capacidad.sql` — función `demoras_capacidad`:
   capacidad efectiva por (zona, tipo). La sigue usando el modelo
   `CAPACIDAD_PROMEDIO` y los conteos `moviles_activos` / `moviles_prioridad`
   / `moviles_transito` que se persisten sea cual sea el modelo. Cuerpo sin
   cambios; gana su `REVOKE`/`GRANT` (mismo motivo que el 1).
3. `docs/sqls/2026-07-29-demoras-calculadas-tabla.sql` — crea
   `demoras_calculadas` (los hechos) y `demoras_config` (la configuración
   **operativa**). Sin cambios.
4. `docs/sqls/2026-07-31-demoras-modelo-tabla.sql` — crea `demoras_modelo`
   (todos los parámetros del **cálculo**, una fila por escenario) y
   `demoras_modelo_historial` (versionado con trigger). Sin cambios — el
   archivo 12 la altera encima.
5. `docs/sqls/2026-07-31-demoras-ritmo-muestras.sql` — función
   `demoras_ritmo_muestras`, firma vieja de **6** parámetros. Necesaria
   igual, aunque el archivo 13 le agregue un séptimo parámetro (el piso del
   ritmo) y dropee esta firma: `demoras_servidores` (archivo 9) es
   `LANGUAGE sql`, y Postgres valida su cuerpo contra el catálogo **en el
   `CREATE`** (a diferencia de `plpgsql`) — aplicar el archivo 13 antes que
   el 9 rompería el `CREATE FUNCTION` de `demoras_servidores` en el momento,
   no en runtime.
6. `docs/sqls/2026-07-31-demoras-ritmo-v2.sql` — función `demoras_ritmo`
   (cascada por zona), firma de 2 parámetros. El archivo 14 le reemplaza el
   cuerpo (`CREATE OR REPLACE`, misma firma); se incluye igual porque es la
   referencia histórica del algoritmo. A diferencia de `demoras_ritmo_movil`,
   este archivo **nunca le puso `REVOKE`/`GRANT` explícito** — gap
   preexistente que el archivo 14 (ver más abajo) cierra en su propio
   `CREATE OR REPLACE`, la última vez que se toca el cuerpo de la función.
7. `docs/sqls/2026-07-31-demoras-cola.sql` — función `demoras_cola`,
   significado **viejo** de `cola_efectiva` (los asignados no cuentan). La
   reemplaza por completo el archivo 15 (self-sufficient, con su propio
   `REVOKE`/`GRANT`).
8. `docs/sqls/2026-07-31-demoras-ritmo-movil.sql` — función
   `demoras_ritmo_movil`, firma de 2 parámetros, **con** su
   `REVOKE`/`GRANT`. Necesaria: el archivo 14 la reemplaza con
   `CREATE OR REPLACE` de la misma firma y **no** vuelve a otorgar/revocar
   sobre ella (se apoya en que `CREATE OR REPLACE` preserva los privilegios
   ya puestos) — sin este archivo aplicado antes, `demoras_ritmo_movil`
   queda con los privilegios por defecto de Postgres (`EXECUTE` a `PUBLIC`),
   invocable con la anon key.
9. `docs/sqls/2026-07-31-demoras-servidores.sql` — función
   `demoras_servidores`: a qué hora queda libre cada móvil (modelo
   `PROXIMO_HUECO`). **Sin consumidor desde el archivo 18** — el archivo 19
   la marca obsoleta, no se dropea. **Idempotencia (fix de esta tanda):**
   su `CREATE OR REPLACE FUNCTION` ahora queda condicionado a que
   `demoras_modelo.transito_modo` todavía exista. Esa función es
   `LANGUAGE sql` y lee `dm.transito_modo`, columna que el archivo 12 da de
   baja — sin la guarda, **repegar el archivo único una segunda vez
   fallaba** con `column "transito_modo" of relation "demoras_modelo" does
   not exist`, justo en el `CREATE`, abortando todo el script. Con la
   guarda, la primera pasada crea la función normalmente (las columnas
   todavía existen); en la segunda, el bloque es un no-op silencioso — la
   función queda tal cual la dejó la última vez que sí se pudo crear, que
   es lo correcto para una función obsoleta cuyo cuerpo no necesita seguir
   cambiando. Verificado con el harness (ver §12).
10. `docs/sqls/2026-07-31-demoras-proximo-hueco.sql` — función
    `demoras_proximo_hueco`: la simulación del modelo `PROXIMO_HUECO`. Sin
    consumidor desde el archivo 18. **Además de obsoleta, queda
    semánticamente rota** por el archivo 15: lee `demoras_cola.cola_efectiva`
    asumiendo que los asignados no cuentan, y desde el archivo 15 sí cuentan
    — invocarla a mano hoy doble-cuenta esos pedidos. No usar para nada
    nuevo (ver archivo 19 y §3.2).
11. `docs/sqls/2026-07-31-demoras-calcular-run-v2.sql` — orquestador
    `demoras_calcular_run`, versión `PROXIMO_HUECO` con el escenario 1000
    clavado. **Necesaria por sus efectos de esquema**, aunque el archivo 18
    le reemplace el cuerpo enseguida: este archivo crea
    `demoras_config_backup_20260731` y hace el `DROP COLUMN` de las 8
    columnas de cálculo viejas de `demoras_config`, y agrega a
    `demoras_calculadas` las columnas `cola_por_delante` /
    `moviles_considerados` (entre otras) que el archivo 18 **ya no vuelve a
    agregar** — las asume puestas. Saltear este archivo deja esas dos
    columnas faltantes y el `INSERT` del archivo 18 fallando en runtime con
    `column does not exist`. `demoras_config_backup_20260731` gana su
    `REVOKE`/`GRANT` (I2, review final de rama): era la única tabla de la
    familia `demoras_*` que nacía sin él (`anon` podía `SELECT` y `UPDATE`).

**Tanda `CONSUMO_TRAMOS` (2026-08-01), archivos 12 a 19 — el trabajo de
esta tanda:**

12. `docs/sqls/2026-08-01-demoras-modelo-tramos.sql` (**Task 1**) — los
    cuatro parámetros nuevos en `demoras_modelo`
    (`dedicacion_transito`, `transito_dedicacion_max_total`,
    `traslado_fuera_zona_minutos`, `ritmo_hueco_min_minutos`), el `CHECK`
    de `modelo` pasa a `CONSUMO_TRAMOS` / `CAPACIDAD_PROMEDIO` (normaliza
    las filas existentes de `PROXIMO_HUECO` a `CONSUMO_TRAMOS` antes de
    aplicar el `CHECK` nuevo), y se dan de baja `transito_modo`,
    `transito_castigo_minutos`, `transito_margen_minutos` — ver §3.2.
13. `docs/sqls/2026-08-01-demoras-ritmo-muestras-v2.sql` (**Task 2, paso
    1**) — `demoras_ritmo_muestras` gana el piso del ritmo (`p_hueco_min`,
    séptimo parámetro) y dropea la firma vieja de 6.
14. `docs/sqls/2026-08-01-demoras-ritmo-callers-v2.sql` (**Task 2, fix round
    1**) — `demoras_ritmo` y `demoras_ritmo_movil` recreadas para pasar el
    piso del ritmo a `demoras_ritmo_muestras`. Necesita el archivo 12 (lee
    `demoras_modelo.ritmo_hueco_min_minutos`) y el archivo 13 (llama a la
    firma de 7 parámetros) ya aplicados — las dos son `LANGUAGE sql`, se
    validan al crearse. También le agrega a `demoras_ritmo` su
    `REVOKE`/`GRANT` (review final de rama), que ningún archivo anterior le
    había puesto — ver el punto 6 de arriba.
15. `docs/sqls/2026-08-01-demoras-cola-v2.sql` (**Task 3**) — `demoras_cola`
    pasa a incluir los asignados a un móvil activo **dentro de la misma
    zona** en `cola_efectiva` (antes ese trabajo solo entraba por el tiempo
    de liberación del móvil), y `URGENTE`+`NOCTURNO` unen su demanda — ver
    §5 de `DEMORA_MODELO_TRAMOS.md`.
16. `docs/sqls/2026-08-01-demoras-aportes.sql` (**Task 4**) — función
    `demoras_aportes` (`p_j`, `r_j`, `mu_j` por móvil activo), reemplaza a
    `demoras_servidores`. Necesita el archivo 12 (lee `dedicacion_transito`
    / `transito_dedicacion_max_total` / `traslado_fuera_zona_minutos` de
    `demoras_modelo` — `LANGUAGE sql`, se valida al crearse).
17. `docs/sqls/2026-08-01-demoras-consumo-tramos.sql` (**Task 5**) — función
    `demoras_consumo_tramos`, la simulación por tramos. Reemplaza a
    `demoras_proximo_hueco`. Necesita `demoras_aportes` (16) y `demoras_cola`
    (15) para funcionar en runtime (`LANGUAGE plpgsql`, no se valida al
    crearse, sí al ejecutarse).
18. `docs/sqls/2026-08-01-demoras-calcular-run-v3.sql` (**Task 6**) — el
    orquestador recorre **todos** los escenarios con fila en
    `demoras_modelo` y despacha entre `CONSUMO_TRAMOS` y
    `CAPACIDAD_PROMEDIO`. Última migración **funcional** a propósito: da de
    baja `ritmo_aplicado` / `libre_primero` de `demoras_calculadas` (sin
    equivalente en `CONSUMO_TRAMOS`) y agrega `capacidad_inicial` /
    `capacidad_final` / `tramos` — ver §3.3. Gana su `REVOKE`/`GRANT` (I3,
    review final de rama): no lo tenía desde la v2.
19. `docs/sqls/2026-08-01-demoras-legacy-obsoletas.sql` (**Task 7,
    triage**) — `demoras_servidores` y `demoras_proximo_hueco` se marcan
    **obsoletas** vía `COMMENT ON FUNCTION`: sin consumidor desde el
    archivo 18, y `demoras_proximo_hueco` además semánticamente rota por el
    archivo 15. No se dropean — ver §3.2.

**Último archivo, movido al final del listado (no depende de nada de
arriba):**

20. `docs/sqls/2026-07-29-demoras-cron.sql` — programa los dos jobs de
    `pg_cron` (`demoras-calcular` cada 10 min, `demoras-purga` diario) y
    **requiere `pg_cron` habilitado** en el proyecto de Supabase (Database →
    Extensions → `pg_cron`). Sin cambios desde la tanda anterior: la firma
    de `demoras_calcular_run` no cambió (`p_corrida_at timestamptz DEFAULT
    now()`, así que `SELECT demoras_calcular_run();` sigue andando). No
    depende de `motor_activo` ni de qué versión de `demoras_calcular_run`
    esté vigente en el momento de programarse — `cron.schedule` solo guarda
    el **texto** del comando, se resuelve por nombre en cada disparo real,
    así que da lo mismo aplicarlo antes o después de los archivos 12-19.

> **Paso final — después del archivo 20 y de la verificación del §2:**
>
> ```sql
> UPDATE demoras_config SET motor_activo = true;
> ```
>
> **Sin `WHERE escenario_id`, simétrico con el Paso 0.** Prende todos los
> escenarios que estaban prendidos antes de empezar. Para reactivar solo
> uno, agregar `WHERE escenario_id = 1000` (ver §4). Con el motor apagado
> por el Paso 0, una corrida manual del §2 (`SELECT
> demoras_calcular_run(now())`) devuelve `0` — es lo esperado, no un error:
> sigue ejecutando la función entera (así que un error de SQL real contra
> el esquema de producción todavía se detecta), pero no escribe filas.
> Confirmado que corre sin errores, este `UPDATE` reactiva el motor y la
> corrida del cron siguiente (máximo 10 minutos después) ya escribe con el
> esquema `CONSUMO_TRAMOS` completo.

Todas son idempotentes en el sentido estricto: volver a pegarlas no da error
ni duplica nada, así que si hay dudas sobre si alguna se aplicó, se puede
repetir la secuencia completa — **verificado pegando el archivo único
entero dos veces seguidas** (ver §12). El fix de idempotencia del archivo 9
(arriba) es justamente lo que hace cierta esa frase para todo el bundle: sin
él, la segunda pasada abortaba entera.

**Excepciones que sí importan si se pegan archivos sueltos, fuera de
orden.** El archivo único ya las evita por construcción (siempre en el
orden de arriba); estas son para quien re-pegue un archivo individual
pensando "no rompe nada":

- **`2026-07-29-demoras-ritmo.sql` y `2026-07-30-demoras-ritmo-cascada.sql`**
  (previos incluso a la tanda `PROXIMO_HUECO`) quedan superseded por el
  archivo 6 y **ninguno de los dos entra en ninguna secuencia**. Re-pegar
  cualquiera de los dos después del archivo 6 declara `demoras_ritmo` con 4
  parámetros (2 con `DEFAULT`), y como la versión vigente tiene 2, quedan
  **dos funciones `demoras_ritmo` distintas coexistiendo**: cualquier
  llamada con 2 argumentos (como la de `demoras_ritmo_movil`,
  `demoras_servidores` o el propio orquestador) matchea a las dos por igual
  y Postgres aborta con `function demoras_ritmo(integer, date) is not
  unique`. Falla ruidosamente, no en silencio. Recuperación: repetir la
  secuencia completa, o pegar el archivo 6 solo (autosuficiente).
- **`2026-07-31-demoras-ritmo-muestras.sql` (archivo 5, 6 parámetros)
  re-pegado DESPUÉS del archivo 13** (que dropea esa firma y crea la de 7)
  **la resucita**: `CREATE OR REPLACE` crea si falta. Con eso vuelven a
  coexistir las dos firmas. A diferencia del caso anterior, esto **no**
  revienta con "is not unique", porque los llamadores de esta tanda
  (`demoras_ritmo`/`demoras_ritmo_movil` vía el archivo 14) siempre pasan 7
  argumentos explícitos — no hay ambigüedad de conteo. El riesgo real es
  otro: la firma de 6 vuelve a existir sin nadie que la use, código muerto
  que confunde a quien audite el catálogo. No es peligroso, pero no hace
  falta: no repetir el archivo 5 solo.
- **`2026-07-31-demoras-ritmo-v2.sql` (archivo 6) o
  `2026-07-31-demoras-ritmo-movil.sql` (archivo 8) re-pegados DESPUÉS del
  archivo 14** (que les da el cuerpo nuevo, con el piso del ritmo)
  **revierten `demoras_ritmo`/`demoras_ritmo_movil` al cuerpo viejo**, que
  llama a `demoras_ritmo_muestras` con **6** argumentos. Si para ese
  momento el archivo 13 ya dropeó esa firma (que es el caso normal, aplicada
  antes en la secuencia), la próxima invocación de `demoras_ritmo` o
  `demoras_ritmo_movil` falla con `function demoras_ritmo_muestras(...)
  does not exist` — ruidoso, no en silencio, pero real: el motor entero
  deja de escribir filas hasta que se vuelva a pegar el archivo 14. Nunca
  pegar el 6 u 8 sueltos después del 14.
- **`docs/sqls/2026-07-29-demoras-calcular-run.sql` (la versión más vieja
  del orquestador, previa incluso al archivo 11) queda fuera de toda
  secuencia.** Al igual que el primer caso, re-pegarlo después del archivo
  11 no degrada en silencio: como ese archivo ya borró columnas de
  `demoras_config` que la versión vieja necesita (`SELECT dc.*` sobre la
  tabla entera), la próxima corrida falla con `column "min_minutos" does
  not exist`.
- **`2026-07-29-demoras-calculadas-tabla.sql` (archivo 3) re-pegado
  DESPUÉS del archivo 11 — esto YA NO FALLA** (I7, review final de rama:
  esta guía decía lo contrario hasta esta corrección, y quedó
  desactualizada desde el fix de idempotencia de la tanda pasada — se
  contradecía con el párrafo de más arriba, que afirma que el bundle entero
  se puede repetir sin problema). Su `ALTER TABLE ... ADD
  COLUMN IF NOT EXISTS ritmo_default_minutos ...` es idempotente y resucita
  esa columna (inofensivo, nadie la lee). Los `COMMENT ON COLUMN
  demoras_config.factor_calibracion` / `.ritmo_default_minutos` de más abajo
  en el mismo archivo apuntaban a columnas que el archivo 11 ya dropeó —
  antes rompían con `ERROR: column "factor_calibracion" of relation
  "demoras_config" does not exist`, porque `COMMENT ON COLUMN` no tiene forma
  `IF EXISTS`. Están envueltos en un `DO ... IF EXISTS (SELECT 1 FROM
  information_schema.columns ...)` que solo ejecuta el `COMMENT` si la
  columna todavía existe (ver el archivo fuente). Re-pegar el archivo 3
  después del 11 hoy es un no-op silencioso sobre esos dos `COMMENT`, no un
  error — verificado aplicando el bundle entero tres veces seguidas (§12).

---

## 2. Verificación post-apply

```sql
-- 1) Una corrida manual, fuera del cron
SELECT demoras_calcular_run(now());

-- 2) Qué escribió esa corrida, en TODOS los escenarios calculados
SELECT escenario, zona_id, tipo_servicio, demora_informada, demora_as400,
       pendientes_asignados + pendientes_sin_asignar AS pendientes,
       capacidad_inicial, capacidad_final, tramos, sin_capacidad
  FROM demoras_calculadas
 WHERE corrida_at = (SELECT max(corrida_at) FROM demoras_calculadas)
 ORDER BY escenario, demora_informada DESC LIMIT 20;

-- 3) Qué escenarios se están calculando (todos los que tengan fila acá)
SELECT escenario_id, modelo, version FROM demoras_modelo ORDER BY escenario_id;

-- 4) Los jobs quedaron programados
SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'demoras-%';
```

`capacidad_inicial` / `capacidad_final` / `tramos` vienen llenas **solo**
con `CONSUMO_TRAMOS` — si salen `NULL` para una fila, esa fila corrió con
`CAPACIDAD_PROMEDIO` (ver §3.3).

Si `demoras_calcular_run(now())` devuelve `0`, no es necesariamente un
error: puede ser que estés fuera de la ventana horaria de los tres tipos en
todos los escenarios, o que ningún escenario tenga `motor_activo = true`.
Revisá `demoras_config` y `demoras_modelo` antes de asumir que algo está
roto (ver §4).

Para confirmar que el cron efectivamente corrió (no solo que quedó
programado):

```sql
SELECT count(*), min(corrida_at), max(corrida_at) FROM demoras_calculadas;
```

---

## 3. `demoras_config` (operativa) y `demoras_modelo` (cálculo)

Los parámetros del motor viven partidos en dos tablas por responsabilidad,
no por casualidad histórica:

- **`demoras_config`** (`docs/sqls/2026-07-29-demoras-calculadas-tabla.sql`),
  por `(escenario_id, tipo_servicio)` — lo **operativo**: el interruptor, la
  ventana horaria y (con una excepción documentada más abajo) el orden de la
  cascada del ritmo.
- **`demoras_modelo`** (`docs/sqls/2026-07-31-demoras-modelo-tabla.sql`,
  ampliada por `2026-08-01-demoras-modelo-tramos.sql`), una fila **por
  escenario** — todo lo del **cálculo**: topes, suavizado, ritmo, el
  reparto de dedicación de un móvil compartido, el factor de calibración y
  **qué modelo corre** (`modelo`).

Las dos son editables en caliente por SQL (la pantalla en Preferencias
Globales es un incremento posterior, una vez que el modelo nuevo haya
corrido unos días — fuera de esta tanda).

**Un tipo sin fila no se calcula.** Es la forma de apagar un tipo entero sin
borrar histórico: basta con `DELETE FROM demoras_config WHERE escenario_id=1000
AND tipo_servicio='NOCTURNO'` y ese tipo deja de escribir filas nuevas (las
viejas quedan intactas para auditoría).

**El motor calcula TODOS los escenarios que tengan fila en
`demoras_modelo`.** Antes de la tanda `CONSUMO_TRAMOS`, `demoras_calcular_run`
tenía el escenario clavado (`v_esc integer := 1000`) y el seed sembraba solo
ese escenario, así que agregar filas de `demoras_config` para otro escenario
**no** hacía que se calculara — había que generalizar la función primero.
Eso es exactamente lo que hizo la Task 6 de la tanda `CONSUMO_TRAMOS`: el
orquestador ahora es `FOR m IN SELECT * FROM demoras_modelo ORDER BY
escenario_id LOOP`. Dar de alta un escenario nuevo es:

1. Una fila en `demoras_modelo` (obligatoria — sin ella, el escenario no
   entra al loop, aunque tenga `demoras_config` completa).
2. Filas en `demoras_config` por cada tipo que corresponda (sin esto, ese
   escenario entra al loop pero no escribe nada — mismo comportamiento que
   hoy tiene un tipo sin fila).

La pantalla de métricas sí tiene selector de escenario: con cualquier otro
que no tenga fila en `demoras_config`, la card de comparativa dice
explícitamente *"El motor de demora no está configurado para este
escenario"* — el endpoint devuelve `escenario_configurado: false`.

**El volumen crece con la cantidad de escenarios, y el cron sigue siendo
serial.** El advisory lock (§9) se toma **una sola vez por corrida**, antes
del loop de escenarios — serializa la corrida entera, no escenario por
escenario. Con un escenario, el tiempo medido de una corrida completa está
entre 265 ms y 4,4 s; con cinco (la escala que anticipa
`DEMORA_MODELO_TRAMOS.md` §8), el trabajo crece proporcionalmente y hay que
volver a medir contra el volumen real antes de dar de alta un segundo
escenario en producción. La tabla de hechos también se multiplica: ~25.000
filas/día con un escenario, ~125.000/día con cinco.

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

### Columnas de `demoras_config` (lo operativo, por tipo)

| Columna | Default | Para qué |
|---|---|---|
| `motor_activo` | `true` | Interruptor del tipo. `false` = no se calcula, sin borrar histórico. |
| `hora_inicio` / `hora_fin` | `07:00` / `23:30` | Ventana operativa **de ese tipo**. Fuera de ventana, ese tipo no escribe fila. Ver §5.1. |
| `ritmo_cascada` | `CHOFER,MOVIL,ZONA,GLOBAL` | Orden de atribución del ritmo, **por tipo**. Ver §3.1 — es la única columna de cálculo que se queda acá; el resto vive en `demoras_modelo`. |
| `updated_at` | `now()` | Bookkeeping, no la actualiza el motor — es para auditar ediciones manuales de la config. |
| `updated_by` | `NULL` | Bookkeeping, texto libre; nadie la setea automáticamente hoy. |

Constraints que quedan en la tabla: `tipo_servicio IN
('URGENTE','NOCTURNO','SERVICE')`, **`hora_fin > hora_inicio`** (ver §5.1).

### Columnas de `demoras_modelo` (el cálculo, por escenario)

Una fila por `escenario_id` — el cálculo es global a propósito mientras se
está buscando la fórmula correcta: no tiene sentido que `URGENTE` mida el
ritmo de una manera y `SERVICE` de otra.

| Columna | Default | Para qué |
|---|---|---|
| `modelo` | `CONSUMO_TRAMOS` | Qué modelo corre: `CONSUMO_TRAMOS` (la simulación por tramos, vigente) o `CAPACIDAD_PROMEDIO` (pendientes/capacidad × ritmo, el original — se conserva para poder comparar). `PROXIMO_HUECO` fue **retirado**: el `CHECK` ya no lo acepta. |
| `min_minutos` / `max_minutos` | `30` / `120` | Piso y techo del clamp. `max_minutos` también es lo que se informa sin capacidad (sin nadie trabajando la zona). |
| `escalon_minutos` | `15` | Redondeo hacia **arriba** al múltiplo, después del suavizado. |
| `incluir_entrega_propia` | `true` | Heredado de `PROXIMO_HUECO`; `CONSUMO_TRAMOS` no lo lee (la simulación por tramos no distingue "hasta que sale" de "hasta que entrega" — ver `DEMORA_MODELO_TRAMOS.md` §3). Se conserva sin dar de baja porque `CAPACIDAD_PROMEDIO` tampoco lo usaba nunca; no rompe nada dejarlo. |
| `subida_max` / `bajada_max` | `30` / `15` | Cuánto puede subir/bajar `demora_suavizada` por corrida. Asimétrico a propósito. |
| `suavizado_bypass_cambio_capacidad` | `false` | Si cambió la cantidad de móviles activos respecto de la corrida anterior, se saltea el suavizado (`p_prev = NULL`). Ver `DEMORA_MODELO.md` §8.4. |
| `ritmo_metrica` | `ENTRE_ENTREGAS` | `ENTRE_ENTREGAS` (minutos entre cumplimientos consecutivos del mismo móvil, lo correcto) o `ASIGNADO_A_ENTREGA` (la métrica vieja, ya incluye la cola — solo para correr el modelo viejo). |
| `estadistico` | `MEDIANA` | Cuál de las cuatro estadísticas del ritmo (`MEDIA`, `MEDIANA`, `P75`, `P90`) alimenta el cálculo. |
| `ritmo_dias_ventana` / `ritmo_min_muestras` | `7` / `5` | Ventana de días y muestras mínimas para que un nivel de la cascada (§3.1) gane. |
| `ritmo_hueco_max_minutos` | `90` | Corte de huecos por arriba: un intervalo más largo que esto es almuerzo/recarga, no ritmo de trabajo. |
| `ritmo_hueco_min_minutos` | `5` | **Nuevo (`CONSUMO_TRAMOS`).** Corte de huecos por abajo: los intervalos **menores** se descartan como marcación en lote (un chofer que marca cinco entregas juntas en el AS400 queda con un ritmo de segundos y arrastra la mediana de toda su zona). Medido en producción el 2026-07-31: 12 de 194 zonas tenían ritmos menores a 5 minutos, una de 8 segundos. **Tiene que ser menor que `ritmo_hueco_max_minutos`** (`CHECK`) — si se cruzan, el filtro no deja pasar ninguna muestra y todas las zonas caen al piso configurado sin que nadie se entere. |
| `ritmo_solo_con_cola` | `false` | Contar solo los intervalos en que el móvil ya tenía el próximo pedido asignado al terminar el anterior. |
| `ritmo_default_minutos` | `30` | Piso cuando no hay ninguna estadística disponible. `ritmo_origen='DEFECTO'`. |
| `dedicacion_transito` | `0.20` | **Nuevo (`CONSUMO_TRAMOS`).** Fracción del tiempo que un móvil le dedica a **cada** zona donde es de tránsito. **La perilla más sensible del modelo**: el ejemplo canónico de la spec usa 0,50 y da 117 minutos; con nuestro default real, 0,20, el mismo ejemplo da ~152 — calibrar con el backtest antes de creerle a ningún número. Va aparte de `escenario_settings.peso_transito_alpha`, que es del modelo `CAPACIDAD_PROMEDIO`. |
| `transito_dedicacion_max_total` | `0.60` | **Nuevo (`CONSUMO_TRAMOS`).** Cuánto pueden sumar entre todas las zonas de tránsito de un mismo móvil; si se pasan, se achican a prorrata. Es lo que le garantiza un piso a la zona de prioridad: con 0,60, la prioridad nunca baja de 0,40 por más zonas de tránsito que se agreguen. |
| `traslado_fuera_zona_minutos` | `15` | **Nuevo (`CONSUMO_TRAMOS`).** Minutos que tarda un móvil en volver a la zona después de terminar lo que tenía afuera. Se suma **una sola vez** al tiempo de liberación (`r_j`), no por pedido — es el viaje de regreso. Con 0 se comporta como si ya estuviera absorbido en el ritmo histórico. |
| `vecinas_modo` | `IGNORAR` | **No implementado todavía**: `TODOS`/`PONDERADO` no cambian nada hoy (ver el `COMMENT ON COLUMN` en la migración). |
| `atrapados_modo` | `EXCLUIR` | Qué hacer con un pedido asignado a un móvil que hoy no salió: `EXCLUIR` (no compite), `COMO_SIN_ASIGNAR`/`EN_COLA` (sí compite). No confundir con los asignados a un móvil que **sí** salió — esos siempre cuentan como demanda de la zona desde `CONSUMO_TRAMOS` (ver §5 de `DEMORA_MODELO_TRAMOS.md`), sin `atrapados_modo` de por medio. |
| `factor_calibracion` | `1.0` | Multiplicador global del resultado crudo. Riesgo R1 — ver §6. |
| `version` | `1` | Bumpea en cada `UPDATE` que cambia algo real (no bookkeeping). `demoras_calculadas.modelo_version` apunta acá o a `demoras_modelo_historial` si ya cambió. |

**Se retiraron `transito_modo`, `transito_castigo_minutos` y
`transito_margen_minutos`.** Eran las cuatro maneras de decidir si un móvil
de tránsito "entraba o no" al modelo `PROXIMO_HUECO`
(`IGUAL`/`CASTIGO`/`ALPHA`/`SOLO_SI_NO_HAY`). En `CONSUMO_TRAMOS` un móvil
compartido **siempre entra**, con la fracción de tiempo que le corresponda
(`dedicacion_transito`) — esa decisión de todo-o-nada desapareció,
reemplazada por un número calibrable.

Un `UPDATE` que cambia cualquiera de estos parámetros queda en
`demoras_modelo_historial` con el estado **anterior** completo (trigger
`trg_demoras_modelo_versionar`); un `UPDATE` que no cambia nada (guardar sin
editar) no versiona.

### 3.1 `ritmo_cascada`: cómo se resuelve

Vive en `demoras_config`, **por tipo**. CSV, se recorre de izquierda a
derecha. **Gana el primer nivel que llegue al mínimo de muestras**
(`demoras_modelo.ritmo_min_muestras`, default `5`). Niveles válidos:
`CHOFER`, `MOVIL`, `ZONA`, `GLOBAL`. Niveles desconocidos en el CSV se
ignoran; una lista vacía o toda inválida cae al default completo.

**`GLOBAL` se evalúa siempre último, aunque no figure en la lista** — es la
red final: es imposible configurar el motor de forma que se quede sin ritmo.
Una lista de solo `GLOBAL` (`ritmo_cascada='GLOBAL'`) es una configuración
válida en sí misma (línea base estable cuando los datos de chofer no son
confiables), no se trata como lista vacía.

Las muestras que alimentan cada nivel pasan **primero** por dos filtros de
`demoras_ritmo_muestras` (`docs/sqls/2026-08-01-demoras-ritmo-muestras-v2.sql`):
`ritmo_hueco_max_minutos` descarta los intervalos largos (almuerzo,
recarga) y **`ritmo_hueco_min_minutos` descarta los intervalos casi nulos**
(marcación en lote) — este segundo filtro es nuevo desde `CONSUMO_TRAMOS`.
Si ni siquiera `GLOBAL` tiene una muestra que pase los dos filtros, no hay
ninguna estadística real que usar: `ritmo_usado` cae al piso configurado
(`ritmo_default_minutos`) y `ritmo_origen` queda `'DEFECTO'`.

### 3.2 Las funciones obsoletas: `demoras_servidores` y `demoras_proximo_hueco`

Eran el corazón del modelo `PROXIMO_HUECO`. Desde que
`2026-08-01-demoras-calcular-run-v3.sql` (archivo 18) dejó de llamarlas
(usa `demoras_aportes` + `demoras_consumo_tramos` en su lugar), quedan
**deployadas pero sin ningún consumidor**. La Task 7 de la tanda
`CONSUMO_TRAMOS` decidió **no dropearlas** (podría haber invocaciones
manuales o externas al repo — un script ad-hoc en producción, una consulta
manual desde el SQL Editor) y en cambio marcarlas obsoletas con `COMMENT ON
FUNCTION` (`docs/sqls/2026-08-01-demoras-legacy-obsoletas.sql`, archivo 19),
así que cualquiera que las inspeccione (`\df+`, `pg_get_functiondef`, el
panel de Supabase) lo ve de entrada.

**`demoras_proximo_hueco` no es solo obsoleta: quedó semánticamente rota.**
Su header dice textualmente que lee `demoras_cola.cola_efectiva` asumiendo
que "los asignados NO cuentan, porque ese trabajo ya está adentro de
`libre_en`" — el significado **viejo**. Desde el archivo 15
(`2026-08-01-demoras-cola-v2.sql`), `cola_efectiva` **sí** incluye los
asignados a un móvil activo dentro de la zona. Invocar
`demoras_proximo_hueco` manualmente hoy doble-cuenta esos pedidos: una vez
vía `cola_efectiva`, otra vía `demoras_servidores.libre_en`. **No usar para
nada nuevo.**

Si algún día hace falta recuperar espacio o simplificar el catálogo,
dropearlas es una decisión de una task de limpieza explícita (con el chequeo
de invocaciones externas que corresponde), no algo para colar como efecto
secundario de otro cambio.

### 3.3 Auditoría de `CONSUMO_TRAMOS` en `demoras_calculadas`

Tres columnas nuevas (archivo 18), para poder reconstruir **por qué** una
zona informó tal número, no solo el resultado final — más dos que ya
existían desde la tanda `PROXIMO_HUECO` y se conservan porque
`demoras_consumo_tramos` también las llena, con el mismo significado:

| Columna | Para qué | Estado |
|---|---|---|
| `capacidad_inicial` | Capacidad (pedidos/minuto) con la que arranca la simulación — solo los móviles que ya están libres en esta zona (`r_j <= 0`). | Nueva |
| `capacidad_final` | Capacidad al momento en que se resolvió la demora, con todos los móviles que ya aportaban en ese instante. | Nueva |
| `tramos` | Cuántos regímenes de capacidad distintos atravesó la simulación para llegar a la respuesta (el inicial más cada liberación de móvil hasta vaciar la cola), incluido el último. | Nueva |
| `cola_por_delante` | Pedidos pendientes de la zona (`cola_efectiva`) sin contar el pedido nuevo. | Ya existía (la llenaba `demoras_proximo_hueco`; ahora la llena `demoras_consumo_tramos`) |
| `moviles_considerados` | Cuántos móviles (de `moviles_zonas`) tiene asignados la zona para este tipo y están **activos hoy** (cuenta sobre `demoras_aportes`, que ya filtra `moviles_dia.activo` — corregido, minor del review final de rama: decía "activos o no hoy" y medía solo los activos). | Ya existía, mismo cambio de origen |

**`ritmo_aplicado` y `libre_primero` se dieron de baja** (eran específicas
de `PROXIMO_HUECO`: el ritmo del móvil que efectivamente entregaba en esa
simulación, y el mejor tiempo de liberación antes de repartir la cola —
`CONSUMO_TRAMOS` no elige un móvil "que entrega", reparte la cola entre
todos los que aportan a la vez, así que no hay un equivalente directo). No
se guardó backup de esas dos: `demoras_calculadas` es, por su propio
`COMMENT ON TABLE`, una tabla de comparativa que no alimenta a nadie, con
retención de 180 días — no es configuración maestra irrecuperable. Las
filas ya escritas por `PROXIMO_HUECO` pierden esos dos valores puntuales;
conservan todo lo demás.

Las cinco columnas quedan **`NULL` en `CAPACIDAD_PROMEDIO`** a propósito:
son insumos que solo produce `CONSUMO_TRAMOS`, y que queden `NULL` hace
evidente a simple vista qué modelo produjo cada fila, sin cruzar contra
`modelo_version`.

### Permisos: solo `service_role`

`demoras_calculadas`, `demoras_config`, `demoras_modelo` y
`demoras_modelo_historial` tienen `REVOKE ALL ... FROM anon, authenticated`
+ `GRANT ALL ... TO service_role`. El motivo es que estas tablas deciden
**qué calcula el motor** (interruptor, ventanas, topes, qué modelo corre,
factor de calibración), y la anon key de Supabase vive en el bundle del
browser.

Lo mismo aplica a las funciones del motor: cada una tiene su propio `REVOKE
EXECUTE ... FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE ... TO
service_role` en su propia migración. Hasta el review final de rama había
cuatro excepciones sin revocar (`demoras_calcular_run`, `demoras_capacidad`,
`demoras_acabado` y `demoras_ritmo`) — la guía solo mencionaba una
(`demoras_ritmo`) y la daba por fuera de alcance. Las cuatro se cerraron en
esa misma tanda de fixes: `demoras_ritmo` en su último `CREATE OR REPLACE`
(`docs/sqls/2026-08-01-demoras-ritmo-callers-v2.sql`, archivo 14), las otras
tres en sus propias migraciones (archivos 1, 2 y 18). Hoy no queda ninguna
función del motor sin su `REVOKE`/`GRANT` explícito — verificado por
`scripts/sql-harness/assert-grants-funciones.sql`.

Verificación post-apply — las cuatro tienen que dar `f`:

```sql
SELECT has_table_privilege('anon','demoras_config','UPDATE');
SELECT has_table_privilege('anon','demoras_config','SELECT');
SELECT has_table_privilege('anon','demoras_calculadas','UPDATE');
SELECT has_table_privilege('authenticated','demoras_config','UPDATE');
```

Si alguna da `t`, la migración de la tabla (archivo 3) no se aplicó
completa: volver a pegarla. Para `demoras_modelo` / `demoras_modelo_historial`,
lo mismo con el archivo 4 (o 12, si el interés es puntualmente en las
columnas nuevas de `CONSUMO_TRAMOS`, aunque el `REVOKE`/`GRANT` de la tabla
entera ya lo cubre el archivo 4).

---

## 4. Cómo apagar el motor en caliente

**Motor entero, todos los escenarios** (el break-glass):

```sql
UPDATE demoras_config SET motor_activo = false;
```

Un escenario puntual:

```sql
UPDATE demoras_config SET motor_activo = false WHERE escenario_id = 1000;
```

Un solo tipo dentro de un escenario (por ejemplo, si NOCTURNO da resultados
ruidosos y hay que pausarlo sin tocar URGENTE/SERVICE):

```sql
UPDATE demoras_config SET motor_activo = false
 WHERE escenario_id = 1000 AND tipo_servicio = 'NOCTURNO';
```

Volver a prender es el mismo `UPDATE` con `true`. El cron sigue disparando
cada 10 minutos igual (no hay que tocar `pg_cron`); la función simplemente no
escribe filas para el/los tipo(s)/escenario(s) apagado(s), y el histórico
queda intacto.

### 4.1 Cómo volver al modelo viejo

Si `CONSUMO_TRAMOS` da resultados que no se entienden o hay que comparar
contra el AS400 con un modelo más simple mientras se investiga:

```sql
UPDATE demoras_modelo SET modelo = 'CAPACIDAD_PROMEDIO';
```

**Todos los escenarios a la vez** (simétrico con el apagado del §4). Para
uno solo: `... WHERE escenario_id = 1000`.

**No requiere deploy, no toca el cron, no revierte ninguna migración.** La
corrida siguiente (máximo 10 minutos después, o antes con una llamada
manual a `SELECT demoras_calcular_run(now())`) ya usa el modelo viejo — el
orquestador despacha entre los dos en cada corrida según lo que diga esta
columna (§3), y las dos ramas escriben las mismas columnas de
`demoras_calculadas` (con las propias de cada modelo en `NULL` para el
otro — ver §3.3). Volver a `CONSUMO_TRAMOS` es el mismo `UPDATE` con el
valor original. El `UPDATE` queda registrado en `demoras_modelo_historial`
(bumpea `version`), así que el cambio de modelo también es auditable.

**Ojo: `CAPACIDAD_PROMEDIO` ya no mide exactamente lo mismo que antes de
`CONSUMO_TRAMOS` (I5, review final de rama).** Su demanda sale de
`demoras_cola.asignados + demoras_cola.sin_asignar`, y desde
`2026-08-01-demoras-cola-v2.sql` esos dos conteos **crudos** —no solo
`cola_efectiva`— también se agrupan por pool: la fila `URGENTE` de
`asignados`/`sin_asignar` incluye los pedidos `NOCTURNO` de la zona, y
viceversa (el `JOIN` contra el pool pasa antes del `GROUP BY`). La
capacidad, en cambio, sigue siendo la de `demoras_capacidad`, que cuenta
solo los móviles habilitados para el tipo que se calcula — no se pooleó.
O sea que volver a `CAPACIDAD_PROMEDIO` hoy compara una demanda pooled
contra una capacidad sin poolear, y el resultado **no** es un replay exacto
de cómo corría antes de esta tanda: quien vuelva atrás y compare contra
corridas de antes de `CONSUMO_TRAMOS` va a ver un salto que no viene del
modelo, viene de este cambio de insumo. Mismo motivo por el que
`pendientes_asignados`/`pendientes_sin_asignar` en `demoras_calculadas`
cambiaron de significado para una fila `URGENTE` o `NOCTURNO` (ya no
cuentan solo ese tipo) — el único marcador de que esto pasó es
`modelo_version`. Ver el header de `docs/sqls/2026-08-01-demoras-cola-v2.sql`
y `scripts/sql-harness/assert-cola.sql` bloque 6.

Esto **no** es lo mismo que revertir el `DROP COLUMN` del archivo 11 — para
eso, ver el backup `demoras_config_backup_20260731` que esa misma migración
crea antes de dropear (§3): sirve para recuperar una calibración vieja por
tipo si hiciera falta, no para volver a correr un modelo viejo (que no
necesita esas columnas por tipo — las lee de `demoras_modelo`, iguales para
los tres tipos).

---

## 5. Cómo cambiar el estadístico o la cascada

Cambiar cuál estadística alimenta el cálculo (por ejemplo, pasar a `P75`
para ser más conservador). Es una fila **por escenario** en `demoras_modelo`,
no por tipo:

```sql
UPDATE demoras_modelo SET estadistico = 'P75' WHERE escenario_id = 1000;
```

Cambiar el orden de la cascada (por ejemplo, saltear CHOFER si el dato de
chofer no es confiable para ese tipo) sigue siendo por tipo, en
`demoras_config` — `ritmo_cascada` es la única columna de cálculo que no se
movió a `demoras_modelo`:

```sql
UPDATE demoras_config SET ritmo_cascada = 'MOVIL,ZONA,GLOBAL'
 WHERE escenario_id = 1000 AND tipo_servicio = 'NOCTURNO';
```

Este `UPDATE` cambia **las dos cascadas a la vez**: la de zona
(`demoras_ritmo`) y la de móvil (`demoras_ritmo_movil`, la que alimenta
`demoras_aportes` — antes alimentaba `demoras_servidores`) leen la misma
columna, por el mismo tipo. `demoras_modelo.ritmo_cascada` **no alimenta
ninguna de las dos**; un `UPDATE` ahí no tiene ningún efecto (ver el
`COMMENT ON COLUMN` de `docs/sqls/2026-07-31-demoras-modelo-tabla.sql`).

Ningún cambio en `demoras_config` ni en `demoras_modelo` requiere deploy ni
reinicio: la próxima corrida del cron (máximo 10 minutos después) ya lo
toma. Un cambio real en `demoras_modelo` además queda en
`demoras_modelo_historial` (ver §3).

### 5.1 Las ventanas horarias NO pueden cruzar la medianoche

Cambiar la ventana de un tipo es el mismo `UPDATE`:

```sql
UPDATE demoras_config SET hora_inicio = '19:00', hora_fin = '23:59'
 WHERE escenario_id = 1000 AND tipo_servicio = 'NOCTURNO';
```

**Pero `hora_fin` tiene que ser posterior a `hora_inicio`.** El motor filtra
con `v_hora BETWEEN dc.hora_inicio AND dc.hora_fin` sobre un `time`: una
ventana envuelta como `20:30`–`06:00` **nunca** es cierta, así que ese tipo
dejaría de escribir filas **para siempre**, sin error, sin log, y con el cron
reportando `succeeded` cada 10 minutos. NOCTURNO es justo el tipo donde a
alguien se le va a ocurrir escribir `20:30`–`06:00`.

Por eso la tabla tiene `CHECK (hora_fin > hora_inicio)`: el `UPDATE` falla en
el momento, con mensaje, en vez de apagar el tipo en silencio.

```
ERROR: new row for relation "demoras_config" violates check constraint
       "demoras_config_ventana_horaria"
```

Si de verdad hace falta una ventana que cruce la medianoche, **no alcanza con
sacar el CHECK**: hay que cambiar el `BETWEEN` de `demoras_calcular_run` por
una condición partida en dos (`v_hora >= hora_inicio OR v_hora <= hora_fin`) y
revisar todo consumidor de esas columnas. Está fuera del alcance de hoy; el
tope real de NOCTURNO es `23:59`.

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
`docs/sqls/2026-08-01-demoras-ritmo-callers-v2.sql`.

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

(En el código el campo se llama `demoras_modelo.factor_calibracion` — vive
ahí desde la primera tanda; la spec lo nombra `demora_factor_calibracion` en
prosa. Es la misma columna. `CONSUMO_TRAMOS` mide el ritmo con
`ENTRE_ENTREGAS` por default, que es justamente la métrica que R1 recomienda
para no doble-contar — `ASIGNADO_A_ENTREGA` sigue existiendo solo para poder
correr el modelo viejo con su métrica original y comparar.)

**El número calculado no debe informarse a un cliente por ningún canal hasta
que la brecha contra el AS400 esté calibrada.** Hoy el motor es solo
comparativa (§ arriba). Bajar el factor de calibración sin haber mirado la
serie de brecha en el dashboard es exactamente el escenario que R1 advierte.

### 6.1 Las corridas sin capacidad no entran en la calibración

Una fila con `sin_capacidad = true` informa el **techo** (`max_minutos`, hoy
120) por definición: no había un solo móvil activo en la zona. Ese 120 no
salió del modelo, así que promediarlo contra el AS400 no mide nada — y a las
07:00, con el 72% de la flota todavía inactiva, esas filas son la mayoría del
tramo.

**`sin_capacidad` es la misma expresión en los dos modelos** desde el
archivo 18 (`moviles_activos <= 0`, de `demoras_capacidad` — describe el
estado del mundo, no un atajo interno de ningún modelo en particular): antes
de ese fix, un caso de tránsito puro con `peso_transito_alpha = 0` podía
marcar `sin_capacidad` distinto según qué modelo corriera, y el endpoint de
comparativa (que excluye estas filas del promedio) terminaba comparando los
dos modelos sobre poblaciones distintas.

Por eso el endpoint de comparativa **las excluye del promedio y de la brecha**
(las dos puntas: también saca el `demora_as400` de esas mismas corridas, para
que los dos promedios salgan de la misma población). La card las conserva en el
gráfico, marcadas con un punto amarillo, y muestra cuántas se excluyeron —
tanto en total como por zona (columna `s/cap.`).

Una zona cuya columna dice `70 / 99` tiene un promedio apoyado en 29 corridas:
sirve para mirar, no para calibrar. Si TODAS las corridas de una zona fueron
sin capacidad, su promedio queda en `—` (null), no en 120.

Para reproducir el mismo recorte por SQL:

```sql
SELECT zona_id,
       count(*) FILTER (WHERE NOT sin_capacidad)             AS muestras,
       count(*) FILTER (WHERE sin_capacidad)                 AS excluidas,
       round(avg(demora_informada) FILTER (WHERE NOT sin_capacidad), 2) AS prom_calculada,
       round(avg(demora_as400)     FILTER (WHERE NOT sin_capacidad), 2) AS prom_as400
  FROM demoras_calculadas
 WHERE escenario = 1000 AND tipo_servicio = 'URGENTE'
   AND corrida_at >= date_trunc('day', now() AT TIME ZONE 'America/Montevideo')
 GROUP BY zona_id
 ORDER BY excluidas DESC;
```

---

## 7. Retención

180 días de detalle en `demoras_calculadas`, purgados por el job diario
`demoras-purga` (`cron.job`, 04:43 UTC). Con un escenario, a ~254 filas por
corrida × ~99 corridas/día (cada 10 min entre las ventanas de los tres
tipos) da **~25.000 filas/día, ~4,5M filas en régimen**. Con N escenarios el
volumen crece proporcionalmente (~125.000 filas/día con cinco) — ver §3.

Se eligieron 180 días y no 30 para poder comparar contra el AS400 sobre media
temporada, no sobre un mes suelto. Si el volumen se vuelve un problema,
achicar la retención es un solo `UPDATE` a la expresión del job de purga (no
requiere migración).

---

## 8. Por qué el cron corre cada 10 minutos las 24 horas

`docs/sqls/2026-07-29-demoras-cron.sql` programa `demoras-calcular` con
`*/10 * * * *` **sin acotar horario**, a propósito. La ventana operativa
(07:00–23:30 Montevideo para URGENTE/SERVICE, 18:00–23:30 para NOCTURNO) se
evalúa **adentro** de `demoras_calcular_run`, por escenario, no en la
expresión cron.

Motivo: `pg_cron` corre en **UTC**, y la ventana de Montevideo (UTC-3) cruza
la medianoche UTC — 07:00–23:30 Montevideo es 10:00–02:30 UTC del día
siguiente. Expresar eso en cron obligaría a partirlo en dos expresiones (una
antes y otra después de medianoche UTC) que se pueden desincronizar sin que
nadie lo note si algún día cambia la ventana. Con la lógica adentro de la
función, cambiar el horario de un tipo es el `UPDATE` de `demoras_config` del
§5 — no toca el cron.

Cuando la corrida cae fuera de ventana para los tres tipos de todos los
escenarios (o todos están `motor_activo=false`), `demoras_calcular_run` no
escribe nada y devuelve `0` — no es un error, es el comportamiento esperado.

---

## 9. El advisory lock

`demoras_calcular_run` toma `pg_try_advisory_xact_lock(2180637405)` como
primera línea, **una sola vez por corrida, antes del loop de escenarios**
(no una vez por escenario). Serializa la corrida entera: si dos corridas se
solaparan y el lock estuviera adentro del loop, podrían intercalarse por
escenario (una toma el 1000, la otra el 2000, "en paralelo" sobre corridas
distintas) y escribir un estado mezclado — exactamente lo que el lock existe
para evitar.

Si ya hay una corrida en curso (por ejemplo, una corrida manual larga
solapándose con el disparo del cron), la segunda no espera: hace `RAISE
NOTICE` y devuelve `0` inmediatamente, **sin procesar ningún escenario**. El
lock es de **transacción** (`_xact_`), así que se libera solo al terminar —
por commit, por rollback ante excepción, o por cancelación
(`statement_timeout`, `pg_cancel_backend`) —, sin riesgo de quedar pegado
para la sesión.

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

Aplicar el archivo único (§1) deja el motor calculando y escribiendo en
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

Cualquier cambio a estas funciones se valida antes de aplicar en producción
con:

```bash
bash scripts/sql-harness/run.sh <migracion1.sql> [<migracion2.sql> ...] --assert <assert.sql>
```

El script (`scripts/sql-harness/run.sh`) levanta un Postgres 15 descartable
en Docker, aplica `scripts/sql-harness/00-stubs.sql` (tablas mínimas que
imitan el esquema real), aplica las migraciones pasadas **con
`--single-transaction`** (si algo falla, rollback completo, igual que el SQL
Editor de Supabase), y corre los archivos de asserts. Si **alguno de los
asserts pasados** menciona `advisory_xact_lock`, además lanza dos conexiones
concurrentes para probar que el lock efectivamente serializa.

**El harness no tiene la extensión `pg_cron`** (el Postgres de Docker es
vanilla). El archivo único trae un `DO` block que la chequea (Paso 0a) y un
archivo (20, `demoras-cron.sql`) que usa `cron.schedule`/`cron.job` — ninguno
de los dos corre contra el harness tal cual. Para validar el archivo único
completo (como exige la Task 7 de cada tanda), se arma una **variante de
prueba** que saca esos dos bloques (una copia en el scratchpad, no
commiteada — el archivo real en `docs/sqls/` nunca se toca) y se valida esa
copia con `psql -v ON_ERROR_STOP=1 --single-transaction`, aplicada **como un
solo script**, dos veces seguidas.

Asserts existentes: `assert-acabado.sql`, `assert-capacidad.sql`,
`assert-config.sql`, `assert-modelo.sql`, `assert-modelo-tramos.sql`,
`assert-ritmo-muestras.sql`, `assert-ritmo.sql`, `assert-cola.sql`,
`assert-aportes.sql`, `assert-tramos.sql`, `assert-run.sql`,
`assert-run-v3.sql`, `assert-grants-funciones.sql`.

**Retirados** (probaban funciones que ya no tienen consumidor, o
comportamiento superseded por completo — mismo criterio en los tres casos:
si el reemplazo ya lo cubre todo y el original no protege nada que corra en
producción, se borra, no se deja pudrirse):

- `assert-servidores.sql` y `assert-hueco.sql` (probaban `demoras_servidores`
  / `demoras_proximo_hueco` directamente): rotas desde que
  `2026-08-01-demoras-modelo-tramos.sql` dio de baja `transito_modo`, y sin
  consumidor real desde que el orquestador dejó de llamarlas — retiradas en
  la Task 6 de la tanda `CONSUMO_TRAMOS`.
- `assert-run-v2.sql` (probaba el despacho de modelos, el sello de versión,
  el bypass del suavizado y `sin_capacidad` de la v2 del orquestador):
  fallaba ya en su primer bloque (`UPDATE demoras_modelo SET transito_modo =
  ...`, columna dada de baja) y, aunque se corrigiera eso, seguía
  seleccionando `ritmo_aplicado`/`libre_primero` de `demoras_calculadas`,
  columnas que el archivo 18 también dio de baja. Cada uno de sus bloques
  está retesteado en `assert-run-v3.sql` con la terminología de
  `CONSUMO_TRAMOS` (columnas de auditoría nuevas en vez de las viejas) —
  retirada en la Task 7.

**`assert-run.sql` sigue vigente.** Sus 15 comportamientos (el interruptor
global y por tipo, la ventana horaria por tipo, la idempotencia del `ON
CONFLICT`, el snapshot del AS400, la exclusión de ESPECIAL/OTROS, la
precedencia capacidad > demanda) son propiedades del orquestador en general,
no de un modelo en particular — verificado corriendo el archivo tal cual
contra la cadena completa de `CONSUMO_TRAMOS`: pasa los 15 sin tocar una
línea, porque sus fixtures caen en los extremos donde los modelos convergen
(saturado, o demanda cero). Complementa a `assert-run-v3.sql`, que solo
prueba lo que agregó cada tanda sobre el orquestador — mismo patrón que ya
tenía con la tanda `PROXIMO_HUECO`.

**`assert-modelo.sql` se corrigió (Task 7).** Sus tres primeros bloques
asumían que `demoras_modelo` llegaba "virgen" (`version=1`,
`modelo='PROXIMO_HUECO'`): en la cadena completa de `CONSUMO_TRAMOS`,
`2026-08-01-demoras-modelo-tramos.sql` ya hizo un `UPDATE` real sobre esa
fila antes de que este assert corriera (normaliza `PROXIMO_HUECO` →
`CONSUMO_TRAMOS`), así que `version` llegaba en `2`, no en `1`, y el bloque
1 fallaba con `version inicial: 2 (esperaba 1)` en cualquier regresión
completa. Reescrito para capturar la versión/el conteo de historial **antes**
de cada `UPDATE` de prueba y verificar los deltas, no valores absolutos —
mismo patrón que ya usaba el bloque 5 de `assert-modelo-tramos.sql`, que por
eso nunca se rompió. Verificado con un mutante (el trigger de versionado sin
el bump): el bloque 2 lo atrapa igual.

**`assert-tramos.sql` ganó un bloque (Task 7, cierre de hueco de
cobertura).** Ninguno de los 8 bloques originales ejercitaba la rama de
salida temprana **dentro** del loop de `demoras_consumo_tramos` (`IF v_mu >
0 AND v_q <= v_proc THEN ... tramos := tramos + 1; ... EXIT;`) con eventos
todavía sin procesar — en los 8 fixtures originales, la cola siempre se
termina de vaciar en el último tramo o el loop ni arranca. Un mutante que
borra solo ese incremento sobrevivía a los 8 bloques, no porque faltara una
aserción sino porque la rama en sí nunca corría. Bloque 9 nuevo: zona con un
móvil libre ya y dos que se liberan más tarde (eventos `[15, 35]`), con
`Q=1` chico como para resolverse dentro del primer tramo — el segundo evento
nunca se toca. Verificado con el mutante real: rompe exactamente el bloque
9 (`tramos: 0, esperaba 1`), los 8 anteriores quedan en verde.

### Por qué existe

**Los cuerpos `plpgsql` no se validan al crearse.** `CREATE OR REPLACE
FUNCTION` con `LANGUAGE plpgsql` compila la sintaxis pero no ejecuta el
cuerpo — un `CASE` mal armado, una columna que no existe, un tipo que no
castea pasan el `CREATE` sin ningún error. El error solo salta la primera
vez que `pg_cron` dispara la función en producción — y si eso pasa, el cron
falla **callado** cada 10 minutos hasta que alguien lo nota.

**Las funciones `LANGUAGE sql`, en cambio, SÍ se validan contra el catálogo
en el `CREATE`** — verificado con Postgres 15 durante la Task 7: una función
`LANGUAGE sql` cuyo cuerpo referencia una columna recién dropeada falla el
`CREATE OR REPLACE` en el momento, no en runtime. Es el motivo del orden
exacto del §1 (el archivo 9, `demoras_servidores`, tiene que ir antes que el
12, que dropea las columnas que lee) y de la guarda de idempotencia que se le
agregó a ese archivo.

El harness existe para mover ambos tipos de descubrimiento —el silencioso de
`plpgsql` y el ruidoso-pero-mal-ordenado de `LANGUAGE sql`— de "en
producción" a "en el laptop, antes del commit".

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
- **¿Puedo aplicar solo un archivo suelto de `CONSUMO_TRAMOS`, sin todo el
  bundle?** Depende de cuál. `2026-08-01-demoras-cola-v2.sql`,
  `2026-08-01-demoras-aportes.sql` y `2026-08-01-demoras-consumo-tramos.sql`
  son autosuficientes (`CREATE OR REPLACE` con cuerpo completo) y no
  dependen de archivos viejos superseded — pero sí dependen, en orden, de
  `2026-08-01-demoras-modelo-tramos.sql` (los tres leen columnas nuevas de
  `demoras_modelo`). `2026-08-01-demoras-ritmo-muestras-v2.sql` y
  `2026-08-01-demoras-ritmo-callers-v2.sql` van siempre juntos y en ese
  orden (ver la excepción del §1). En una instalación que ya tiene la tanda
  `PROXIMO_HUECO` completa (el caso real de producción hoy), pegar solo los
  archivos 12 a 19 en orden — sin repetir el 1 al 11 — también funciona: es
  exactamente lo que hace este archivo único, que los incluye igual por la
  filosofía de "un solo archivo, de cero o encima, siempre idempotente" (ver
  el header de §1).
- **¿Por qué el archivo único de esta tanda es tan largo (20 archivos, no
  7)?** Porque siete son solo las migraciones **nuevas** de `CONSUMO_TRAMOS`
  (Tasks 1 a 7 del plan). El archivo único tiene que dejar el sistema en el
  estado final completo partiendo de cero, y varias piezas de la tanda
  anterior (`demoras_calculadas`, `demoras_config`, `demoras_modelo`, el
  `DROP COLUMN` + backup del archivo 11) son prerrequisitos que ningún
  archivo de esta tanda vuelve a crear — ver la nota al principio del §1.
