# Motor de demora informada por zona — Diseño

**Fecha:** 2026-07-28
**Estado:** Aprobado, pendiente de plan de implementación
**Alcance:** TrackMovil (repo `interactivemap`), escenario 1000

---

## 1. El problema

Cuando un cliente llama para pedir una garrafa, hay que decirle cuánto va a
demorar. Hoy ese número lo produce el AS400 y TrackMovil solo lo consume.

Queremos que TrackMovil lo **calcule** cada 10 minutos usando los datos que ya
tiene (pedidos pendientes, móviles activos, historial real de cumplimiento), y
lo compare contra el del AS400 para validar el modelo antes de que le llegue a
un cliente.

### Lo que ya existe

| Objeto | Qué es | Quién lo escribe |
|---|---|---|
| `demoras` | Demora informada por (escenario, zona, tipo). 118 filas, 102 activas. | **AS400**, vía `/api/import/demoras` |
| `moviles_dia` | Read model por (escenario, móvil, fecha): `activo`, `pedidos_pendientes`, `services_pendientes`, `tamano_lote` | TrackMovil |
| `moviles_zonas` | Qué móvil atiende qué zona, con `tipo_de_servicio` y `prioridad_o_transito` | AS400 |
| `metricas_cumplimiento` | Hechos de demora real asignado→cumplido, 168k filas | `metricas_cumplimiento_run` (pg_cron) |
| `escenario_settings.peso_transito_alpha` | Peso de zonas de tránsito, default 0.3 | Config |

### Hallazgos que condicionan el diseño

Todos verificados contra la base de producción el 2026-07-28:

1. **El AS400 solo informa URGENTE.** Las 118 filas de `demoras` son URGENTE,
   zona_tipo `Distribucion`. No hay NOCTURNO ni SERVICE.
2. **La oferta distingue tres tipos**: `moviles_zonas` tiene SERVICE (313),
   URGENTE (303), NOCTURNO (103).
3. **Casi la mitad de las asignaciones son de tránsito**: 334 tránsito vs 385
   prioridad. El `alpha` no es un ajuste fino, mueve la aguja.
4. **`zonas.activa` y `zonas.demora_minutos` están muertos**: `activa` es
   `true` en las 107 zonas y `demora_minutos` es 40 en las 107. Nadie los
   mantiene. La bandera real de zona activa es **`demoras.activa`**.
5. **El 72% de la flota está inactiva**: de 352 móviles del día, solo 99 tienen
   `activo=true`. Sin ese filtro el cálculo sería pura fantasía.
6. **`moviles_dia.activo` ya es `estado_nro NOT IN (3,5,15)`** — verificado por
   cruce. No hay que re-derivarlo.
7. **El AS400 usa escalones de 5 minutos** (35, 40, 45), no de 15. Nuestro
   número va a ser sistemáticamente más grueso.
8. **Cobertura desigual por tipo**: URGENTE cubre 106 zonas, SERVICE 101,
   NOCTURNO solo 51 — y en 25 de esas 51 solo hay móviles de tránsito.

---

## 2. Decisión de alcance

El valor calculado **no reemplaza ni se empuja al AS400**. Se guarda en una
tabla propia y se muestra como comparativa en el dashboard de métricas de
cumplimiento. Nadie lo informa a un cliente todavía.

Esto es deliberado: el modelo tiene supuestos que sólo se pueden calibrar
contra la realidad (ver §7, riesgo R1). Fase 1 es medir; decidir si reemplaza
al AS400 es una decisión posterior con datos en la mano.

---

## 3. El cálculo

```
demora_cruda = (trabajo_pendiente ÷ capacidad_efectiva) × ritmo × factor_calibracion
```

### 3.1 Trabajo pendiente (demanda)

Por par (zona, tipo), pedidos y services con `estado_nro = 1` y `fch_para` =
hoy en Montevideo. Se cuentan **unidades, no lote** — el tamaño del lote se
descartó explícitamente.

Mapeo de tipos (la demanda tiene 5 baldes, el motor usa 3):

| Balde de demanda | Va al tipo |
|---|---|
| URGENTE | `URGENTE` |
| NOCTURNO | `NOCTURNO` |
| (todos los services) | `SERVICE` |
| **ESPECIAL, OTROS** | **excluidos — no cuentan como demanda** |

**Corrección del 2026-07-28 (decisión del usuario):** ESPECIAL y OTROS quedan
**fuera** del motor. La versión anterior de esta spec los plegaba a URGENTE
porque no tienen oferta propia en `moviles_zonas`; eso inflaba artificialmente
la demanda de URGENTE con pedidos que no compiten por los mismos móviles. Un
pedido ESPECIAL no cuenta como demanda para ningún bucket.

