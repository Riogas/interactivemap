# Consumo por tramos — especificación del cálculo de demora

La capacidad de una zona no es un número fijo: **crece a lo largo del día**, a
medida que los móviles que comparte con otras zonas terminan sus compromisos y
entran a aportar. Este documento especifica cómo consumir la demanda por
tramos para calcular en cuántos minutos le llega la garrafa a un cliente que
llama ahora.

> **Reemplaza al modelo `PROXIMO_HUECO`** descrito en
> [`DEMORA_MODELO.md`](DEMORA_MODELO.md) § 7. El resto de ese documento —el
> dominio, los datos, los tres errores del modelo original, el backtest— sigue
> vigente y es la lectura previa recomendada. La guía operativa es
> [`DEMORA_INFORMADA.md`](DEMORA_INFORMADA.md).

---

## 1. La idea

**La demanda de la zona se va consumiendo a una velocidad que aumenta cada vez
que un móvil termina lo que tenía en otras zonas.** El pedido nuevo se entrega
cuando esa demanda, incluyéndolo a él, llegó a cero.

Lo importante es el «cada vez». Si un móvil se libera a los 15 minutos, otro a
los 60 y otro a los 90, **no hay que esperar al de 90 para empezar a contar**:
el de 15 ya está ayudando desde los 15. Ese error —esperar al último— es la
diferencia entre estimar 117 minutos y estimar 138 sobre el mismo dato.

### Qué cambia respecto de `PROXIMO_HUECO`

| | Próximo hueco | Consumo por tramos |
|---|---|---|
| Móvil compartido | Compite igual, se castiga, o se descarta | **Aporta una fracción de su velocidad, siempre** |
| Pedidos asignados **en** la zona | Clavados a su móvil | **Son demanda de la zona: los toma cualquiera** |
| Pedidos del móvil en **otras** zonas | Suman a su tiempo de liberación | Igual, más el traslado de vuelta |
| Cómo se consume la cola | Uno por uno, al primer móvil libre | **Como un caudal que crece por escalones** |
| Resultado | El hueco del primer móvil disponible | El minuto en que la cola llega a cero |

El segundo renglón es el más importante y el menos evidente. Hoy, si un pedido
está asignado al móvil M, el modelo asume que **lo va a hacer M**. En la calle
el despacho reacomoda. Tratar los pedidos de la zona como demanda de la zona
—y no de un móvil— es más fiel, y evita contar dos veces el mismo trabajo.

---

## 2. Las cuatro piezas

### Q — la demanda de la zona

Cuántos pedidos hay que sacar antes de que el nuevo esté entregado.

```
Q = pendientes sin asignar
  + pendientes asignados DENTRO de esta zona
  + 1                                          ← el pedido que entra ahora
```

Los **atrapados** —asignados a un móvil que hoy no salió— quedan afuera. Los
sin asignar entran solo si arrancan dentro de la ventana de visibilidad
(`pedidos_sa_minutos_antes`); los asignados cuentan siempre.

### r_j — cuándo entra cada móvil

Minutos hasta que el móvil *j* termina lo que tiene **fuera de esta zona** y
llega acá.

```
r_j = (pedidos pendientes de j en otras zonas) × ritmo_j
    + traslado_fuera_zona_minutos              ← una sola vez, si tiene algo afuera
```

Cuenta **todo lo que lleva, de cualquier tipo de servicio**: el móvil es un
solo camión y un service lo ocupa igual que un urgente. El traslado se suma
una sola vez, no por pedido: es el viaje de regreso. Un móvil sin nada afuera
tiene `r_j = 0` y aporta desde el minuto cero.

### ritmo_j — cuánto tarda por entrega

Minutos entre una entrega y la siguiente del mismo móvil, medidos del
histórico real (`metricas_cumplimiento.fch_hora_finalizacion`).

Cascada: **el ritmo propio del móvil → el de su chofer → el de la zona → el
piso configurado**.

