# Ritmo sin ocio: la perilla de la sobrestimación de mediodía

**Fecha**: 2026-08-05 · **Estado**: ACTIVADA en prod (demoras_modelo v8,
`ritmo_solo_con_cola = true`, 15:15 UY). Sin cambios de código: la
perilla existía implementada desde la tanda TRAMOS y estaba apagada.

## El problema (diagnóstico automático del 4/8)

De los 793 pedidos donde solo el Despacho acertó (≤25′), 595 (75%)
fueron "el modelo pidió DE MÁS" — no publicación, no arranque. El
contrafáctico de la cruda (56,3% vs Despacho 73,1%) confirmó: faltaba
modelo.

## La perforación (por qué sobrestima)

Sobre la común del 4/8, filas de modelo normal (sin arranque, con
móviles), mediana de `real / cruda`:

- **Por cola**: cola 0 → **0,94** (el modelo clava); cola 0-1 → 0,70;
  cola 1-3 → 0,61; cola 3+ → 0,60. La sobrestimación vive en el término
  de la cola.
- **Por ritmo usado**: <20′ → 0,80; 20-35′ → 0,66; >35′ → **0,41**
  (75% de sobrestimación grave). Cuanto más largo el ritmo asumido,
  peor el error.
- Global: 0,76.

Hipótesis: el ritmo ENTRE_ENTREGAS medía TODOS los intervalos entre
cierres, incluidos los de ocio (el móvil sin pedido siguiente asignado).
Ese ocio infla el ritmo, y el ritmo inflado multiplica la cola.

## La verificación (entregas reales 28/7–4/8, 13.271 intervalos)

Mediana de todos los intervalos: **12,6′**. Mediana solo-con-cola (el
próximo pedido ya asignado al cerrar el anterior — la misma condición
que implementa `demoras_ritmo_muestras` con `p_solo_con_cola`): **9,6′**
→ **s = 0,763**, calcado al ratio global real/cruda (0,76). La
hipótesis cierra. Muestra con cola: 8.539 intervalos (64%) — alcanza
para la cascada (min 5 por nivel).

## El retro (aproximación cruda × k, escala ~lineal con el ritmo)

| ≤25′ común        | 3/8   | 4/8   |
|-------------------|-------|-------|
| Motor publicado   | 46,2% | 51,3% |
| cruda × 1         | 49,5% | 55,6% |
| cruda × 0,85      | 56,1% | 62,4% |
| **cruda × 0,763** | **62,7%** | **65,6%** |
| cruda × 0,70      | 66,8% | 68,5% |
| Despacho          | 75,6% | 73,1% |

Se activó la perilla del MECANISMO (s medido = 0,763), no un factor de
calibración a ojo: k=0,70 daba un par de puntos más en el retro pero ya
es dial-fitting más allá de la física medida. `factor_calibracion` queda
en 1 a propósito — un cambio por vez, y el efecto real se mide en la
card de Acierto desde el 6/8.

## Lo que queda (el gap restante ~8-10 pts vs Despacho)

Con cola grande el ratio sigue en ~0,60 aún después del ajuste
implícito: la cola real se drena más rápido que la simulación incluso
con ritmo de apuro. Sospechosos para la próxima perforación: capacidad
subestimada (refuerzos que llegan DURANTE la simulación y no se
modelan; dedicación de tránsito corta) y cancelaciones/reasignaciones
que achican la cola. Medir antes de tocar.
