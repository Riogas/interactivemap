# Cuánto va a demorar un pedido: el problema y el modelo

Este documento explica, desde cero y sin dar nada por sabido, **qué estamos
tratando de calcular, con qué datos contamos, cómo se calcula hoy, por qué
está mal, y qué modelo proponemos en su lugar.**

Está escrito para que lo entienda alguien que nunca vio el sistema. Si en
algún punto hace falta saber algo de programación para seguirlo, es un
defecto del documento, no del lector.

> **Estado: en discusión.** El motor que está corriendo hoy usa el modelo
> viejo (sección 6). El modelo nuevo (sección 7) todavía no se implementó.
> La guía operativa de lo que SÍ está corriendo es
> [`DEMORA_INFORMADA.md`](DEMORA_INFORMADA.md).

---

## 1. Qué es esto en una frase

Un cliente llama para pedir una garrafa de supergás. Alguien le tiene que
decir **"le llega en tal cantidad de minutos"**. Este documento es sobre
cómo calcular ese número.

Hoy ese número lo da un sistema viejo (el AS400) con un criterio que no
conocemos. Queremos calcularlo nosotros, mejor, con los datos que ya
tenemos.

---

## 2. El negocio, contado desde cero

### 2.1 Las piezas

**El producto.** Garrafas de supergás que se entregan a domicilio.

**Las zonas.** La ciudad está dividida en zonas geográficas —alrededor de
100. Cada pedido cae en una zona según la dirección del cliente.

**Los móviles.** Las camionetas de reparto. Cada una tiene un chofer.
**No todos trabajan todos los días**: un móvil que salió a la calle hoy está
*activo*; uno que no salió, no.

**Los pedidos.** Cada pedido pertenece a una zona y a un *tipo de servicio*.
Un pedido puede estar:

- **Pendiente sin asignar**: entró al sistema, todavía no tiene móvil.
- **Pendiente asignado**: ya se le puso un móvil, que lo lleva arriba o lo
  va a levantar. Todavía no se entregó.
- **Cumplido**: entregado. Sale de la cola.

### 2.2 Los tres tipos de servicio

| Tipo | Qué es |
|---|---|
| **URGENTE** | El pedido común, para ahora. Es el grueso. |
| **NOCTURNO** | Entrega de noche. Solo opera de tarde/noche. |
| **SERVICE** | Trabajo técnico, no entrega de producto. |

Son tres colas separadas. Un móvil puede estar habilitado para uno, dos o
los tres. **El AS400 solo informa demora para URGENTE** — para los otros dos
no hay contra qué comparar.

Existen además pedidos de tipo ESPECIAL y OTROS, que quedan **fuera de todo
este cálculo** por decisión tomada el 2026-07-28: no tienen móviles
asignados propios, así que no forman parte de ninguna cola.

### 2.3 Prioridad y tránsito: la parte que confunde

Un móvil no trabaja una sola zona. Está asignado a varias, y en cada una con
un rol:

- **Prioridad**: es "su" zona. Es de los que la cubren de verdad.
- **Tránsito**: pasa por ahí. Puede tomar un pedido si le queda de paso,
  pero no es su zona.

Ejemplo: el móvil M2 es de **prioridad en Centro** y de **tránsito en
Costa**. Vive en Centro; si le queda cómodo, agarra algo de Costa.

En el sistema esto vive en una tabla que dice, para cada par
(móvil, zona, tipo de servicio), si es prioridad o tránsito. Hay un número
configurable llamado **alpha** (hoy `0,3`) que representa "cuánto vale un
móvil de tránsito comparado con uno de prioridad". Un móvil de prioridad
vale 1; uno de tránsito vale 0,3.

### 2.4 Cómo entra el trabajo

Los pedidos entran **online, durante todo el día**. No hay una planificación
de la mañana que después se ejecuta: el día se va armando solo. Por eso la
demora que informamos tiene que recalcularse seguido — hoy, **cada 10
minutos**.

### 2.5 El ejemplo que vamos a usar en todo el documento

Para no hablar en abstracto, inventamos un caso chico y lo seguimos hasta el
final. **Tres zonas, cuatro móviles, las 14:00 de un martes.**

**Quién cubre qué** (tipo URGENTE):