Se cuentan tanto los asignados a un móvil como los sin asignar de esa zona.

**Trabajo atrapado:** los pedidos asignados a un móvil que hoy está inactivo
cuentan como demanda pero su móvil no aporta capacidad. Es correcto: ese
trabajo existe y alguien lo va a tener que hacer. Hoy son 3 pedidos.

### 3.2 Capacidad efectiva (oferta)

Solo móviles con `moviles_dia.activo = true` en la fecha de hoy.

Cada móvil aporta una fracción, no una unidad:

```
peso(móvil, zona) = 1       si prioridad_o_transito = 1
                  = alpha   en otro caso          (escenario_settings.peso_transito_alpha, default 0.3)

aporte(móvil, zona, tipo) = peso(móvil, zona) ÷ Σ peso(móvil, z) para todas las
                            zonas z de ese móvil DENTRO del mismo tipo

capacidad_efectiva(zona, tipo) = Σ aporte(m, zona, tipo) sobre los móviles activos
```

Es el mismo mecanismo de `lib/zonas-cap-entrega.ts`, aplicado a **presencia**
del móvil en vez de a unidades de lote. Garantiza que un móvil nunca sume más
de 1 en total, por más zonas que atienda.

Ejemplo: móvil en 1 zona de prioridad + 3 de tránsito, alpha=0.3.
`W = 1 + 0.3×3 = 1.9`. Aporta `1/1.9 = 0.53` a la de prioridad y `0.3/1.9 = 0.16`
a cada una de tránsito. Total 1.0.

### 3.3 Ritmo

De `metricas_cumplimiento`, ventana de los **últimos 7 días cerrados**, sobre
`demora_efectiva_mins`. Se calculan y persisten **las cuatro** estadísticas:
`media`, `mediana`, `p75`, `p90`.

Cascada de atribución, primera que tenga al menos `RITMO_MIN_MUESTRAS = 5`
hechos:

```
chofer del móvil  →  móvil  →  zona  →  global del tipo
```

Como la capacidad de una zona es un agregado de varios móviles (cada uno con su
chofer), el ritmo de la zona es el **promedio ponderado por aporte** de los
ritmos de sus móviles activos. Si ninguno tiene dato suficiente, cae a la zona;
si la zona tampoco, al global del tipo.

Se persiste `ritmo_origen` (`CHOFER|MOVIL|ZONA|GLOBAL`) para poder auditar de
dónde salió cada número. Como distintos móviles de la misma zona pueden
resolverse a niveles distintos, `ritmo_origen` registra el **nivel más
específico que se pudo usar para al menos un móvil** de esa zona: si al menos
uno resolvió por chofer, la fila dice `CHOFER`.

Cuál de las cuatro alimenta el cálculo lo decide `demora_estadistico`
(default `MEDIANA`). Las otras tres quedan guardadas, así se puede reprocesar
el histórico con otra sin recalcular nada.

### 3.4 El acabado

En este orden exacto:

```
1. crudo       →  (pendientes / capacidad) × ritmo × factor_calibracion
2. clamp       →  max(demora_min, min(demora_max, crudo))
3. suavizado   →  vs. `demora_suavizada` de la corrida anterior:
                    sube como máximo demora_subida_max
                    baja como máximo demora_bajada_max
4. redondeo    →  hacia arriba al múltiplo de demora_escalon  → demora_informada
```

**El orden no es negociable.** Si se redondea antes de suavizar, el suavizado
opera sobre escalones y se traba en falso.

Se persisten **dos** números:
- `demora_suavizada` (continuo, sin redondear) — es el estado que arrastra a la
  próxima corrida
- `demora_informada` (redondeado) — es la salida

Sin esa separación la serie se atasca: el redondeo comería los incrementos
pequeños y el valor nunca se movería.

**Comportamiento del suavizado** (subida 30 / bajada 15, corridas de 10 min):

```
PICO FALSO                        CONGESTIÓN REAL
crudo    30 120  60  60  45       crudo    30 120 120 120 120
informa  30  60  60  60  45       informa  30  60  90 120 120
         └ el 120 nunca se informa         └ llega a la verdad en 30 min
```

### 3.5 Casos borde

