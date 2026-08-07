# Laboratorio de variantes (champion–challenger del motor de demora)

**Fecha:** 2026-08-07 · **Estado:** en producción (escenario 1000) · **Pedido:** Diego, audio del 7/8

## Qué pidió

> "Que cuando haga los cálculos grabe más valores: si venía con el promedio, que en otra columna grabe la mediana; si
> usaba la demora de la zona, que use la del chofer; en vez de ajustar de a 15 minutos, de a 10… unas 10 columnas más.
> Entonces cuando vayamos a analizar de vuelta, él nos va a decir: mirá, la mejor combinación, la que me dio mejor que
> Despacho, es ésta. Y no tener que hacer todos los cálculos para atrás — lo peor que nos pasa es cuánto demoramos en
> llegar a conclusiones."

Diagnóstico correcto: el cuello de botella de la semana no fueron las ideas sino el tiempo de escribir cada
retro-backtest a mano (mediana vs promedio, factor 0,85, ritmo sin ocio). Y hay variantes que un retro **no puede**
reconstruir: la escalera del suavizado depende del camino (lo que se publica a las 10:00 condiciona lo de las 10:10), y
el ritmo alternativo de un móvil no queda grabado en ningún lado.

## Qué se construyó

| Pieza | Archivo |
|---|---|
| Catálogo + tablas + clones + snapshot + backfill + cron | `docs/sqls/2026-08-07-laboratorio-variantes.sql` |
| Scoreboard (RPC) | `docs/sqls/2026-08-07-variantes-scoreboard.sql` |
| Asserts del harness | `scripts/sql-harness/assert-variantes.sql` |
| API + card + lógica pura | `app/api/metricas/variantes/route.ts`, `components/metricas/VariantesLabCard.tsx`, `components/metricas/variantes-logic.ts` |

- **`demoras_variantes`**: catálogo data-driven de 13 configuraciones. Campo `NULL` = "como el campeón". Probar una idea
  nueva es un `INSERT`, sin ALTER ni deploy.
- **`demoras_calculadas_variantes`**: lo que cada variante hubiera publicado en cada corrida, con su propia escalera.
- **`demoras_variantes_snapshot(corrida, escenario)`**: deriva de la cruda grabada lo que se puede derivar (factor,
  escalón, piso, suavizado, y **las fases del arranque** vía `cruda_motor + (cola+1)·Δritmo`) y re-simula sólo lo que lo
  necesita (estadístico, nivel del ritmo) con clones parametrizados del pipeline.
- **`demoras_variantes_backfill(minutos, max)`** + job `demoras-variantes` (cada minuto): procesa en orden las corridas
  recientes pendientes.
- **`metricas_variantes_scoreboard(jsonb)`**: ranking por día y acumulado contra el Despacho y contra el motor real,
  con tolerancia elegible (±10/15/25′) y el control `campeon_ok`.

## Las tres decisiones que importan

### 1. El motor no se toca

La v1 llamaba al laboratorio desde adentro de `demoras_calcular_run`, blindado con `BEGIN/EXCEPTION`. La revisión
adversarial (3 revisores) mostró que ese blindaje **no alcanza**: `EXCEPTION WHEN OTHERS` no atrapa `query_canceled`, así
que un `statement_timeout` o un `pg_cancel_backend` durante el laboratorio se llevaba puesta la corrida real (misma
transacción). Además multiplicaba ×4 los escaneos del histórico dentro del advisory lock del motor, y contra la lentitud
ningún blindaje protege.

**Ahora corre en su propio job, su propia transacción y su propio lock**, sobre corridas ya commiteadas. `demoras_calcular_run`
quedó idéntica a la v6.

### 2. Sólo corridas recientes (ventana de 15 minutos)

Medido el 7/8: al rellenar hacia atrás las corridas del día anterior, las variantes que re-simulan prometían **105′**
promedio contra 84′ del campeón — casi todas contra el techo. La causa es que la re-simulación necesita el estado del
mundo del momento (`moviles_dia`, pedidos en cola) y ese estado ya no existe: el rollover de móviles corre a las 02:05 y
los pendientes de ayer hoy están entregados.

Las variantes derivadas sí serían válidas hacia atrás, pero mezclar unas válidas con otras basura es peor que no tener el
dato. **Una corrida vieja no se rellena.** La columna `calculado_at` deja el desfase auditable (mediana observada: ~60 s).

Es la demostración empírica de por qué el pedido original —grabarlo en el momento— era el correcto.

### 3. Disciplina anti-ruido en la promoción

Con 13 variantes compitiendo sobre ~600 pedidos diarios, "la mejor de hoy" gana por azar con frecuencia (comparaciones
múltiples). Regla implementada en `variantes-logic.ts` y documentada en la pantalla: **PROMOVIBLE** requiere ≥7 días
evaluables, ≥5 días ganados al motor y ≥1,5 puntos de margen acumulado.

Además, el scoreboard mide al motor y al Despacho **sobre exactamente el mismo conjunto de pedidos** que las variantes.
Sin eso, un rango de 7 días contra 2 días de laboratorio hacía que todas las variantes "le ganaran al motor" por puro
artefacto (visto: motor 55,3% sobre 12.761 pedidos contra 72,3% del campeón —el mismo cálculo— sobre 1.423).

## Verificación en producción (7/8)

- **Espejo exacto**: la variante Campeón coincidió con el motor en **402/402** filas (informada, suavizada y cruda) en las
  corridas espejadas; `campeon_ok` = 100%.
- **Anti-deriva**: `demoras_consumo_tramos_lab` con la parametría del modelo reproduce a `demoras_consumo_tramos` con
  diferencia máxima **0,000** sobre 258 filas, y marca el techo en las mismas zonas.
- **Costo**: 2,1 s por corrida (13 variantes × 201 zonas = 2.613 filas), fuera del camino crítico del motor.
- **Job**: `demoras-variantes` cada minuto, desfase típico 60 s, 0 errores.

## Pendiente

- Correr `assert-variantes.sql` en el harness cuando Docker Desktop vuelva a funcionar (está escrito y cubre seed,
  anti-deriva, espejo del campeón en 3 corridas encadenadas, derivadas, escalera propia, backfill y guarda de versión).
- Agregar variantes del **arranque** al catálogo (percentil de activación, margen, gracia): hoy el laboratorio no cubre
  el Frente 1, que es el mayor débito del día.
- Con 7 días de datos, leer el veredicto de `ESCALON_10` / `SIN_ESCALERA` / `PISO_20`: el contrafáctico del 7/8 volvió a
  mostrar la cruda por encima de lo publicado (73,9% vs 72,1%), así que la publicación volvió a ser sospechosa.