| Móvil | Centro | Costa | Cerro | ¿Activo hoy? |
|---|---|---|---|---|
| **M1** | prioridad | — | — | sí |
| **M2** | prioridad | tránsito | — | sí |
| **M3** | — | prioridad | — | sí |
| **M4** | — | — | prioridad | **no salió** |

**Qué velocidad tiene cada uno** (cuánto tarda entre una entrega y la
siguiente — de dónde sale este número lo vemos en la sección 7):

| Móvil | Minutos por pedido |
|---|---|
| M1 | 20 |
| M2 | 15 |
| M3 | 25 |
| M4 | 20 |

**Qué está pasando a las 14:00:**

| | Centro | Costa | Cerro |
|---|---|---|---|
| Pedidos asignados | 3 (todos a M1) | 1 a M2, 2 a M3 | 1 a M4 |
| Pedidos sin asignar | 2 | 0 | 3 |

El pedido asignado a M4 es un caso especial: **M4 no salió hoy**. Ese pedido
está *atrapado* — tiene móvil, pero ese móvil no existe operativamente. Ver
sección 8.3.

**La pregunta**: entra un pedido nuevo ahora, a las 14:00. ¿Cuánto le
decimos al cliente que va a demorar, en Centro, en Costa y en Cerro?

---

## 3. Qué datos tenemos de verdad

Esta es la materia prima. Todo lo que sigue tiene que salir de acá.

### 3.1 Los pedidos pendientes — tablas `pedidos` y `services`

Una fila por pedido. Lo que importa:

| Dato | Qué dice |
|---|---|
| `estado_nro` | `1` = pendiente. Los cumplidos ya no están en esta cola. |
| `movil` | Qué móvil lo tiene. **`NULL` o `0` = sin asignar.** |
| `zona_nro` | En qué zona cae. |
| `servicio_nombre` | URGENTE / NOCTURNO / etc. |
| `fch_para` | Para qué día es. |
| `fch_hora_para` | Hora máxima comprometida. |

**Esto es lo más valioso que tenemos**: sabemos exactamente qué lleva arriba
cada móvil, en este preciso momento. No hay que estimarlo.

⚠️ **Suciedad conocida**: `fch_para` viene vacío en aproximadamente el **4%**
de los pedidos, aunque `fch_hora_para` sí tenga el dato. Hay que taparlo con
el segundo campo o se pierde ese 4% de la demanda.

### 3.2 Quién cubre qué zona — tabla `moviles_zonas`

Una fila por (móvil, zona, tipo de servicio), con un campo
`prioridad_o_transito` (`1` = prioridad) y un `activa` que dice si la
asignación sigue vigente.

Esto es **configuración**, no realidad del día: dice quién *debería* cubrir
qué, no quién salió.

### 3.3 Quién salió hoy — tabla `moviles_dia`

Una fila por (móvil, día). Lo que importa:

| Dato | Qué dice |
|---|---|
| `activo` | **Si el móvil salió a la calle hoy.** Sí o no, nada más. |
| `tamano_lote` | Cuántos pedidos se le pueden asignar a la vez. |
| `pedidos_pendientes` | Contador de lo que lleva. |
| `last_gps_lat/lng/datetime` | Última posición conocida. |

⚠️ **A las 07:00 el 72% de la flota todavía figura inactiva.** Los móviles se
van activando a lo largo de la mañana. Esto no es un error de datos: es la
realidad, y el modelo la tiene que tolerar.

### 3.4 El histórico de entregas — tabla `metricas_cumplimiento`

**Esta es la tabla más importante para el modelo nuevo.** Un renglón por cada
pedido que se cumplió, y no se borra nunca. Se llena todas las noches a las
00:15.

| Dato | Qué dice |
|---|---|
| `movil`, `chofer`, `zona_nro`, `tipo_servicio` | Quién, dónde, qué |
| `fch_hora_asignado` | Cuándo se le asignó el pedido al móvil |
| **`fch_hora_finalizacion`** | **Cuándo se entregó de verdad** |
| `demora_mins` | `finalización − asignado` |
| `demora_efectiva_mins` | Lo mismo, con un ajuste para pedidos agendados |

Hay del orden de **168.000 entregas** ya registradas. Es la única fuente de
verdad sobre cuánto tarda realmente el trabajo.

⚠️ **El chofer es texto libre** que viene del AS400, sin número de
identificación. El mismo nombre puede aparecer en varios camiones de la misma
fletera tercerizada.