Se descartan los intervalos **mayores** a `ritmo_hueco_max_minutos` (almuerzo,
recarga, ratos sin pedidos) **y los menores** a `ritmo_hueco_min_minutos`, que
son entregas marcadas en lote. Sin ese piso, un chofer que marca cinco
entregas juntas queda con un ritmo de segundos y arrastra a toda su zona.

### p_j — cuánto de su tiempo le da a la zona

La fracción de su jornada que el móvil *j* dedica a esta zona.

1. Cada zona de **tránsito** se lleva `dedicacion_transito` (0,20).
2. Si la suma de todos los tránsitos del móvil supera
   `transito_dedicacion_max_total` (0,60), **se achican todos a prorrata**
   hasta ese tope.
3. Las zonas de **prioridad** se reparten lo que queda, en partes iguales.

| Zonas del móvil | Cada tránsito | Suma tránsito | Cada prioridad |
|---|---|---|---|
| 1 prioridad | — | 0,00 | 1,00 |
| 1 prioridad + 1 tránsito | 0,20 | 0,20 | 0,80 |
| 1 prioridad + 2 tránsito | 0,20 | 0,40 | 0,60 |
| 1 prioridad + 3 tránsito | 0,20 | 0,60 | 0,40 |
| 1 prioridad + 4 tránsito | **0,15** ↓ | 0,60 | 0,40 |
| 1 prioridad + 5 tránsito | **0,12** ↓ | 0,60 | 0,40 |
| 2 prioridad + 1 tránsito | 0,20 | 0,20 | 0,40 c/u |

**El tope es lo que sostiene a la prioridad.** A partir del cuarto tránsito los
aportes se achican para no pasar de 0,60 entre todos, así la zona de prioridad
nunca baja de 0,40 por más zonas de tránsito que se le agreguen al móvil.

> **Caso a confirmar con el uso:** un móvil que es tránsito en todas sus zonas
> y prioridad en ninguna. Con el tope, sus aportes suman 0,60 y el 0,40
> restante no se usa. Se deja así a propósito (conservador: informa un poco
> más de demora). Si se prefiere que en ese caso los tránsitos se repartan el
> 100%, es un cambio de un renglón.

---

## 3. El algoritmo

Cada móvil, una vez libre, aporta **p_j ÷ ritmo_j** pedidos por minuto. Un
móvil exclusivo que entrega cada 10 minutos aporta 0,10; uno que le da el 20%
de su tiempo a la zona aporta 0,02 — un pedido cada 50 minutos en promedio,
que **no** significa que tarde 50 en entregar, sino que el resto del tiempo
está en otro lado.

```
Q = pendientes de la zona + 1
t = 0
μ = suma de los aportes de los móviles con r_j = 0

para cada momento de liberación r, en orden ascendente:
    tramo     = r - t
    procesados = tramo × μ

    si μ > 0 y Q <= procesados:
        demora = t + Q / μ                 ← se vacía dentro de este tramo
        terminar

    Q = Q - procesados
    t = r
    μ = μ + (aportes de los móviles que se liberan en r)

si μ = 0:
    sin capacidad → se informa el techo
si no:
    demora = t + Q / μ
```

Sobre ese número se aplica lo que ya funciona y **no cambia**: el piso y el
techo, el redondeo hacia arriba al escalón de 15 minutos, el suavizado
asimétrico contra la corrida anterior (con su bypass por cambio de capacidad)
y el factor de calibración.

---

## 4. El ejemplo, resuelto

Zona A con **20 pedidos pendientes**. Entra uno nuevo, así que hay que sacar
**21**. Todos entregan cada **10 minutos** cuando trabajan acá.

| Móvil | Rol | Libre en | p_j | Aporta |
|---|---|---|---|---|
| M1 | solo esta zona | 0' | 1,00 | 0,100/min |
| M2 | compartido | 15' | 0,50 | 0,050/min |
| M3 | compartido | 60' | 0,50 | 0,050/min |
| M4 | compartido | 90' | 0,50 | 0,050/min |