| Situación | Resultado |
|---|---|
| Zona activa, sin demanda | `demora_min` |
| Zona activa, con demanda, `capacidad_efectiva = 0` | `demora_max`, y `sin_capacidad = true` |
| Zona con `demoras.activa = false` | No se emite fila |
| NOCTURNO/SERVICE (sin bandera propia) | Hereda `demoras.activa` de la fila URGENTE de esa zona |
| Zona+tipo sin ningún móvil en `moviles_zonas` | No se emite fila (el servicio no existe ahí) |
| Primera corrida del día (07:00) | El suavizado **no** arrastra del día anterior: `demora_suavizada = clamp(crudo)`. Entre las 23:30 y las 07:00 la operación cambia por completo; arrastrar el estado de anoche informaría una demora que ya no significa nada. |
| Fuera de ventana horaria | La función no hace nada y retorna 0 |

---

## 4. Modelo de datos

### 4.1 Tabla `demoras_calculadas`

Una fila por (corrida, zona, tipo). Guarda el resultado **y los insumos**, para
poder contestar "¿por qué esta zona informó 90?" seis semanas después.

```sql
CREATE TABLE demoras_calculadas (
  corrida_at            timestamptz NOT NULL,   -- inicio de la corrida (misma para todas las filas)
  escenario             integer     NOT NULL,
  zona_id               integer     NOT NULL,
  tipo_servicio         text        NOT NULL CHECK (tipo_servicio IN ('URGENTE','NOCTURNO','SERVICE')),

  -- salida
  demora_informada      integer     NOT NULL,   -- redondeada; esto es "el número"
  demora_suavizada      numeric     NOT NULL,   -- continua; estado para la próxima corrida
  demora_cruda          numeric     NOT NULL,   -- antes de clamp/suavizado
  demora_as400          integer,                -- snapshot de demoras.minutos vigente (NULL si no hay)

  -- insumos: demanda
  pendientes_asignados  integer     NOT NULL,
  pendientes_sin_asignar integer    NOT NULL,
  pendientes_atrapados  integer     NOT NULL,   -- en móviles inactivos

  -- insumos: oferta
  capacidad_efectiva    numeric     NOT NULL,
  moviles_activos       integer     NOT NULL,
  moviles_prioridad     integer     NOT NULL,
  moviles_transito      integer     NOT NULL,
  alpha_usado           numeric     NOT NULL,

  -- insumos: ritmo (las cuatro, siempre)
  ritmo_media           numeric,
  ritmo_mediana         numeric,
  ritmo_p75             numeric,
  ritmo_p90             numeric,
  ritmo_usado           numeric,                -- la que alimentó el cálculo
  ritmo_origen          text CHECK (ritmo_origen IN ('CHOFER','MOVIL','ZONA','GLOBAL')),
  ritmo_muestras        integer,

  -- banderas
  sin_capacidad         boolean     NOT NULL DEFAULT false,
  clampeado             text CHECK (clampeado IN ('MIN','MAX')),  -- NULL si no se clampeó
  suavizado_aplicado    boolean     NOT NULL DEFAULT false,

  PRIMARY KEY (corrida_at, escenario, zona_id, tipo_servicio)
);

CREATE INDEX idx_demoras_calc_esc_zona_tipo_at
  ON demoras_calculadas (escenario, zona_id, tipo_servicio, corrida_at DESC);
CREATE INDEX idx_demoras_calc_at ON demoras_calculadas (corrida_at);
```

Volumen: ~254 filas × 99 corridas/día ≈ **25.000 filas/día**. Con retención de
30 días, ~750k filas.

### 4.2 Retención

Job diario que purga `corrida_at < now() - 30 días`. Se agrega al mismo pg_cron
que ya limpia GPS (`cron-cleanup-gps-history.sql` es el patrón).

### 4.3 Configuración

Tabla `app_config` (ya existe, la usa el modal de Preferencias Globales).
Gate: root o funcionalidad `Preferencias Globales`.

| Clave | Default | Descripción |
|---|---|---|
| `demora_min_minutos` | 30 | Piso |
| `demora_max_minutos` | 120 | Techo |
| `demora_escalon_minutos` | 15 | Redondeo hacia arriba |
| `demora_subida_max` | 30 | Máximo que sube por corrida |
| `demora_bajada_max` | 15 | Máximo que baja por corrida |
| `demora_estadistico` | `MEDIANA` | `MEDIA\|MEDIANA\|P75\|P90` |
| `demora_hora_inicio` | `07:00` | Inicio de ventana (Montevideo) |
| `demora_hora_fin` | `23:30` | Fin de ventana (Montevideo) |
| `demora_factor_calibracion` | `1.0` | Multiplicador global (ver R1) |
| `demora_motor_activo` | `true` | Interruptor de emergencia |

---

## 5. El motor