### 3.5 Lo que informa el AS400 hoy — tabla `demoras`

La demora que el sistema viejo está informando ahora mismo, por zona y tipo.
**Se pisa entera en cada importación** — por eso, cada vez que calculamos,
sacamos una foto y la guardamos; si no, no habría con qué comparar después.

### 3.6 Parámetros — tabla `escenario_settings`

- `peso_transito_alpha`: el 0,3 de la sección 2.3.
- `pedidos_sa_minutos_antes`: con cuánta anticipación se "ve" un pedido sin
  asignar. Un pedido sin móvil que arranca mucho más tarde todavía no cuenta
  como demanda.

### 3.7 Resultados propios — `demoras_calculadas` y `demoras_config`

`demoras_calculadas` guarda, cada 10 minutos y por cada (zona, tipo), **el
resultado y todos los insumos que lo produjeron**. La idea es poder contestar
"¿por qué esta zona informó 90 minutos?" seis semanas después.

`demoras_config` es la configuración por (escenario, tipo): mínimos, máximos,
el redondeo, el suavizado, el interruptor de encendido y la ventana horaria.

---

## 4. Qué datos NO tenemos

Tan importante como lo anterior. Nada de lo que sigue existe en el sistema, y
**no vale inventarlo**:

**Horarios de turno.** No sabemos a qué hora entra ni a qué hora sale cada
móvil. Solo tenemos el `activo` sí/no. Un móvil puede activarse a las 8, otro
a las 9, otro a las 13 — y no sabemos cuándo se retiran.

> *Consecuencia buscada:* una zona cubierta por un solo móvil a las 8 va a
> tener una demora altísima; si a las 9 se le suma otro, en la corrida
> siguiente la demora tiene que bajar. Ese movimiento es correcto y el modelo
> lo tiene que reflejar rápido. Ver sección 8.4.

**Cuándo recargan.** Un móvil puede llevar 10 o 12 garrafas físicas, pero el
`tamano_lote` configurado no se corresponde con esa cantidad. **No hay forma
de saber cuándo un móvil vuelve a planta a recargar**, así que el viaje de
recarga no se modela. Cualquier número que pusiéramos ahí sería inventado.

**El orden de entrega.** Sabemos qué pedidos lleva un móvil, pero no en qué
orden los va a hacer.

**Tiempos de viaje.** No hay motor de ruteo detrás de esto. La distancia
entre puntos está implícita en las estadísticas históricas: si una zona es
grande y dispersa, sus entregas históricamente tardaron más, y eso ya queda
capturado.

---

## 5. El problema a resolver

> **Son las 14:00. Entra un pedido nuevo en la zona Centro, tipo URGENTE.
> ¿En cuántos minutos va a tener el cliente la garrafa en la puerta?**

Precisiones que hacen al contrato:

1. **La demora es hasta la entrega**, no hasta que sale el móvil. Es lo que
   se le informa al cliente sobre cuándo tiene el producto en su casa.
2. **Se recalcula cada 10 minutos**, para las ~100 zonas × 3 tipos.
3. **El número informado está acotado**: mínimo 30 minutos, máximo 120
   (ambos configurables), y **redondeado hacia arriba de a 15 minutos**. Al
   cliente se le dice 30, 45, 60, 75, 90, 105 o 120 — nunca 67.
4. **No puede saltar de forma errática.** Si un cliente llama dos veces con
   cinco minutos de diferencia y le dicen 45 y después 120, el número pierde
   credibilidad. Por eso hay un suavizado (sección 6.5).
5. **Hoy no se le informa a nadie.** El motor corre y guarda el resultado
   para compararlo contra el AS400. Antes de mostrárselo a un cliente hay que
   estar convencidos de que la fórmula está bien. Este documento existe para
   eso.

---

## 6. Cómo se calcula hoy, y por qué está mal

### 6.1 La fórmula actual

```
demora  =  ( pedidos pendientes  ÷  capacidad efectiva )  ×  ritmo
```

Con tres ideas detrás:

- **Pendientes**: todos los pedidos pendientes de la zona, asignados y sin
  asignar, sumados.
- **Capacidad efectiva**: cuántos móviles "equivalentes" tiene la zona. Un
  móvil no vale uno: **se reparte entre las zonas que atiende.** Si M2 es
  prioridad en Centro (peso 1) y tránsito en Costa (peso 0,3), su peso total
  es 1,3, y le aporta `1 ÷ 1,3 = 0,77` a Centro y `0,3 ÷ 1,3 = 0,23` a Costa.
  Así un móvil que atiende 4 zonas nunca suma 4 móviles de capacidad.
