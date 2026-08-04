# Arranque PREDICTIVO — primera demora del día 100% calculada

**Fecha**: 2026-08-04 · **Estado**: diseño CERRADO con el usuario, sin implementar.
**Alcance v1**: solo URGENTE, solo zonas activas. NOCTURNO/SERVICE quedan como hoy
(se definen cuando se aborde cada uno). Feriados: sin tratamiento especial (a lo
sumo hay menos móviles o zonas inactivas ese día — el universo de zonas activas
ya lo absorbe).

## Objetivo

Que la primera demora del día de cada zona salga TODA de datos — cero valores
de demora cargados a mano (ni grilla del Despacho, ni global, ni por zona). Los
únicos datos configurables son **horarios** (ventana del cron + espera máxima
al móvil de prioridad), no demoras.

Reemplaza el uso del valor del Despacho en el arranque
(`arranque_sin_movil_modo = 'DESPACHO_MAS_COLA'`, activo desde el 4/8): decisión
explícita del usuario — "que no hayan datos que alguien ponga a mano respecto a
la primer demora".

## Los tres insumos (siempre por escenario + tipo de servicio + zona)

1. **Ventana del cron por tipo de día** (HÁBIL / SÁBADO / DOMINGO): desde/hasta
   qué hora corre el motor. Precargada con la ventana actual de `demoras_config`
   para los tres tipos (día 1 idéntico a hoy), editable.
2. **Histórico de primera activación del primer móvil DE PRIORIDAD** — los de
   tránsito NO cuentan para la primera demora. Se reconstruye de
   `demoras_calculadas.moviles_prioridad` (verificado en prod: 99/102 zonas
   URGENTE con 5+ días capturados; dispersión típica entre días 20–45 min).
3. **Lo que el motor ya sabe**: `ritmo_usado` de la zona y la cola equivalente.

## Configuración nueva: espera máxima al prioridad

`hora máxima de espera` por (escenario, tipo_servicio, zona) con default por
(escenario, tipo_servicio): hasta qué hora del día se le "espera" al móvil de
prioridad. Ejemplo del usuario: arranque 08:00, espera máxima 10:00.

Esta única perilla resuelve el dilema del tránsito (corrección del usuario
2026-08-04): **la espera máxima se respeta SIEMPRE** —
- Mientras `ahora ≤ hora_max`: se espera al prioridad y el tránsito es
  invisible. Si el histórico estima una hora MAYOR que la máxima (ej. 11:00
  con máxima 10:00), la estimación se capea a la hora máxima — nunca se
  promete más allá de ella, pero tampoco se saltea la espera.
- Pasada la hora máxima sin prioridad: se calcula con lo que HAY (tránsito
  con su dedicación 0.2). Si un prioridad aparece antes, motor normal al toque.

Es **por tipo de día** (HÁBIL/SÁBADO/DOMINGO). Default precargado: apertura
de la ventana de ese tipo de día + 2 horas.

## Árbol de decisión (cada corrida, URGENTE, por zona)

```
pri = moviles_prioridad ; tra = moviles_transito
est = activación estimada del primer prioridad (cadena de respaldo abajo)
max = hora máxima de espera de la zona (o default esc+tipo)

SI pri > 0            → motor normal (prioridad + tránsito con sus pesos alpha)   [como hoy]
SI pri = 0:
  SI ahora ≤ max:                        -- la ventana de espera se respeta SIEMPRE
     est_eff = min(est, max)             -- la estimación se capea a la hora máxima
     SI ahora ≤ est_eff + gracia (20'):
        demora_cruda = espera + (cola_equivalente + 1) × ritmo_zona    [PREDICTIVO]
        con espera = max(0, est_eff − ahora)
     SINO:                                                             [GRACIA_VENCIDA]
        sin_capacidad → la escalera sube hacia el techo (no sabemos qué
        le pasó al móvil; se sigue SIN considerar tránsito hasta `max`)
  SINO (ahora > max):
     SI tra > 0 → motor normal SOLO tránsito (dedicación 0.2)          [TRANSITO]
     SINO      → respaldo Despacho + cola × ritmo (zona muerta: el
                 valor del Despacho es el mejor dato disponible;
                 medido 3/8: 5/7 aciertos vs 0/7 con techo). Sin valor
                 del Despacho, techo con escalera.                     [fase NULL]
```

Todo pasa después por el pipeline de siempre: clamp 30–120, escalón de 15,
escalera de suavizado (con el bypass por cambio de capacidad ya activo). La
"suavidad de 15" y los márgenes 30–120 son invariantes pedidos explícitamente.

En cuanto el prioridad se activa, juegan los dos (prioridad + tránsito) con su
peso definido — comportamiento actual del motor, sin cambios.

**Cambio de gate**: hoy el arranque gatea con `moviles_activos ≤ 0` (tránsito
cuenta). El modo nuevo gatea con `moviles_prioridad = 0` — una zona con solo
tránsito entra al árbol (hoy va al cálculo normal con capacidad 0.2 directo).

## Estimación de la activación

