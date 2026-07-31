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

Diseño completo: `docs/superpowers/specs/2026-07-28-motor-demora-informada-design.md`
y [`DEMORA_MODELO.md`](DEMORA_MODELO.md) (el modelo nuevo).

> **El modelo nuevo (`PROXIMO_HUECO`) está implementado y es el default.**
> Reemplaza los tres errores estructurales del modelo anterior: el ritmo
> medía asignación→entrega (ya incluye la espera en cola), el prorrateo
> castigaba dos veces los pedidos ya asignados, y un promedio no puede
> expresar "el primer móvil que se libera" — el nuevo modelo simula la cola
> en vez de promediarla (diseño completo en `DEMORA_MODELO.md`). El modelo
> viejo (`CAPACIDAD_PROMEDIO`) se conserva intacto, no como respaldo sino
> para poder correr los dos sobre los mismos datos y medir la diferencia en
> vez de discutirla: `demoras_modelo.modelo` elige cuál corre, y los dos
> escriben las mismas columnas de `demoras_calculadas` — ver §3.

---

## 1. Orden de aplicación en el SQL Editor de Supabase

Todo se aplica pegando el contenido del archivo en el **SQL Editor de
Supabase**, no con un script de migración normal (`psql`, herramienta de
migraciones, CI): el Postgres de producción está firewalleado y no hay
acceso directo desde fuera de Supabase. Es el mismo mecanismo que ya usa el
resto de `docs/sqls/` en este repo.

> **Paso 0 — antes de pegar el archivo 1, sin excepción:**
>
> ```sql
> UPDATE demoras_config SET motor_activo = false WHERE escenario_id = 1000;
> ```
>
> Entre que se pega el archivo 6 (cambia el default de métrica de
> `demoras_ritmo`) y el archivo 11 (termina de migrar el orquestador), el
> motor queda en un estado **híbrido**: mitad esquema viejo, mitad nuevo.
> El cron **no se entera y no se detiene solo** — sigue disparando cada 10
> minutos con lo que haya pegado hasta ese momento —, y esas corridas se
> escriben con `modelo_version = NULL`: después no hay forma de
> distinguirlas de una corrida genuina del modelo viejo. Medido sobre el
> mismo fixture: **33% de caída** en el resultado. Este `UPDATE` apaga el
> motor para toda la ventana de la migración, sin depender de cuán rápido
> se peguen los 11 archivos siguientes, y se revierte en el **Paso final**
> de más abajo — recién después del archivo 11 y de la verificación del
> §2.

Los 12 archivos, **en este orden exacto**:

1. `docs/sqls/2026-07-29-demoras-acabado.sql` — función `demoras_acabado`:
   clamp → suavizado asimétrico → redondeo hacia arriba al escalón. El orden
   interno (crudo → clamp → suavizado → redondeo) es parte del contrato: si se
   redondea antes de suavizar, el suavizado opera sobre escalones y se traba
   en falso. Sin cambios desde la versión original.
2. `docs/sqls/2026-07-29-demoras-capacidad.sql` — función `demoras_capacidad`:
   capacidad efectiva por (zona, tipo), prorrateando la presencia de cada
   móvil activo (peso 1 prioridad / `alpha` tránsito, normalizado por móvil
   dentro de cada tipo). Se sigue usando para el modelo viejo
   (`CAPACIDAD_PROMEDIO`) y para los conteos `moviles_activos` /
   `moviles_prioridad` / `moviles_transito` que se persisten sea cual sea el
   modelo. Sin cambios.
3. `docs/sqls/2026-07-29-demoras-calculadas-tabla.sql` — crea
   `demoras_calculadas` (los hechos) y `demoras_config` (la configuración
   **operativa**), con el seed de los tres tipos del escenario 1000.
4. `docs/sqls/2026-07-31-demoras-modelo-tabla.sql` — crea `demoras_modelo`
   (todos los parámetros del **cálculo**, una fila por escenario) y
   `demoras_modelo_historial` (versionado con trigger), y agrega
   `demoras_calculadas.modelo_version`. Ver §3.
5. `docs/sqls/2026-07-31-demoras-ritmo-muestras.sql` — función
   `demoras_ritmo_muestras`: resuelve qué muestras alimentan el ritmo
   (`ENTRE_ENTREGAS`, minutos entre cumplimientos consecutivos del mismo
   móvil — lo correcto —, o `ASIGNADO_A_ENTREGA`, la métrica vieja que ya
   incluye la cola) y aplica el corte de huecos largos (almuerzo, recarga).