- **Ritmo**: cuánto tarda un pedido, sacado del histórico.

### 6.2 Corramos el ejemplo

**Zona Centro**, con la fórmula de hoy:

- Pendientes = 3 asignados + 2 sin asignar = **5**
- Capacidad = M1 aporta 1,0 (solo cubre Centro) + M2 aporta 0,77 = **1,77**
- Ritmo = la mediana histórica de la zona. Supongamos **45 minutos**.

```
5  ÷  1,77  ×  45  =  127 minutos   →  se pasa del techo  →  informa 120
```

**Guardá ese 120.** En la sección 7 el modelo nuevo va a dar **60** para la
misma situación. Uno de los dos está muy equivocado.

### 6.3 Error nº 1 — el ritmo mide otra cosa (el más grave)

El "ritmo" que usa la fórmula es `demora_efectiva_mins`, que es
**`hora de entrega − hora de asignación`**.

Eso **no** es "cuánto tarda el móvil en hacer una entrega". Es cuánto tardó
ese pedido desde que se lo dieron al móvil — **y ese tiempo ya incluye toda
la espera detrás de los otros pedidos que el móvil tenía arriba.**

Con números. M1 tiene 3 pedidos y entrega uno cada 20 minutos:

| Pedido | Entrega a los | `demora_efectiva` |
|---|---|---|
| 1º | 20 min | 20 |
| 2º | 40 min | 40 |
| 3º | 60 min | 60 |

La mediana de `demora_efectiva` es **40 minutos**. Pero el móvil no tarda 40
minutos por pedido: **tarda 20**. Los otros 20 son cola.

Ahora la fórmula agarra ese 40 y lo multiplica por la cantidad de pendientes.
Está **contando la cola dos veces**: una vez en el multiplicando (los
pendientes son la cola) y otra vez adentro del multiplicador (el ritmo ya
tiene la cola adentro).

Esto ya estaba anotado como riesgo **R1** en la documentación del motor, con
un "factor de calibración" como parche. No es un problema de calibración: es
la métrica equivocada.

### 6.4 Error nº 2 — el prorrateo castiga dos veces lo que ya está asignado

Repartir un móvil entre sus zonas (0,77 acá, 0,23 allá) es una **suposición**
sobre dónde va a estar. Pero para los pedidos que **ya tienen móvil asignado
no hace falta suponer nada: sabemos dónde está el trabajo.**

Ejemplo mínimo. M2 cubre Centro y Costa. Tiene 4 pedidos, **todos en
Centro**. Costa está vacía.

- Lo que dice la fórmula: Centro tiene 4 pendientes y 0,77 de capacidad →
  `4 ÷ 0,77 = 5,2` vueltas de trabajo.
- Lo que va a pasar: M2 hace sus 4 pedidos en Centro. Son **4** vueltas.

La zona paga un 30% de más porque el modelo le descuenta capacidad "por si
M2 se va a Costa" — pero la razón por la que M2 se iría a Costa serían los
pedidos de Costa, que se cuentan aparte, en el cálculo de Costa. **El mismo
hecho se cobra en los dos lados.**

Sumando todas las zonas el modelo cierra bien (la capacidad total sigue
siendo la cantidad de móviles). El error es de **distribución**: la zona que
concentra la cola de un móvil paga de más, y la que no la concentra paga de
menos.

### 6.5 Error nº 3 — el promedio no es el primero que se libera

La división `pendientes ÷ capacidad` calcula un rendimiento promedio del
conjunto. Pero un pedido nuevo no lo atiende "el promedio de la zona": lo
atiende **el primer móvil que quede libre**.

Tres móviles en una zona: uno se libera en 10 minutos, los otros dos en 90.
La respuesta correcta es **10**. El promedio dice 63. Y no hay manera de
arreglarlo ajustando parámetros: la fórmula no tiene dónde expresar "el
mínimo".

### 6.6 Lo que sí está bien y hay que conservar

No todo se tira. Estas cuatro decisiones son correctas y siguen valiendo:

1. **Techo cuando no hay nadie.** Si la zona no tiene ni un móvil activo, se
   informa el máximo (120), no el mínimo. La respuesta honesta a "¿cuánto
   demora?" cuando no hay quien lo atienda no es "poco".
2. **Piso cuando está todo tranquilo.** Con móviles disponibles y cola vacía,
   se informa el mínimo (30).
3. **Redondeo hacia arriba** al múltiplo de 15. Prometer de menos es peor que
   prometer de más.
4. **Suavizado asimétrico.** Entre una corrida y la siguiente el número puede
   subir hasta 30 minutos pero bajar solo 15. Bajar despacio es a propósito:
   no informar una mejora que todavía no se confirmó.

---

## 7. El modelo propuesto: "el próximo hueco"

La idea, en una frase:

> **Averiguar a qué hora queda libre cada móvil de la zona, hacer la fila con
> los pedidos que ya están esperando, y ver en qué momento le toca al pedido
> nuevo.**

Es la idea correcta y es exactamente la que hay que implementar. Se apoya en
el dato que ya tenemos y no estábamos usando: **sabemos qué lleva arriba cada
móvil, ahora mismo.**

### 7.1 Ingrediente nuevo: el ritmo de entrega de verdad

Antes que nada hay que dejar de usar `demora_efectiva_mins` y calcular la
métrica que realmente falta: **cada cuánto entrega un móvil.**

Se saca así:

```
Para cada móvil, en cada día del histórico:
  1. Ordenar sus entregas por hora de finalización.
  2. Calcular los minutos entre cada entrega y la anterior.
  3. Descartar los huecos muy grandes (almuerzo, recarga, inactividad):
     no son ritmo de trabajo.
  4. La mediana de lo que queda = su ritmo de entrega.
```

Con el ejemplo de la sección 6.3: las entregas de M1 caen a los 20, 40 y 60
minutos. Las diferencias son 20 y 20. **Ritmo = 20 minutos por pedido** — que
es la verdad, contra los 40 que decía la métrica vieja.

Es el mismo "entrega cada 15 minutos" del que se habla en la operación. Hoy
ese número no existe en ninguna parte del sistema; hay que calcularlo.

Se mantiene la **cascada de atribución** que ya existe: se usa el ritmo del
chofer si tiene suficientes entregas registradas; si no, el del móvil; si no,
el de la zona; si no, el global. Lo único que cambia es **qué se mide**, no
cómo se elige el nivel.

⚠️ **Decisión pendiente** sobre el paso 3: ¿cuál es el corte para "hueco muy
grande"? Un corte de 90 minutos es un punto de partida razonable, pero hay
que mirarlo contra los datos reales antes de fijarlo. Un corte alto mete
tiempo ocioso adentro del ritmo; uno bajo se queda solo con las rachas
rápidas y subestima.

### 7.2 El cálculo, paso a paso

**Paso 1 — ¿A qué hora queda libre cada móvil?**

Para cada móvil **activo** que cubre la zona:

```
libre_en(móvil)  =  (pedidos pendientes que tiene asignados)  ×  su ritmo
```

Los pedidos se cuentan **de todas las zonas**, no solo de esta: el móvil es
un solo camión, y si tiene trabajo en otro lado, ese trabajo también lo
ocupa. *Este es el punto exacto donde muere el doble castigo de la sección
6.4:* no hay que repartir al móvil entre zonas, porque ya sabemos dónde está
su trabajo.

**Paso 2 — Poner en fila lo que ya está esperando.**

Los pedidos **sin asignar** de la zona van a despacharse antes que el nuevo.
Uno por uno, cada uno se le da al móvil que quede libre primero, y a ese
móvil se le corre el reloj su propio ritmo.

**Paso 3 — Ubicar el pedido nuevo.**

Cuando se terminó de repartir la fila, el pedido nuevo va al móvil que quede
libre primero:

```
demora  =  (cuánto falta para que ese móvil se libere)  +  (su ritmo)
```

El segundo término es su propia entrega: el cliente tiene la garrafa cuando
el móvil se la lleva, no cuando el móvil arranca.

**Paso 4 — Terminación.** Sobre ese número se aplica lo que ya funciona
(sección 6.6): techo/piso, redondeo hacia arriba de a 15, y suavizado contra
la corrida anterior.

### 7.3 El ejemplo, resuelto

#### Zona Centro

Móviles: M1 (3 pedidos, ritmo 20) y M2 (1 pedido, ritmo 15). Sin asignar: 2.