- `est` = percentil del histórico del MISMO tipo de día (hábil/sáb/dom).
- **Confianza**: mínimo de muestras (perilla, default 4) del mismo tipo de día.
- **Cadena de respaldo** (confirmada): histórico mismo tipo de día → histórico
  general de la zona → apertura de la ventana del día.
- Manda el **histórico sobre el horario** cuando hay muestra confiable (la
  realidad le gana a la config); el horario es solo respaldo.
- **Qué estadístico** (mediana / mediana+margen / p75): lo decide el
  retro-backtest contra la última semana (misma metodología del informe
  semanal) ANTES de activar. No se elige a mano.

## Ejemplos de referencia (zona ritmo 30, apertura 08:00, espera máx 10:00)

**A. Día normal — histórico dice 08:40, sin cola:**
08:00→75 (40+30=70) · 08:10→60 · 08:20→45 · 08:30→45 · 08:40 aparece → motor
normal. Con un pedido entrando 08:20: 20 + 2×30 = 80 → 75.

**B. El móvil no aparece:** 08:40 pasa, gracia hasta 09:00 (espera=0, publica
30+cola), 09:10 en adelante escalera sube (60→90→120), a las 10:00 se cumple
la espera máxima → 10:10 calcula con tránsito 0.2 si hay; si no hay nada,
sigue en techo.

**C. Histórico dice 11:00 (> espera máx 10:00):** la estimación se capea a las
10:00 — a las 08:00 la espera es 120 → techo; va bajando a medida que se acerca
(09:20 → 40+30=70 → 75). Se espera al prioridad hasta las 10:00 (si aparece
antes, motor normal), y a las 10:10 recién entran los de tránsito con 0.2.
Nunca se promete "hasta las 11".

## Estructuras nuevas

1. **`demoras_ventanas`** (escenario_id, tipo_servicio, dia_tipo
   'HABIL'|'SABADO'|'DOMINGO', hora_inicio, hora_fin, updated_at/by) — ventana
   del cron. Seed: la ventana actual de `demoras_config` × 3 tipos de día. El
   gate del cron pasa a leer de acá (dia_tipo del día en America/Montevideo:
   dow 1–5 HÁBIL, 6 SÁBADO, 0 DOMINGO). `demoras_config.hora_inicio/fin` queda
   deprecado como fallback.
2. **`demoras_espera_max`** (escenario_id, tipo_servicio, dia_tipo,
   zona_id NULL=default, hora_max time, updated_at/by) — hora máxima de espera
   al prioridad, POR TIPO DE DÍA (decisión del usuario). Fila zona pisa la
   default del escenario+tipo+dia_tipo. Seed: apertura de la ventana + 2 h.
3. **`demoras_activacion_hist`** (escenario_id, tipo_servicio, zona_id, fecha,
   dia_tipo, primer_prioridad_at) — llenada por job nocturno pg_cron desde
   `demoras_calculadas` (primera corrida del día con `moviles_prioridad > 0`).
   Backfill inicial desde el 29/7 disponible ya. Granularidad 10 min (= la del
   motor, suficiente).
4. **Vista `demoras_activacion_estimada`**: percentil + muestras por
   (escenario, tipo, zona, dia_tipo) sobre ventana móvil (últimos ~10 hábiles /
   últimas 4 semanas para sáb-dom).
5. **Perillas nuevas en `demoras_modelo`** (aparecen solas en la pantalla de
   Preferencias Globales → Motor de demora): `arranque_sin_movil_modo` suma
   `'PREDICTIVO'`; `activacion_percentil` (default lo elige el retro);
   `activacion_margen_minutos`; `activacion_min_muestras` (default 4);
   `activacion_gracia_minutos` (default 20).
6. **Auditoría en `demoras_calculadas`** (para la fase de explicabilidad):
   `arranque_fase` ('PREDICTIVO'|'GRACIA_VENCIDA'|'TRANSITO'|NULL),
   `activacion_estimada_at`, `activacion_origen` ('DIA_TIPO'|'GENERAL'|
   'HORARIO'), `espera_minutos`, `espera_max_at`.

## Plan de ejecución

1. **Migración SQL** (run v6 + tablas + job nocturno + backfill histórico) +
   asserts en el harness (recordar: teardown resetea modos y borra fixtures).
2. **Retro-backtest** de estimadores contra la última semana → elegir
   percentil/margen → activar `PREDICTIVO`.
3. **Pantalla**: subsecciones "Ventanas del cron" (3 tipos de día) y "Espera
   máxima por zona" (default + overrides) + perillas nuevas.
4. **Explicabilidad total en la comparativa** (pedido aparte del usuario): el
   porqué de cada número en lenguaje llano — activación estimada, fase del
   arranque, cola, ritmo, escalera — y lo mismo para cumplimiento/acierto.
   "Super explicado como para que lo pueda entender bien todo el mundo."

## Dudas resueltas (2026-08-04)

- Espera máxima **por tipo de día** (no una sola).
- Default precargado: **apertura + 2 horas**.
- Orden de ejecución confirmado, todo de corrido: migración+harness →
  retro-backtest→activar → pantalla → explicabilidad.