Función SQL pura `demoras_calcular_run(p_corrida_at timestamptz DEFAULT now())`,
disparada por `pg_cron` **cada 10 minutos, las 24 horas**.

La ventana horaria se evalúa **dentro de la función**, no en la expresión cron.
Motivo: `pg_cron` corre en UTC y la ventana 07:00–23:30 de Montevideo cruza la
medianoche UTC (10:00 UTC a 02:30 UTC del día siguiente), lo que obligaría a
partirla en dos expresiones que se desincronizan sin que nadie se entere. Con
la lógica adentro, la ventana es un campo configurable y cambiarla es un UPDATE.

Sin HTTP, sin endpoint, sin token — mismo patrón que
`metricas_cumplimiento_run`, que ya demostró que el camino del endpoint da 504
en nginx.

Idempotente: correr dos veces la misma `corrida_at` produce el mismo resultado
(`ON CONFLICT DO UPDATE`).

---

## 6. UI: comparativa en el dashboard

Card nueva al pie de `/dashboard/metricas-cumplimiento`, respetando el patrón
existente (`CardShell` + `ExpandModal` + popover "i").

- **Serie temporal del día**: dos líneas por zona — la nuestra (escalonada) y la
  del AS400. Selector de zona y de tipo de servicio.
- **Tabla de brecha**: por zona, promedio nuestro vs. del AS400 y la diferencia,
  ordenable por brecha.
- Para NOCTURNO y SERVICE se dibuja **solo nuestra línea**, con una nota
  explícita en la card: el AS400 no informa esos tipos. Un hueco sin explicar se
  lee como un bug.

La card respeta el escenario seleccionado, como todo el resto de la pantalla.

---

## 7. Riesgos

**R1 — El ritmo puede estar doble-contando la cola (ALTO).**
`demora_efectiva_mins` mide asignación→cumplimiento, y ese tiempo **ya incluye
la espera en cola** del momento en que se midió. Multiplicarlo por la cantidad
de pendientes puede inflar el resultado, porque la espera se cuenta dos veces.

Es una aproximación heurística, no una fórmula de teoría de colas. Mitigación:
`demora_factor_calibracion` permite ajustar el nivel global sin tocar código, y
la fase de comparación contra el AS400 existe precisamente para calibrarlo. Si
la brecha resulta sistemática y proporcional, se ajusta el factor; si es
errática, hay que repensar el modelo del ritmo.

**Esto debe quedar claro antes de que el número se informe a un cliente.**

**R2 — NOCTURNO tiene cobertura pobre (MEDIO).** Solo 51 de 107 zonas, y en 25
de esas solo hay móviles de tránsito. Las demoras de NOCTURNO van a ser
ruidosas y basadas en poca oferta. Se emiten igual, pero conviene mirarlas con
desconfianza en la fase de validación.

**R3 — La bandera de zona activa la controla el AS400 (BAJO).** Si el AS400
deja de mandar `demoras`, `activa` queda congelada y podríamos calcular para
zonas que ya no operan. Mitigación: si `demoras.updated_at` tiene más de 2
horas, marcar las filas con una bandera de dato viejo.

**R4 — Escalones distintos (BAJO).** Nosotros redondeamos a 15, el AS400 usa 5.
La comparativa siempre va a mostrar una escalera contra una curva. Es esperado,
no un defecto; hay que decirlo en la card.

---

## 8. Testing

- **Unitarios sobre el prorrateo**: un móvil en N zonas con mezcla
  prioridad/tránsito suma exactamente 1.0; alpha=0 hace que las de tránsito no
  aporten; alpha=1 las iguala a prioridad.
- **Unitarios sobre el acabado**: clamp en ambos bordes; redondeo hacia arriba
  (31→45 con escalón 15); suavizado asimétrico en las dos direcciones; la
  secuencia completa de los dos escenarios de §3.4 reproducida exactamente.
- **Casos borde de §3.5**, uno por uno.
- **Validación en Postgres local con Docker** antes de aplicar en producción:
  tablas stub + migración con `--single-transaction` + **ejecutar** la función
  con datos. Los cuerpos plpgsql no se validan al crearlos.
- **Route tests** del endpoint de lectura del dashboard, siguiendo el patrón de
  `app/api/metricas/dashboard/route.test.ts`.

---

## 9. Fuera de alcance

- Escribir en `demoras` o empujar el valor al AS400.
- Reemplazar el import del AS400.
- Informar el número calculado a un cliente por cualquier canal.
- Ruteo o asignación automática de pedidos (proyecto aparte).
- Escenarios distintos del 1000 (el modelo los soporta, pero hoy no existen).