**Paso 1 — cuándo se libera cada uno:**

| Móvil | Cuenta | Libre en |
|---|---|---|
| M1 | 3 × 20 | **60 min** |
| M2 | 1 × 15 | **15 min** |

**Paso 2 — repartir los 2 sin asignar:**

| | Va a | Porque | M1 queda | M2 queda |
|---|---|---|---|---|
| *inicio* | | | 60 | 15 |
| Sin asignar nº 1 | **M2** | se libera antes (15 < 60) | 60 | 15+15 = **30** |
| Sin asignar nº 2 | **M2** | sigue siendo el primero (30 < 60) | 60 | 30+15 = **45** |

**Paso 3 — el pedido nuevo:**

El primero en liberarse es M2, a los **45 minutos**. Lo entrega en **15** más.

```
demora  =  45 + 15  =  60 minutos
```

**Paso 4:** 60 está entre 30 y 120, y ya es múltiplo de 15. **Se informa 60.**

> **Contra los 120 del modelo viejo.** La diferencia se reparte así:
> el ritmo inflado (45 en vez de 15–20) es la mitad del error; el prorrateo
> que le sacaba capacidad a M2 es otra parte; y el promedio, que no veía que
> M2 estaba casi libre, es el resto.

#### Zona Costa

Móviles: M3 (2 pedidos, ritmo 25) y M2 **de tránsito** (1 pedido, ritmo 15).
Sin asignar: 0.

| Móvil | Cuenta | Libre en |
|---|---|---|
| M3 | 2 × 25 | 50 min |
| M2 | 1 × 15 | **15 min** |

No hay cola por delante. El pedido nuevo va a M2, libre en 15, más 15 de
entrega = **30 minutos**. Justo el piso. **Se informa 30.**

⚠️ Acá aparece una decisión pendiente: **¿un móvil de tránsito cuenta igual
que uno de prioridad?** El cálculo de arriba lo trata como si Costa fuera su
zona, y no lo es — M2 vive en Centro. Ver sección 8.1.

#### Zona Cerro

M4 es el único móvil, y **no salió hoy**. La zona tiene 3 pedidos sin asignar
y 1 atrapado con M4.

No hay ningún móvil activo → no hay a quién darle el pedido nuevo → **se
informa el techo, 120 minutos** (sección 6.6, punto 1).

Estas filas se marcan con una bandera *sin capacidad*, y **quedan afuera de
cualquier comparación contra el AS400**: ese 120 no salió de un cálculo, salió
de una definición. Promediarlo con los demás ensucia la calibración, y a las
07:00 —con el 72% de la flota sin activar— serían la mayoría.

#### Y cuando llega refuerzo

Supongamos que a las 09:00 se activa un segundo móvil en una zona que venía
en 120. La demora calculada cae de golpe. Eso es correcto y el modelo lo
capta solo, sin ninguna configuración especial: apareció un móvil con
`libre_en = 0`.

Pero el **suavizado** de la sección 6.6 solo deja bajar 15 minutos por
corrida. Para pasar de 120 a 45 harían falta 5 corridas, o sea **50 minutos
informando de más** cuando el refuerzo ya está en la calle. Ver sección 8.4.

### 7.4 Por qué no hace falta un flag de "modo de carga"

Hoy los móviles tienen un lote configurado. El sistema de ruteo nuevo va a
trabajar distinto: **un pedido en curso más uno a la vista**, dos asignados y
nada más. La pregunta natural es si el modelo necesita saber en cuál de los
dos mundos está.

**No lo necesita, y conviene no agregar la perilla.** El modelo no pregunta
cuántos pedidos *puede* tener un móvil: mira cuántos *tiene*. Si hoy le
asignan 6, ve 6; cuando el ruteo nuevo le asigne 2, va a ver 2. Se adapta
solo el día que cambie, sin que nadie se acuerde de tocar la configuración.

Verificado con el caso donde más debería notarse — una zona con 6 pedidos,
dos móviles de ritmo 15:

| | Cómo está repartido | Libre en | Demora del pedido nuevo |
|---|---|---|---|
| **Con lote** | M_A tiene los 6, M_B ninguno | A: 90, B: **0** | 0 + 15 = **15 min** |
| **1 + 1 a la vista** | 2 y 2 asignados, 2 sin asignar | A: 30, B: 30 → tras repartir: 45 y 45 | 45 + 15 = **60 min** |