6. `docs/sqls/2026-07-31-demoras-ritmo-v2.sql` — **supersede** a las dos
   versiones anteriores de `demoras_ritmo`: `2026-07-29-demoras-ritmo.sql`
   (cascada `ZONA → GLOBAL`) y `2026-07-30-demoras-ritmo-cascada.sql`
   (cascada de 4 niveles, pero leyendo `metricas_cumplimiento` directo).
   Ninguna de las dos entra en esta secuencia — ver la advertencia más abajo.
   Misma cascada `CHOFER → MOVIL → ZONA → GLOBAL`; cambia que la firma pierde
   `p_dias`/`p_min_muestras` (ahora salen de `demoras_modelo.ritmo_dias_ventana`
   / `ritmo_min_muestras`) y que las muestras vienen de
   `demoras_ritmo_muestras` (archivo 5).
7. `docs/sqls/2026-07-31-demoras-cola.sql` — función `demoras_cola`: extrae
   la demanda pendiente por (zona, tipo) que antes vivía como CTE inline en
   el orquestador, con `atrapados_modo` configurable (qué hacer con un
   pedido asignado a un móvil que hoy no salió).
8. `docs/sqls/2026-07-31-demoras-ritmo-movil.sql` — función
   `demoras_ritmo_movil`: ritmo propio de cada móvil (o del chofer que más
   lo manejó, si no tiene historial propio suficiente). Sin esto, dos
   móviles de la misma zona no se distinguirían entre sí en la simulación.
9. `docs/sqls/2026-07-31-demoras-servidores.sql` — función
   `demoras_servidores`: a qué hora queda libre cada móvil activo
   (`libre_en = carga × ritmo`, la carga contada en TODAS las zonas del
   móvil), con `transito_modo` configurable.
10. `docs/sqls/2026-07-31-demoras-proximo-hueco.sql` — función
    `demoras_proximo_hueco`: la simulación de cola en sí — reparte los
    pendientes entre los móviles activos y ubica el pedido nuevo en el
    primer hueco. Reemplaza al cálculo de promedio para el modelo
    `PROXIMO_HUECO`.
11. `docs/sqls/2026-07-31-demoras-calcular-run-v2.sql` — función
    `demoras_calcular_run` (el orquestador), **última a propósito**: esta
    migración también **da de baja columnas de `demoras_config`**
    (`min_minutos`, `max_minutos`, `escalon_minutos`, `subida_max`,
    `bajada_max`, `estadistico`, `ritmo_default_minutos`,
    `factor_calibracion` — ver §3). Aplicarla antes de que las diez
    anteriores estén puestas deja al motor **viejo** (que lee esas mismas
    columnas) sin nada que leer, fallando callado cada 10 minutos — el mismo
    modo de falla que ya motivó separar esta baja de la primera migración.
    Antes del `DROP COLUMN`, este mismo archivo crea
    `demoras_config_backup_20260731` (snapshot completo de `demoras_config`,
    ver §4.1) y agrega a `demoras_calculadas` las cuatro columnas de
    auditoría del modelo nuevo (`ritmo_aplicado`, `libre_primero`,
    `cola_por_delante`, `moviles_considerados` — ver §3).
12. `docs/sqls/2026-07-29-demoras-cron.sql` — programa los dos jobs de
    `pg_cron` (`demoras-calcular` cada 10 min, `demoras-purga` diario) y
    **requiere `pg_cron` habilitado** en el proyecto de Supabase (Database →
    Extensions → `pg_cron`). Sin cambios: la firma de `demoras_calcular_run`
    no cambió. Si ya estaba aplicado antes de esta tanda, no hace falta
    repetirlo (es idempotente igual).

> **Paso final — después del archivo 11 y de la verificación del §2** (el
> archivo 12, el cron, se puede pegar antes o después: no depende de
> `motor_activo`):
>
> ```sql
> UPDATE demoras_config SET motor_activo = true WHERE escenario_id = 1000;
> ```
>
> Con el motor apagado por el Paso 0, una corrida manual del §2
> (`SELECT demoras_calcular_run(now())`) devuelve `0` — es lo esperado, no
> un error: sigue ejecutando la función entera (así que un error de SQL
> real contra el esquema de producción todavía se detecta), pero no
> escribe filas. Confirmado que corre sin errores, este `UPDATE` reactiva
> el motor y la corrida del cron siguiente (máximo 10 minutos después) ya
> escribe con el esquema nuevo completo.

