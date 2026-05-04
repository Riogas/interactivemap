# Feature Request

Proyecto: trackmovil (Documents/Projects/trackmovil)

## Requerimientos (3 cambios relacionados al panel modal de estadística por zona y tarjeta/tabla de pedidos)

### 1) Bug en indicador "Pedidos totales entregados" (panel modal de estadística por zona)

El indicador de **pedidos totales entregados** está sumando mal. Debería contar los pedidos que cumplan:
- `estado_nro = 2` **Y**
- `sub_estado_nro IN (3, 19)` (los dos sub-estados que se consideran entregados)

Revisar la lógica actual y corregirla si está mal.

### 2) Card de pedidos — agregar 2 datos cuando el pedido está en estado "Entregado"

En la **card individual de pedidos**, cuando el pedido tenga estado **"Entregado"**, agregar 2 campos adicionales:

- **Fecha de Cumplido** → campo JSON `FchHoraCump`
- **Atraso** → campo JSON `AtrasoCumpMins` (**SOLO** si el pedido tiene **móvil asignado**)

Notas:
- El atraso ya viene precalculado como `FechaHoraCump - FechaHoraMaxEntregaComprometidaCliente`. Si el pedido se entrega/cancela 1 minuto antes del límite, `AtrasoCumpMins` queda en 0 (no es negativo, ya está manejado upstream).
- Si **no** tiene móvil asignado, NO mostrar el atraso (solo la fecha de cumplido).

### 3) Tabla extendida de pedidos — agregar los mismos 2 campos para todos los pedidos finalizados

En la **tabla extendida** (vista expandida de pedidos), agregar las mismas 2 columnas:
- Fecha de Cumplido (`FchHoraCump`)
- Atraso (`AtrasoCumpMins`)

A diferencia de la card, en la tabla deben mostrarse para **todos los pedidos finalizados** (no solo entregados con móvil — es decir, también cancelados, etc., siempre que tengan los campos).

## A verificar

- Dónde está calculado el indicador "pedidos totales entregados" en el panel de estadísticas por zona (probablemente componente/hook/endpoint).
- Cómo se renderiza la card de pedido y la tabla extendida actualmente, qué campos JSON ya están disponibles.
- Que el cambio del indicador no rompa otros KPIs del mismo modal.
- Que los 2 campos nuevos solo se muestren cuando aplique (no aparezcan vacíos para pedidos no finalizados).
- Formato de fecha consistente con el resto de la UI.