Los resultados son muy distintos, pero **las dos respuestas son correctas**,
porque los dos mundos son distintos de verdad: en el primero hay un móvil
parado sin nada que hacer y el pedido nuevo se lo lleva enseguida; en el
segundo el trabajo está repartido y hay que hacer la fila. El modelo no
necesita que le expliquen en cuál está — lo ve.

> El único caso donde haría falta el flag es si quisiéramos **simular** cómo
> se comportaría una política de asignación que todavía no existe. Eso es
> otro problema (planificación), no éste (informarle al cliente qué va a
> pasar con la realidad de ahora).

Lo que sí conviene es dejar el modelo escrito de forma que **no asuma** en
ningún lado un tope de pedidos por móvil.

---

## 8. Las decisiones que hay que tomar

Lo que sigue no está resuelto. Cada punto cambia el resultado.

### 8.1 ¿Cuánto vale un móvil de tránsito? — **abierta**

En el ejemplo de Costa, M2 aparece como el móvil más rápido en liberarse, y
el cálculo le da el pedido nuevo. Pero M2 es de tránsito ahí: su zona es
Centro. Que esté libre no significa que lo vayan a mandar a Costa.

Opciones:

| Opción | Cómo funciona | Riesgo |
|---|---|---|
| **A. Igual que prioridad** | El tránsito compite igual. Es lo que hace el cálculo de arriba. | Demoras optimistas: promete un móvil que quizá no va. |
| **B. Con castigo de tiempo** | Al `libre_en` de un tránsito se le suman N minutos (el desvío). | Hay que elegir N sin datos que lo respalden. |
| **C. Solo si no hay otro** | El tránsito entra únicamente si ningún móvil de prioridad se libera antes de cierto margen. | Más fiel a la operación, algo más complejo. |
| **D. Ponderado por alpha** | Su `libre_en` se estira dividiéndolo por 0,3. | Reusa el parámetro que ya existe, pero alpha se diseñó para repartir capacidad, no para estirar tiempos. |

**Sugerencia**: arrancar con **C**, que es lo que uno esperaría de la
operación real, y comparar contra **A** en el backtest.

### 8.2 ¿Cómo se reparten los sin asignar entre zonas que comparten móvil? — **abierta**

En el ejemplo, los 2 sin asignar de Centro compiten por M1 y M2. Pero si
Costa también tuviera sin asignar, esos **también** competirían por M2 — y el
cálculo de Centro los está ignorando.

Opciones: ignorarlos (optimista, es lo que hace el cálculo de arriba);
meterlos todos en la misma fila (pesimista, asume que todos van al mismo
móvil); o meterlos ponderados por la probabilidad de que ese móvil los tome.

**Sugerencia**: empezar ignorándolos y medir cuánto se pierde. Puede que en
la práctica sea chico y no valga la complejidad.

### 8.3 Pedidos atrapados — **RESUELTO: se excluyen**

Un pedido asignado a un móvil que hoy no salió (el de M4 en Cerro).

**Decisión tomada: se excluyen del cálculo.** No suman a la cola de la zona,
porque nadie los va a entregar con la asignación que tienen. Se siguen
contando aparte para poder auditarlos, pero no empujan la demora.

### 8.4 El suavizado contra los cambios de capacidad — **abierta**

Como vimos en 7.3, cuando entra un móvil nuevo la baja es real, pero el
suavizado la frena 50 minutos.

Opciones: dejarlo como está; o **saltear el suavizado cuando cambia la
cantidad de móviles activos** de la zona, distinguiendo un cambio estructural
(entró o salió un móvil) del ruido corrida a corrida.

**Sugerencia**: la segunda. El suavizado existe para que el número no
tiemble, no para tapar un cambio real en la calle.

### 8.5 El corte de los huecos en el ritmo — **abierta**

Ver 7.1. Hay que mirar la distribución real de los tiempos entre entregas
antes de fijar el número.

Hay además un refinamiento posible: contar solamente los intervalos en los
que el móvil **tenía otro pedido esperando**. Si no tenía nada, ese tiempo es
ocio, no ritmo. Se puede aproximar con los datos que hay, a costa de más
complejidad.

### 8.6 Turnos — **RESUELTO: se ignoran**