| Tramo | Quiénes trabajan | Capacidad | Procesa | Quedan |
|---|---|---|---|---|
| 0 → 15' | M1 | 0,10/min | 1,50 | 19,50 |
| 15 → 60' | M1 + M2 | 0,15/min | 6,75 | 12,75 |
| 60 → 90' | M1 + M2 + M3 | 0,20/min | 6,00 | 6,75 |
| 90 → 117' | los cuatro | 0,25/min | 6,75 | 0 |

```
6,75 / 0,25 = 27 min   →   90 + 27 = 117 minutos   →   redondeo → 120
```

**Contra esperar a que estén todos: 138 minutos.** Veintiún minutos de más
sobre el mismo dato, por ignorar que el de los 15 y el de los 60 ya estaban
ayudando.

> **Los tiempos de liberación de esta tabla están puestos a mano.** El 15, el
> 60 y el 90 son números redondos elegidos para explicar el algoritmo, no
> valores que el sistema pueda producir: `r_j` sale de `carga × ritmo +
> traslado`, así que está **cuantizado** por el ritmo del móvil. Con ritmo 10
> y traslado 5, los valores alcanzables son 0, 15, 25, 35, 45, 55… — el 60 y el
> 90 no existen.
>
> Por eso el test que verifica este ejemplo usa la terna **15 / 55 / 95**, que
> suma lo mismo (165) y **da el mismo resultado de 117 minutos**. La aritmética
> de los tramos es idéntica; lo único que cambia es que esos tres tiempos sí
> son producibles por la fórmula real.
>
> No es un defecto del modelo ni del ejemplo: es la diferencia entre una tabla
> que enseña y un test que se conecta con el código de verdad. Queda anotado
> acá para que nadie pierda una tarde tratando de reproducir el 60 y el 90.

> **Ojo con el 0,50 del ejemplo.** Usa 50% de dedicación para los compartidos;
> nuestro parámetro es **0,20**. Con él cada compartido aportaría 0,02/min, la
> capacidad final sería 0,16 y la cuenta daría **alrededor de 152 minutos**,
> que se pasa del techo y se informa 120. No es un error del modelo: es el
> parámetro haciendo lo suyo. Pero muestra que **ese 0,20 es la perilla más
> sensible de todo el cálculo** y que hay que calibrarla con el backtest antes
> de creerle a ningún número.

---

## 5. Los tipos de servicio

**Urgente y nocturno son equivalentes a los efectos de la demanda**: un móvil
haciendo un nocturno está igual de ocupado que si hiciera un urgente.

| Al calcular… | La demanda Q suma | Los móviles son |
|---|---|---|
| URGENTE | urgentes + nocturnos | los habilitados para urgente |
| NOCTURNO | urgentes + nocturnos | los habilitados para nocturno |
| SERVICE | solo services | los habilitados para service |

**La demanda se une; los móviles no.** Los dos tipos pueden dar números
distintos, porque un móvil puede estar habilitado para urgente y no para
nocturno. Cada uno respeta su propia ventana horaria: fuera de su horario, ese
tipo no escribe fila.

**Para `r_j`, en cambio, todo cuenta** — incluidos los services. No es una
inconsistencia: son dos preguntas distintas. «Cuánta demanda tiene esta zona»
mira el tipo; «cuánto falta para que este camión esté libre» mira el camión.

---

## 6. Parámetros

Cuatro nuevos y uno que cambia de valores. **Todos por escenario**, igual que
el resto de la configuración del cálculo (`demoras_modelo`).

| Parámetro | Qué hace | Default |
|---|---|---|
| `dedicacion_transito` | **Nuevo.** Fracción del tiempo que un móvil le da a cada zona donde es tránsito. La perilla más sensible del modelo. Va aparte de `peso_transito_alpha`, que usa el cálculo viejo. | `0.20` |
| `transito_dedicacion_max_total` | **Nuevo.** Cuánto pueden sumar entre todas las zonas de tránsito de un móvil. Si se pasan, se achican a prorrata. Es lo que le garantiza el piso a la prioridad. | `0.60` |
| `traslado_fuera_zona_minutos` | **Nuevo.** Minutos que tarda un móvil en volver a la zona después de terminar afuera. Se suma **una sola vez** a `r_j`, no por pedido. Con 0 se comporta como si ya estuviera absorbido en el ritmo histórico. | `15` |
| `ritmo_hueco_min_minutos` | **Nuevo.** Piso del ritmo: los intervalos menores se descartan como marcación en lote. | `5` |
| `modelo` | Cambia de valores: `CONSUMO_TRAMOS` o `CAPACIDAD_PROMEDIO`. `PROXIMO_HUECO` se retira. | `CONSUMO_TRAMOS` |

