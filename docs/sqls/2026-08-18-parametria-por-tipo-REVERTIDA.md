# Parametría por tipo de servicio — INTENTO REVERTIDO (2026-08-18)

**No apliques `2026-08-18-parametria-por-tipo.sql`. Tira el motor abajo.**
Ese archivo se borró del repo por eso; queda esta nota para que el próximo
intento no repita el error.

## Qué pasó

Diego pidió abrir la parametría por escenario **y tipo de servicio**, para
poder calibrar el nocturno aparte del urgente. Lo implementé como:

1. `demoras_modelo` → PK `(escenario_id, tipo_servicio)`.
2. Clonar la fila de URGENTE en NOCTURNO y SERVICE, idénticas.
3. Dos líneas en `demoras_calcular_run`: el `ORDER BY` del loop y un
   `AND dc.tipo_servicio = m.tipo_servicio` en la CTE `cfg`.

Verifiqué que la corrida siguiente publicaba lo mismo de siempre (99 URGENTE
+ 95 SERVICE) y di el cambio por bueno.

**Doce minutos después el motor se cayó**: la corrida de las 10:10 murió con

```
ERROR: more than one row returned by a subquery used as an expression
CONTEXT: PL/pgSQL function demoras_consumo_tramos(...)
```

## Por qué

Asumí que `demoras_modelo` se leía únicamente desde el orquestador. **La leen
dieciséis funciones**, y varias lo hacen con subconsulta ESCALAR del estilo
`(SELECT factor_calibracion FROM demoras_modelo WHERE escenario_id = p_escenario)`,
que con más de una fila revienta con SQLSTATE 21000:

```
demoras_aportes            demoras_aportes_lab        demoras_calcular_run
demoras_cola               demoras_consumo_tramos     demoras_consumo_tramos_lab
demoras_corrida_backfill   demoras_corrida_ritmo_dia  demoras_corrida_snapshot
demoras_modelo_versionar   demoras_proximo_hueco      demoras_ritmo
demoras_ritmo_movil        demoras_ritmo_niveles      demoras_ritmo_zona_lab
demoras_servidores
```

La corrida de las 10:00 anduvo porque el motor ya la había calculado antes de
que yo aplicara el cambio: **mi "verificación" miró una corrida vieja**. La
primera corrida realmente posterior al cambio fue la que falló.

## Reversión

`DELETE FROM demoras_modelo WHERE tipo_servicio <> 'URGENTE'` + restaurar
`demoras_calcular_run` a la versión previa. Motor confirmado arriba a las
10:12 con sus 194 filas (99 URGENTE + 95 SERVICE). **Se perdió una sola
corrida, la de las 10:10.**

Quedan aplicadas y son inocuas con una sola fila:
- La columna `tipo_servicio` en `demoras_modelo` y en `demoras_modelo_historial`.
- Las claves `(escenario_id, tipo_servicio)` y `(escenario_id, tipo_servicio, version)`.
- La alarma de divergencia en `demoras_corrida_snapshot`.

El laboratorio nocturno (`2026-08-18-laboratorio-nocturno.sql`) es
independiente, no toca la forma de `demoras_modelo` y **sigue vigente**.

## Cómo hacerlo bien la próxima vez

1. Recorrer las dieciséis funciones y cambiar cada lectura de
   `demoras_modelo` para que filtre por el tipo que está calculando. Varias
   reciben el tipo por parámetro; otras no y hay que agregárselo, lo que
   arrastra a sus llamadores.
2. Recién después clonar las filas.
3. `demoras_corrida_meta` guarda **un modelo por corrida**: mientras los tipos
   sean idénticos da igual, pero antes de calibrar el nocturno hay que
   migrarla a `(corrida, escenario, tipo)` y que `demoras_simular_corrida` la
   lea así. Si no, el laboratorio de nocturno mediría contra la parametría de
   urgente sin avisar.
4. **Verificar sobre una corrida POSTERIOR al cambio**, no sobre la última que
   quedó en la tabla. El chequeo correcto es forzar `demoras_calcular_run()` a
   mano y mirar que devuelva filas, o esperar el siguiente múltiplo de 10.

## La lección

El cambio parecía de dos líneas porque miré una sola función. Antes de tocar
la forma de una tabla que está en el centro de un motor, la pregunta no es
"¿quién la escribe?" sino **"¿quién la lee, y asumiendo qué?"** —
`SELECT proname FROM pg_proc WHERE prosrc ILIKE '%tabla%'` cuesta cinco
segundos y habría mostrado las dieciséis.