No sabemos a qué hora entra ni sale cada móvil, y no hay de dónde sacarlo.
El modelo trata a todo móvil activo como disponible.

Consecuencia asumida: cerca del cierre, la demora va a salir optimista para
los móviles que ya se están retirando. Si algún día aparece el dato de
horarios, es el primer lugar donde conviene usarlo.

### 8.7 Recarga en planta — **RESUELTO: no se modela**

El `tamano_lote` configurado no se corresponde con las garrafas que llevan
físicamente arriba (pueden ser 10 o 12), así que no hay forma de saber cuándo
un móvil vuelve a cargar. No se modela.

Consecuencia asumida: el modelo subestima el tiempo de los móviles que están
por quedarse sin producto. Queda absorbido en el ritmo histórico, que ya
incluye los viajes de recarga que hubo en los días medidos.

---

## 9. Cómo saber si la fórmula sirve

Acá hay un cambio de criterio importante respecto del plan original.

### 9.1 El AS400 no es la verdad

El plan actual compara nuestro número contra el que informa el AS400 y ajusta
hasta que se parezcan. **Eso mide si nos parecemos al AS400, no si acertamos.**
El AS400 es otra estimación, hecha con otro criterio que no conocemos, y no
hay ninguna razón para suponer que está bien.

Sirve como referencia y para detectar diferencias groseras, pero no como
objetivo.

### 9.2 La verdad la tenemos: el backtest

Tenemos 168.000 entregas reales con su hora exacta. Se puede reconstruir el
pasado y ver si la fórmula habría acertado:

```
Para un pedido real que entró el martes a las 14:20 en la zona Centro:
  1. Reconstruir el estado del sistema en ese momento
     (qué móviles estaban activos, qué llevaba cada uno,
      qué había sin asignar).
  2. Correr la fórmula con ese estado.
  3. Comparar contra lo que ese pedido tardó de verdad.
```

Repitiéndolo sobre miles de pedidos salen las respuestas que importan:

- **¿Le pega en promedio?** Si informamos sistemáticamente 20 minutos de más,
  hay un sesgo que corregir.
- **¿Le pega en los casos malos?** Es peor prometer 45 y tardar 120 que
  prometer 120 y tardar 90. Conviene mirar el percentil 90 del error, no solo
  el promedio.
- **¿Con qué frecuencia nos quedamos cortos?** Es el error que el cliente
  siente. Puede convenir apuntar deliberadamente por encima.
- **¿Qué opción gana?** El backtest es lo que resuelve las decisiones abiertas
  de la sección 8: en vez de discutir si el tránsito cuenta igual, se corren
  las dos y gana la que acierta.

### 9.3 Requisito para poder hacerlo

Para reconstruir el estado de un momento pasado hace falta que el estado
quede grabado. `demoras_calculadas` ya guarda los insumos de cada corrida,
que es la mitad del camino. Falta poder saber **qué tenía asignado cada móvil
en un momento dado** — hoy solo se guarda el total por zona, no el detalle por
móvil. **Es una pieza a agregar**, y conviene agregarla antes de empezar a
calibrar.

---

## 10. Resumen para el apurado

| | Modelo de hoy | Modelo propuesto |
|---|---|---|
| **Idea** | Pendientes dividido capacidad, por el ritmo | A qué hora se libera cada móvil, hacer la fila |
| **Ritmo** | Asignación → entrega (incluye la cola) | Entre una entrega y la siguiente (**a construir**) |
| **Móvil en varias zonas** | Se reparte con una suposición | Se mira dónde tiene el trabajo de verdad |
| **Quién atiende** | El promedio de la zona | El primero que se libera |
| **Ejemplo de Centro** | 120 minutos | 60 minutos |
| **Se valida contra** | El número del AS400 | Las entregas que ocurrieron de verdad |

**Lo que hay que construir, en orden:**

1. El ritmo de entrega real (diferencia entre entregas consecutivas).
2. El cálculo del próximo hueco.
3. Guardar la carga por móvil, para poder hacer el backtest.
4. El backtest, que es lo que va a cerrar las decisiones abiertas.

**Lo que se conserva tal cual:** techo, piso, redondeo de a 15, suavizado (con
la salvedad de 8.4), la ventana horaria por tipo, el interruptor por tipo, y
que el resultado **no se le informa a ningún cliente** hasta que el backtest
diga que la fórmula sirve.