Todos son idempotentes en el sentido estricto: volver a pegarlos no da error
ni duplica nada, así que si hay dudas sobre si uno se aplicó, se puede repetir.

**Con dos excepciones que sí importan.**

La primera ya existía y ahora tiene un candidato más: **`2026-07-29-demoras-ritmo.sql`
y `2026-07-30-demoras-ritmo-cascada.sql` quedan los dos superseded por el
archivo 6** (`2026-07-31-demoras-ritmo-v2.sql`) y **ninguno de los dos entra
en esta secuencia**. Re-pegar cualquiera de los dos **después** del archivo 6
—pensando que "no rompe nada"— rompe, pero **ruidosamente, no en silencio**:
los dos archivos viejos declaran `demoras_ritmo` con **4 parámetros**, los
dos últimos (`p_dias`, `p_min_muestras`) con `DEFAULT`. Al lado de la
versión nueva de **2 parámetros** quedan **dos funciones `demoras_ritmo`
distintas coexistiendo**, y cualquier llamada con 2 argumentos —que es como
la invocan `demoras_servidores`, `demoras_proximo_hueco` y el propio
`demoras_calcular_run`— matchea a las dos por igual. Postgres aborta esa
llamada con:

```
ERROR: function demoras_ritmo(integer, date) is not unique (SQLSTATE 42725)
```

El motor entero deja de escribir filas ahí mismo, y el cron lo va a marcar
`failed` cada 10 minutos (§10) — es una falla que se nota de inmediato, no
una que se arrastra en silencio semanas. La receta de recuperación es la
misma de todas formas: repetir la secuencia completa **en orden** empezando
en el archivo 1, o saltear directamente al archivo 6 (autosuficiente — ver
§13), que **sí** resuelve la ambigüedad porque hace `DROP FUNCTION` de la
firma vieja de 4 parámetros antes de crear la de 2. Nunca sueltos.

La segunda es nueva de esta tanda: **`docs/sqls/2026-07-29-demoras-calcular-run.sql`
(la versión vieja del orquestador) queda fuera de esta secuencia.** Al igual
que el caso de arriba, re-pegarlo después del archivo 11 no degrada
en silencio: como el archivo 11 ya borró columnas de `demoras_config` que esa
versión vieja necesita (hace `SELECT dc.*` sobre la tabla entera), la
próxima corrida falla con `column "min_minutos" does not exist` y el motor
deja de escribir filas hasta que alguien vuelva a pegar el archivo 11.

La tercera también es nueva de esta tanda: **`docs/sqls/2026-07-29-demoras-calculadas-tabla.sql`
(archivo 3) re-pegado después del archivo 11 falla.** Su `ALTER TABLE ...
ADD COLUMN IF NOT EXISTS ritmo_default_minutos ...` sí es idempotente y
resucita esa única columna en `demoras_config` (inofensivo: nadie la lee, el
motor usa la de `demoras_modelo`), pero los `COMMENT ON COLUMN
demoras_config.factor_calibracion` y `demoras_config.ritmo_default_minutos`
de más abajo en el mismo archivo apuntan a columnas que el archivo 11 ya
dropeó — `factor_calibracion` no tiene guard `ADD COLUMN IF NOT EXISTS`, así
que para cuando el `COMMENT` la busca, ya no existe:

```
ERROR: column "factor_calibracion" of relation "demoras_config" does not exist
```

Falla **ruidosamente y con rollback completo** (el `--single-transaction` del
harness y el comportamiento por defecto del SQL Editor de Supabase lo
garantizan), así que no deja el esquema a mitad de camino. Si esto pasa, no
hace falta ninguna acción de reparación: el archivo no llegó a cambiar nada,
`demoras_config` queda exactamente como estaba. Simplemente no volver a
pegar el archivo 3 una vez aplicado el archivo 11.

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

## 3. `demoras_config` (operativa) y `demoras_modelo` (cálculo)

Desde la Task 7 (`2026-07-31-demoras-calcular-run-v2.sql`), los parámetros
del motor viven partidos en dos tablas por responsabilidad, no por
casualidad histórica:

- **`demoras_config`** (`docs/sqls/2026-07-29-demoras-calculadas-tabla.sql`),
  por `(escenario_id, tipo_servicio)` — lo **operativo**: el interruptor, la
  ventana horaria y (con una excepción documentada más abajo) el orden de la
  cascada del ritmo.
- **`demoras_modelo`** (`docs/sqls/2026-07-31-demoras-modelo-tabla.sql`), una
  fila **por escenario** — todo lo del **cálculo**: topes, suavizado, ritmo,
  el modo de tránsito/vecinas/atrapados, el factor de calibración y **qué
  modelo corre** (`modelo`).

Las dos son editables en caliente por SQL (la pantalla en Preferencias
Globales es un incremento posterior, una vez que el motor nuevo haya corrido
unos días — Plan 2, fuera de esta tanda).

**Un tipo sin fila no se calcula.** Es la forma de apagar un tipo entero sin
borrar histórico: basta con `DELETE FROM demoras_config WHERE escenario_id=1000
AND tipo_servicio='NOCTURNO'` y ese tipo deja de escribir filas nuevas (las
viejas quedan intactas para auditoría).

**El motor solo calcula el escenario 1000.** `demoras_calcular_run` lo tiene
hardcodeado (`v_esc integer := 1000`) y el seed siembra solo ese escenario, así
que agregar filas de `demoras_config` para otro escenario **no** hace que se
calcule: haría falta generalizar la función, que está fuera de alcance (spec
§9). La pantalla de métricas sí tiene selector de escenario: con cualquier otro,
la card de comparativa dice explícitamente *"El motor de demora no está
configurado para este escenario"* — el endpoint devuelve `escenario_configurado:
false` cuando el escenario no tiene ninguna fila acá. Antes decía "todavía no
hay corridas del motor para hoy", que invitaba a esperar algo que no iba a pasar
nunca.

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

`min_minutos`, `max_minutos`, `escalon_minutos`, `subida_max`, `bajada_max`,
`estadistico`, `ritmo_default_minutos` y `factor_calibracion` se dieron de
baja en `2026-07-31-demoras-calcular-run-v2.sql` (archivo 11 de §1): ya no
están en `demoras_config`, viven en `demoras_modelo` (una fila por
escenario, no por tipo — ver la tabla de abajo). Dejarlas duplicadas en las
dos tablas hubiera garantizado que algún día `demoras_config.estadistico` y
`demoras_modelo.estadistico` valieran distinto sin que nadie supiera cuál
manda.

**`ritmo_cascada` es la excepción, y es deliberada — no un olvido.**
`demoras_ritmo` (`docs/sqls/2026-07-31-demoras-ritmo-v2.sql`) sigue
leyéndola de `demoras_config`, **por tipo** (`URGENTE` puede tener una
cascada distinta de `SERVICE`); `demoras_modelo` tiene su propia columna
`ritmo_cascada`, pero es una fila por *escenario* y hoy **no se lee en
ningún lado** — es la que en teoría reemplazaría a ésta si algún día se
decide que la cascada debe ser global en vez de por tipo, un cambio de
diseño de `demoras_ritmo` que quedó fuera del alcance de la Task 7 (que es
solo el orquestador). Migrarla junto con las otras ocho rompe
`demoras_ritmo` en producción con `column "ritmo_cascada" does not exist`
la primera vez que corre — verificado con el harness — porque
`demoras_servidores`, `demoras_proximo_hueco` y el propio orquestador
llaman a `demoras_ritmo`.

Constraints que quedan en la tabla: `tipo_servicio IN
('URGENTE','NOCTURNO','SERVICE')`, **`hora_fin > hora_inicio`** (ver §5.1).
`demoras_config_rango` (`max_minutos >= min_minutos`) se dio de baja junto
con esas dos columnas.

### Columnas de `demoras_modelo` (el cálculo, por escenario)

`docs/sqls/2026-07-31-demoras-modelo-tabla.sql`. Una fila por
`escenario_id` — el cálculo es global a propósito mientras se está buscando
la fórmula correcta: no tiene sentido que `URGENTE` mida el ritmo de una
manera y `SERVICE` de otra.

| Columna | Default | Para qué |
|---|---|---|
| `modelo` | `PROXIMO_HUECO` | Qué modelo corre: `PROXIMO_HUECO` (simulación de cola, nuevo) o `CAPACIDAD_PROMEDIO` (pendientes/capacidad × ritmo, el viejo — se conserva para poder comparar). |
| `min_minutos` / `max_minutos` | `30` / `120` | Piso y techo del clamp. `max_minutos` también es lo que se informa sin capacidad (sin nadie trabajando la zona). |
| `escalon_minutos` | `15` | Redondeo hacia **arriba** al múltiplo, después del suavizado. |
| `incluir_entrega_propia` | `true` | Solo aplica a `PROXIMO_HUECO`: si la demora llega hasta que el móvil sale (`false`) o hasta que entrega (`true`). |
| `subida_max` / `bajada_max` | `30` / `15` | Cuánto puede subir/bajar `demora_suavizada` por corrida. Asimétrico a propósito. |
| `suavizado_bypass_cambio_capacidad` | `false` | Si cambió la cantidad de móviles activos respecto de la corrida anterior, se saltea el suavizado (`p_prev = NULL`): esa baja/subida es estructural (entró o salió un móvil), no ruido, y frenarla es informar de más cuando el refuerzo ya está en la calle. Ver `DEMORA_MODELO.md` §8.4. |
| `ritmo_metrica` | `ENTRE_ENTREGAS` | `ENTRE_ENTREGAS` (minutos entre cumplimientos consecutivos del mismo móvil, lo correcto) o `ASIGNADO_A_ENTREGA` (la métrica vieja, ya incluye la cola — solo para correr el modelo viejo). |
| `estadistico` | `MEDIANA` | Cuál de las cuatro estadísticas del ritmo (`MEDIA`, `MEDIANA`, `P75`, `P90`) alimenta el cálculo. |
| `ritmo_dias_ventana` / `ritmo_min_muestras` | `7` / `5` | Ventana de días y muestras mínimas para que un nivel de la cascada (§3.1) gane. |
| `ritmo_hueco_max_minutos` | `90` | Corte de huecos: un intervalo más largo que esto es almuerzo/recarga, no ritmo de trabajo. |
| `ritmo_solo_con_cola` | `false` | Contar solo los intervalos en que el móvil ya tenía el próximo pedido asignado al terminar el anterior. |
| `ritmo_default_minutos` | `30` | Piso cuando no hay ninguna estadística disponible. `ritmo_origen='DEFECTO'`. |
| `transito_modo` | `SOLO_SI_NO_HAY` | Cómo compite un móvil de tránsito: `IGUAL`, `CASTIGO` (+`transito_castigo_minutos`), `SOLO_SI_NO_HAY` (solo si ninguna prioridad se libera dentro de `transito_margen_minutos`) o `ALPHA` (estira `libre_en` dividiendo por `peso_transito_alpha`). |
| `vecinas_modo` | `IGNORAR` | **No implementado todavía**: `TODOS`/`PONDERADO` no cambian nada hoy (ver el `COMMENT ON COLUMN` en la migración). |
| `atrapados_modo` | `EXCLUIR` | Qué hacer con un pedido asignado a un móvil que hoy no salió: `EXCLUIR` (no compite), `COMO_SIN_ASIGNAR`/`EN_COLA` (sí compite). |
| `factor_calibracion` | `1.0` | Multiplicador global del resultado crudo. Riesgo R1 — ver §6. |
| `version` | `1` | Bumpea en cada `UPDATE` que cambia algo real (no bookkeeping). `demoras_calculadas.modelo_version` apunta acá o a `demoras_modelo_historial` si ya cambió. |

Un `UPDATE` que cambia cualquiera de estos parámetros queda en
`demoras_modelo_historial` con el estado **anterior** completo (trigger
`trg_demoras_modelo_versionar`); un `UPDATE` que no cambia nada (guardar sin
editar) no versiona.

### Auditoría del modelo nuevo en `demoras_calculadas`

Cuatro columnas agregadas en el archivo 11 (review final de rama), para
poder reconstruir **por qué** una zona informó tal número seis semanas
después, no solo el resultado final:

| Columna | Para qué |
|---|---|
| `ritmo_aplicado` | Ritmo (minutos) del móvil que efectivamente entrega el pedido nuevo en la simulación. |
| `libre_primero` | Mejor tiempo de liberación ANTES de repartir la cola — separa cuánto de la demora es cola por delante y cuánto es trabajo que los móviles ya tenían encima. |
| `cola_por_delante` | Pedidos sin asignar que la simulación repartió antes de ubicar al pedido nuevo. |
| `moviles_considerados` | Cantidad de móviles (servidores) que compitieron; `0` implica `sin_capacidad=true`. |

Las cuatro quedan **`NULL` en `CAPACIDAD_PROMEDIO`** a propósito: son
insumos que solo produce la simulación de `PROXIMO_HUECO`, y que queden
`NULL` hace evidente a simple vista qué modelo produjo cada fila, sin
cruzar contra `modelo_version`. Antes de esto, `demoras_calculadas` solo
persistía `ritmo_usado`/`ritmo_origen` del blend de **zona** (el *fallback*
del modelo nuevo, no lo que usa cuando el móvil tiene ritmo propio) — sobre
el ejemplo de `DEMORA_MODELO.md` §7.3, Centro informaba 60 desde el ritmo
15 de M2, pero la fila guardaba 17,50: un número que no participó del
cálculo.

### El backup antes del `DROP COLUMN`

El mismo archivo 11 crea `demoras_config_backup_20260731`
(`CREATE TABLE IF NOT EXISTS ... AS SELECT * FROM demoras_config`) justo
antes de dropear las 8 columnas de cálculo. Es la única forma de recuperar
una calibración de `factor_calibracion` (o cualquier otro parámetro) de
`NOCTURNO` o `SERVICE` hecha en producción antes de esta migración: el seed
de `demoras_modelo` (archivo 4) solo hereda de la fila `URGENTE`, así que un
valor distinto en las otras dos se pierde sin quedar en ningún lado si no
fuera por este snapshot. Borrable cuando el modelo nuevo esté calibrado y
nadie necesite consultar los valores viejos por tipo — no la lee ninguna
función del motor.

### Permisos: las cuatro tablas y las cinco funciones nuevas son solo de `service_role`

`demoras_calculadas`, `demoras_config`, `demoras_modelo` y
`demoras_modelo_historial` tienen `REVOKE ALL ... FROM anon, authenticated`
+ `GRANT ALL ... TO service_role` (mismo patrón que la RPC de métricas). El
motivo es que estas tablas deciden **qué calcula el motor** (interruptor,
ventanas, topes, qué modelo corre, factor de calibración), y la anon key de
Supabase vive en el bundle del browser. Sin los grants explícitos, si los
default privileges del proyecto alcanzan a `anon`, cualquiera con la anon
key puede apagar el motor o cambiarle el resultado.

Lo mismo aplica a las cinco funciones nuevas de esta tanda
(`demoras_ritmo_muestras`, `demoras_cola`, `demoras_ritmo_movil`,
`demoras_servidores`, `demoras_proximo_hueco`): cada una tiene su propio
`REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE ...
TO service_role` en su propia migración (review final de rama). A
diferencia de las tablas, Postgres le da `EXECUTE` a `PUBLIC` en **todo**
`CREATE FUNCTION` por defecto — sin este `REVOKE` explícito quedaban
invocables por la anon key vía RPC aunque las tablas que leen estuvieran
blindadas.

Verificación post-apply — las cuatro tienen que dar `f`:

```sql
SELECT has_table_privilege('anon','demoras_config','UPDATE');
SELECT has_table_privilege('anon','demoras_config','SELECT');
SELECT has_table_privilege('anon','demoras_calculadas','UPDATE');
SELECT has_table_privilege('authenticated','demoras_config','UPDATE');
```

Si alguna da `t`, la migración de la tabla (archivo 3) no se aplicó
completa: volver a pegarla (los REVOKE/GRANT son idempotentes). Para
`demoras_modelo` / `demoras_modelo_historial`, lo mismo con el archivo 4.

### 3.1 `ritmo_cascada`: cómo se resuelve

Vive en `demoras_config`, **por tipo** (ver la excepción documentada más
arriba). CSV, se recorre de izquierda a derecha. **Gana el primer nivel que
llegue al mínimo de muestras** (`demoras_modelo.ritmo_min_muestras`, default
`5` — antes era un parámetro posicional de `demoras_ritmo`, ahora sale de
`demoras_modelo` igual que el resto de los parámetros del cálculo).
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

### 4.1 Cómo volver al modelo viejo

Si `PROXIMO_HUECO` da resultados que no se entienden o hay que comparar
contra el AS400 con el modelo conocido mientras se investiga:

```sql
UPDATE demoras_modelo SET modelo = 'CAPACIDAD_PROMEDIO' WHERE escenario_id = 1000;
```

**No requiere deploy, no toca el cron, no revierte ninguna migración.** La
corrida siguiente (máximo 10 minutos después, o antes con una llamada manual
a `SELECT demoras_calcular_run(now())`) ya usa el modelo viejo — el
orquestador despacha entre los dos en cada corrida según lo que diga esta
columna (§3), y las dos ramas escriben las mismas columnas de
`demoras_calculadas`. Volver a `PROXIMO_HUECO` es el mismo `UPDATE` con el
valor original. El `UPDATE` queda registrado en `demoras_modelo_historial`
(bumpea `version`, ver §3), así que el cambio de modelo también es
auditable: se puede reconstruir desde cuándo corrió cada uno mirando
`demoras_calculadas.modelo_version` contra el historial.

Esto **no** es lo mismo que revertir el `DROP COLUMN` del archivo 11 — para
eso, ver el backup `demoras_config_backup_20260731` que esa misma migración
crea antes de dropear (§3): sirve para recuperar una calibración vieja por
tipo si hiciera falta, no para volver a correr el modelo viejo (que no
necesita esas columnas por tipo — las lee de `demoras_modelo`, iguales para
los tres tipos).

---

## 5. Cómo cambiar el estadístico o la cascada

Cambiar cuál estadística alimenta el cálculo (por ejemplo, pasar a `P75`
para ser más conservador). Es una fila **por escenario** en `demoras_modelo`,
no por tipo — a diferencia de la guía anterior a la Task 7, **sin** `AND
tipo_servicio = ...`:

```sql
UPDATE demoras_modelo SET estadistico = 'P75' WHERE escenario_id = 1000;
```

Cambiar el orden de la cascada (por ejemplo, saltear CHOFER si el dato de
chofer no es confiable para ese tipo) sigue siendo por tipo, en
`demoras_config` — `ritmo_cascada` es la única columna de cálculo que no se
movió a `demoras_modelo` (ver §3, la excepción documentada):

```sql
UPDATE demoras_config SET ritmo_cascada = 'MOVIL,ZONA,GLOBAL'
 WHERE escenario_id = 1000 AND tipo_servicio = 'NOCTURNO';