**Se retiran** `transito_modo`, `transito_castigo_minutos` y
`transito_margen_minutos`: eran las cuatro maneras de decidir si un móvil de
tránsito «entraba o no». En este modelo siempre entra, con la fracción que le
corresponda. Esa decisión desaparece, reemplazada por un número calibrable.

Todo lo demás sigue igual: el estadístico, la cascada del ritmo, la ventana del
histórico, el corte de huecos de arriba, el piso y el techo, el escalón de
redondeo, el suavizado, el factor de calibración y las ventanas horarias.

---

## 7. Casos de borde

Todos tienen que estar cubiertos por un test antes de aplicar esto.

| Caso | Qué tiene que pasar |
|---|---|
| **Ningún móvil activo** | Capacidad cero y ninguna liberación por venir → se informa el techo y se marca `sin_capacidad`. Esas filas quedan fuera de la calibración. |
| **Todos ocupados afuera** | Capacidad cero al arrancar, pero hay liberaciones futuras. Hay que **avanzar al primer evento sin dividir por cero** y **sin** marcar `sin_capacidad`: hay quien va a venir. |
| **Zona vacía** | `Q = 1`, solo el pedido nuevo. La demora es lo que tarda la capacidad disponible en hacer ese uno; con móviles libres da poco y lo levanta el piso. |
| **Pedidos fraccionarios** | Quedan 6,75 pedidos. Aproximación aceptada: significa un pedido en curso. El redondeo de a 15 se la come. |
| **Móvil sin historial** | Cascada hasta el piso configurado. Nunca puede quedar sin ritmo: un ritmo nulo lo sacaría del cálculo sin dejar rastro. |
| **Empate en la liberación** | Dos móviles que se liberan en el mismo minuto entran los dos en el mismo tramo. A diferencia del modelo anterior, **el empate no necesita desempate**: se suman las capacidades. |

---

## 8. Alcance: todos los escenarios

Toda la configuración es **por escenario** —el agrupador grande, más o menos un
departamento— y las tablas ya estaban hechas así. Pero el orquestador tenía el
escenario **1000 clavado en el código** (`v_esc integer := 1000`): cargarle
configuración a otro escenario no hacía que se calculara.

**Se generaliza**: el orquestador recorre todos los escenarios que tengan fila
en `demoras_modelo`. El cálculo ya recibe el escenario por parámetro en todas
las funciones, así que el cambio se concentra en el orquestador.

**Lo que hay que vigilar es el volumen.** La tabla de hechos se multiplica por
la cantidad de escenarios: hoy son ~25.000 filas por día y 4,5 millones en
régimen con 180 días de retención; con cinco departamentos pasa a 125.000 por
día y 22 millones. El tiempo de corrida medido —entre 265 ms y 4,4 segundos
por escenario— sigue entrando cómodo en los 10 minutos del cron, pero deja de
ser despreciable y hay que medirlo de nuevo con el volumen real.

---

## 9. Cómo se decide si esto sirve

Igual que siempre: **no se decide discutiendo, se decide con el backtest.** Se
agarra un pedido real que entró un martes a las 14:20, se reconstruye el estado
del sistema en ese momento, se corre la fórmula y se compara con lo que ese
pedido tardó de verdad. Repetido sobre miles de pedidos, eso contesta si el
0,20 está bien, si el piso del ritmo tiene que ser 5 o 3, y cuál de los dos
modelos acierta más.

**El número del AS400 no es la verdad** — es otra estimación. La verdad son las
entregas que ocurrieron.