```

Este `UPDATE` cambia **las dos cascadas a la vez**: la de zona
(`demoras_ritmo`) y la de móvil (`demoras_ritmo_movil`, la que alimenta
`PROXIMO_HUECO` vía `demoras_servidores`) leen la misma columna, por el
mismo tipo — es la única fuente real. `demoras_modelo.ritmo_cascada` **no
alimenta ninguna de las dos**; un `UPDATE` ahí no tiene ningún efecto (ver
el `COMMENT ON COLUMN` de `docs/sqls/2026-07-31-demoras-modelo-tabla.sql`).

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
`docs/sqls/2026-07-31-demoras-ritmo-v2.sql`, y en el bloque de comentarios
sobre las CTEs `por_zona_movil` / `por_zona_chofer` del mismo archivo (el
archivo `2026-07-30-demoras-ritmo-cascada.sql` queda superseded — ver §1).

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

(En el código el campo se llama `demoras_modelo.factor_calibracion` —vive ahí
desde la Task 7, ver §3; antes de esa migración vivía en `demoras_config`—;
la spec lo nombra `demora_factor_calibracion` en prosa. Es la misma columna.)

**El número calculado no debe informarse a un cliente por ningún canal hasta
que la brecha contra el AS400 esté calibrada.** Hoy el motor es solo
comparativa (§ arriba). Bajar el factor de calibración sin haber mirado la
serie de brecha en el dashboard es exactamente el escenario que R1 advierte.

### 6.1 Las corridas sin capacidad no entran en la calibración

Una fila con `sin_capacidad = true` (`capacidad_efectiva <= 0`) informa el
**techo** (`max_minutos`, hoy 120) por definición: no había un solo móvil
activo en la zona. Ese 120 no salió del modelo, así que promediarlo contra el
AS400 no mide nada — y a las 07:00, con el 72% de la flota todavía inactiva,
esas filas son la mayoría del tramo.

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

Aplicar las 12 migraciones (§1) deja el motor calculando y escribiendo en
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
Editor de Supabase), y corre los archivos de asserts. Si **alguno de los
asserts pasados** menciona `advisory_xact_lock`, además lanza dos conexiones
concurrentes para probar que el lock efectivamente serializa. Al terminar
(éxito o falla) tira abajo el contenedor.

> Hasta el 2026-07-29 ese `grep` iba contra `assert-run.sql` **hardcodeado**,
> que existe siempre — así que el test de lock corría en toda invocación,
> incluso sin haber aplicado la migración de `demoras_calcular_run`. Validar
> solo `demoras_acabado` con su assert daba `exit 1` con "function
> demoras_calcular_run does not exist": el harness reprobaba una migración
> correcta. Ahora mira los asserts que se le pasaron.

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
`assert-config.sql`, `assert-modelo.sql`, `assert-run.sql`,
`assert-ritmo-muestras.sql`, `assert-ritmo.sql`, `assert-cola.sql`,
`assert-servidores.sql`, `assert-hueco.sql`, `assert-run-v2.sql`,
`assert-grants-funciones.sql`.

**`assert-run.sql` volvió a la regresión (review final de rama).** Había
salido en la Task 7 porque probaba `demoras_calcular_run` asumiendo
`CAPACIDAD_PROMEDIO` como único modelo posible, que dejó de ser el default.
Pero **no lo reemplaza `assert-run-v2.sql`, lo complementa**: cubre 15
comportamientos que ningún otro archivo ejercita (el interruptor global y
por tipo, la ventana horaria por tipo, la idempotencia del `ON CONFLICT`, el
snapshot del AS400, la exclusión de ESPECIAL/OTROS, la precedencia
capacidad > demanda), mientras que `assert-run-v2.sql` sólo prueba lo que
agregó la Task 7 (el despacho entre modelos, el sello de versión, el bypass
del suavizado, la baja de columnas). Sigue pasando sin tocar una línea
porque sus fixtures caen en los dos extremos donde los modelos convergen —
un móvil saturado (clampea al techo en los dos) o demanda cero (el piso en
los dos, porque `ritmo_default_minutos` y `min_minutos` son 30 los dos por
default) —, así que no le importa cuál esté corriendo.

**Tiene que ir ANTES de `assert-hueco.sql` en la cadena.** `assert-hueco.sql`
deja `escenario_settings.pedidos_sa_minutos_antes = NULL` sin restaurar al
terminar (a propósito: sus propios fixtures no usan `fch_hora_para`, así que
no le afecta), y el bloque de ventana SA de `assert-run.sql` sí asume el
default del stub (`60`). Corrido después de `assert-hueco.sql` sin
resembrar ese valor, falla con `el SA fuera de ventana no debe contar: 0 ->
1` — no por un bug del código, por contaminación de estado entre asserts de
la misma invocación. El orden correcto (el que usa esta guía y el CI): justo
después de `assert-modelo.sql`, antes de `assert-ritmo-muestras.sql`.

`assert-config.sql` cubre la migración de tablas: el `CHECK (hora_fin >
hora_inicio)` (§5.1) y los grants (§3) — las dos reglas siguen vigentes
después de la Task 7; no afirma nada sobre las columnas de cálculo que esa
migración da de baja de `demoras_config` (eso lo cubre `assert-run-v2.sql`).
Los asserts de privilegios significan algo porque `00-stubs.sql` replica los
**default privileges de Supabase** (`anon` y `authenticated` con `ALL` sobre
las tablas nuevas del schema `public`): en un Postgres vanilla, `anon` nunca
tiene privilegios, así que un assert de "anon no puede escribir" pasaría por
omisión sin probar el `REVOKE`.

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
- **¿Puedo aplicar solo el archivo 6 (`demoras-ritmo-v2.sql`), sin los dos
  archivos viejos de `demoras_ritmo` que quedaron fuera de la secuencia?**
  Sí, y de hecho es lo correcto: `CREATE OR REPLACE FUNCTION` no requiere
  que la función preexista — la crea si falta, la reemplaza si está. El
  archivo 6 es una definición autosuficiente (mismo `RETURNS TABLE`, cuerpo
  completo, su propio `COMMENT`); sus dependencias reales son
  `demoras_config` (archivo 3) y `demoras_ritmo_muestras` (archivo 5), no
  los dos archivos viejos. Esos dos (`2026-07-29-demoras-ritmo.sql` y
  `2026-07-30-demoras-ritmo-cascada.sql`) no hace falta aplicarlos nunca en
  una instalación nueva — solo importan como advertencia para quien tenga
  una base ya migrada con ellos puestos (§1: no re-pegarlos después del 6).
