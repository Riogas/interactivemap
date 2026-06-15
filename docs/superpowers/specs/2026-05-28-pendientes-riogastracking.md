# Pendientes RiogasTracking — Spec consolidada

**Fecha:** 2026-05-28
**Autor:** dmedaglia + Claude (sintetizado desde `PendientesARevisarRiogasTracking.docx`)
**Estado:** Backlog priorizado — pendiente brainstorming individual por bloque mayor antes de plan de implementación.

---

## 0. Contexto

Lista consolidada de pendientes detectados durante la verificación post-deploy del refactor `moviles_dia` y otros temas acumulados de RiogasTracking. Algunos son bugs claros del refactor reciente; otros son features nuevas o cambios estructurales. Se agrupan por área para poder atacarlos en oleadas coherentes.

**Leyenda:**
- **Prio:** P0 (bloquea uso) · P1 (importante) · P2 (mejora)
- **Compl:** S (1-2h) · M (medio día) · L (1-2 días) · XL (semana+)
- **Dep:** dependencias o pre-requisitos

---

## 1. Bugs del refactor `moviles_dia` (post-deploy)

### 1.1 — Lote en card del móvil no suma `services_pendientes` ⚠️ P0 · S
**Síntoma:** En el header del card del móvil (colapsable) el valor "ocupado del lote" solo muestra `pedidos_pendientes`. En la tabla `moviles_dia` está bien guardado (4 services pendientes para el caso de ejemplo), pero el render del lote no los suma.

**Fix:** en `MovilSelector.tsx` (USE_NEW), el header del card debe mostrar `(pedidos_pendientes + services_pendientes) / tamano_lote`. Verificar también `MovilInfoCard.tsx` y cualquier otra UI que muestre "X/Y" del lote.

**AC:** Si un móvil tiene 2 pedidos pendientes + 4 services pendientes y `tamano_lote=10`, el header dice `6/10`.

---

### 1.2 — "Ver recorrido" se cierra solo a los segundos ⚠️ P0 · M
**Síntoma:** Al abrir "Ver recorrido", se abre la ventana para elegir 2do móvil y dar play, pero la ventana se cierra sola en pocos segundos. Hay algo ejecutándose de fondo que rompe el modal.

**Sospechas:**
- Un effect que dispara `closeModal()` cuando alguna dep cambia (posiblemente `moviles` se refresca por realtime/polling y el modal pierde su estado).
- Conflicto entre la nueva fuente de datos y el cleanup del `TrackingModal` / `RouteAnimationControl`.

**Tareas:**
- Reproducir + agregar `console.log` en el `useEffect` cleanup del modal.
- Estabilizar refs / dependencias.
- Verificar que el listado del 2do móvil (para comparar recorridos) carga bien después del fix.
- Test tanto hoy como fecha anterior (donde deben aparecer todos los inactivos).

**AC:** Se puede abrir el modal, elegir 1ro y 2do móvil, presionar play y la animación corre sin cierres espontáneos.

---

### 1.3 — Tabla extendida muestra móviles inactivos incorrectos ⚠️ P0 · S
**Síntoma:** El combo de móviles en la tabla extendida (`PedidosTableModal` / `ServicesTableModal`) muestra inactivos que NO son los mismos de la barra lateral (i.e., no trabajaron ese día).

**Fix:** mismo criterio que la barra lateral § 4.3 — los inactivos del combo deben filtrarse por `inactivoDelDia === true`, no por `!activo`. El batch del 7553974 / 214c39e parece haber quedado con un filtro distinto. Verificar contra `activosNuevo + inactivosNuevo` del MovilSelector y unificar el origen.

**AC:** Lista del combo en la tabla extendida = lista del colapsable (mismo set, mismo orden).

---

### 1.4 — Capa "Capacidad de Entrega" hace mal los cálculos · P1 · M
**Síntoma:** La capa de cap. de entrega del mapa muestra valores incorrectos.

**Tareas:**
- Reproducir con un caso concreto (zona, datos esperados vs. mostrados).
- Trazar el flujo `SaturacionZonasLayer.tsx` ↔ `cap_entrega` (vista SQL `vw-zona-capacidad-v2`) ↔ `vw-zona-capacidad`.
- Validar contra el SQL real qué números deberían dar.

**AC:** Para una zona dada, el número de la capa coincide con `SELECT * FROM vw_zona_capacidad WHERE zona_id=X` ejecutado manualmente.

---

### 1.5 — Login con usuario demo asigna rol incorrecto · P1 · S
**Síntoma:** Al loguearse con el usuario demo, el sistema le asigna un rol que no corresponde.

**Tareas:**
- Inspeccionar la lógica de asignación de roles en login (probablemente vinculada al mapeo SGM — ver §3.1 abajo).
- Si el demo no está en SGM, la lógica de fallback no debería disparar el mapeo de grupos.

**AC:** El usuario demo entra con el rol esperado (definir cuál con el usuario).

---

## 2. UI / Mapa

### 2.1 — Agregar nombre a las zonas · P2 · S
Mostrar el nombre de la zona como label en el mapa (probablemente en la capa `ZonasMapLayer` o `DistribucionZonasLayer`).

**AC:** Cada zona dibujada muestra su nombre de forma legible al zoom razonable. Opción de toggle si el usuario quiere ocultarlos.

---

### 2.2 — Cambiar color "X" a azul oscuro · P2 · S
**Acción:** cambiar un color específico (a confirmar con captura del doc — ítem 5.a) por azul oscuro, tanto en la imagen referenciada, como en cómo se ven en la barra lateral y en el mapa.

**Pendiente:** identificar qué elemento concreto cambia de color (los pedidos/services de un tipo, una capa específica, el dot de un estado).

---

### 2.3 — Etiquetas de pedidos/services en mapa · P2 · S
- **Sacar** el nombre de familia.
- **Agregar** nro de teléfono.
- **Agregar** tipo de servicio.

**Archivos:** popups en `PedidoInfoPopup.tsx` / `ServiceInfoPopup.tsx` o label tooltip.

---

### 2.4 — URGENTE y NOCTURNO suman prioridad + tránsito · P1 · S
**Bug actual:** la capa "Móviles/Zonas" para servicio URGENTE (y probablemente NOCTURNO cuando cambia el horario) cuenta solo prioridad; si un móvil tiene tránsito pero no prioridad, debería sumar igual.

**Fix:** en `MovilesZonasLayer.tsx`, para URGENTE/NOCTURNO sumar `prioridad + tránsito`. Para los demás tipos, mantener el conteo separado.

**AC:** zona con 1 móvil tránsito + 0 prioridad → la capa URGENTE muestra 1, no 0.

**Pendiente discusión:** cómo tratar el caso "0 / X" en la capa de abajo (capacidad de entrega o similar) — definir con usuario.

---

### 2.5 — Horario diurno/nocturno: redibujado dinámico de zonas (Rotunar style) · P1 · L
**Caso:** distribuidores como Rotunar tienen zonas distintas en diurno vs nocturno; en la noche cubren más zonas. La idea: al loguearse, dibujar zonas según el horario del día. Cada vez que se ejecuta el timer de demoras, verificar si toca cambiar (de diurno a nocturno o viceversa) y redibujar con las nuevas zonas (aplicando lógica de zonas-sin-móvil, etc.). Solo aplica a distribuidores que cubren nocturno; el resto siempre ve la capa diurna.

**Tareas:**
- En el modelo de zonas/escenarios, definir si una zona pertenece a diurno, nocturno o ambos.
- Tarea de timer que detecta cambio de franja y redibuja.
- Mantener la lógica de "zonas sin móvil" coherente en cada redibujado.

**AC:** Usuario de Rotunar entra a las 21:00 → ve zonas del nocturno. A las 06:00 (timer detecta cambio) → redibuja con zonas del diurno.

---

## 3. Auth / Roles / Sincro SGM

### 3.1 — Mapeo grupos SGM → roles (extender) · P1 · M
**Hoy:** los usuarios de despacho del grupo 52 ya se setean a `root`.

**Agregar:**
- Grupo 1 (GSistemas) → `root`
- Grupo 185 o 56 → `Riogas_Supervisor`
- Grupo 422 → `Riogas_Dashboards`

**Tareas:**
- Documentar el cuadro completo de grupos → roles (vs. los que ya están).
- Modificar la lógica de mapeo en el endpoint/función de sincro de roles.

**AC:** un usuario nuevo del grupo 1 que se loguea queda con rol root automáticamente.

---

### 3.2 — Sincro inteligente con SGM · P1 · L
**Hoy:** la sincro probablemente es manual o full.

**Cambio:** detectar automáticamente cuando:
- Se crea un usuario nuevo → sincronizar.
- Cambia algún dato clave del usuario en SGM: `estado`, `escenario`, `agencia`, `EFL` → sincronizar.

**Tareas:**
- Investigar cómo SGM expone cambios (eventos? polling con timestamp?).
- Definir estrategia (webhook, polling delta, etc.) en función de lo disponible.
- Implementar y testear.

**AC:** crear usuario en SGM → en N segundos aparece en TrackMovil con los datos correctos.

---

## 4. Recorridos

### 4.1 — Recorridos: filtros + retención por perfil · P1 · M
**Cambios:**
- La pantalla de recorridos debe cargar móviles con coords del día seleccionado **OR** pedidos/services del día — **filtrados por las EFL seleccionadas**.
- Si la fecha es hoy → mostrar estado actual del móvil. Si es anterior → mantener el criterio actual o mostrar todos como inactivos (decidir uno y documentar).
- **Antigüedad máxima** seleccionable: la fecha más vieja a consultar viene del perfil del usuario; si tiene varios perfiles, tomar la antigüedad mayor; si no tiene, solo el día actual.

**Archivos:** `RouteAnimationControl.tsx`, `TrackingModal.tsx`, lógica del date picker.

**AC:** un usuario con perfil de antigüedad 30 días puede seleccionar hasta 30 días atrás; un usuario sin antigüedad solo puede seleccionar hoy.

---

## 5. Centro estadístico / Preferencias

### 5.1 — Mover preferencias a Preferencias Globales + refrescos inteligentes · P1 · M
**Cambios:**
- Mover algunas preferencias (a confirmar cuáles — del centro estadístico al modal `PreferenciasGlobalesModal`).
- **Refrescos inteligentes** de demoras + móviles asociados a zonas: solo se ejecutan si hubo cambios en la API (estrategia: guardar el último DT de sincronización y comparar contra el actual).

**Tareas:**
- Endpoint `last_sync_dt` por dominio (demoras, moviles_zonas, etc.).
- En el cliente, antes de refetch, consultar el DT y ejecutar solo si difiere.

**AC:** si no hay cambios desde el último refresh, no se ejecuta el fetch pesado.

---

### 5.2 — Centro estadístico: tiempo de refresh y tabs · P2 · S
**Cambios:**
- Tiempo de refresh: mínimo permitido = **1 minuto**. Incrementos de 1 min hasta 30 min. **Quitar el 60** que está al lado.
- Mostrar los tabs en función de las **3 nuevas funcionalidades** existentes (`Estadist.Global x Zona/Móvil/EFL`).

**AC:** el dropdown del refresh va de 1, 2, 3, …, 30 (sin opción 60). Los tabs aparecen/desaparecen según las funcionalidades habilitadas.

---

### 5.3 — Contador "Cant Móviles" · P2 · S
Agregar un contador de cantidad de móviles (lugar a confirmar — probablemente en algún panel general o en el centro estadístico).

---

## 6. Nuevas funcionalidades (action gating)

### 6.1 — Crear 10 nuevas funcionalidades para el sistema de permisos · P1 · L
Las 10 nuevas funcionalidades para que el sistema tenga en cuenta al mostrar acciones:

1. Query Incidentes
2. Conf. Globales x Escenario *(renombrar el botón "Configuración" a este nombre)*
3. Preferencias Globales
4. Query Logs / Auditoría
5. Query Inicios de Sesión *(renombrar el botón "Bloqueos de Login" a este nombre)*
6. Notificación de Novedades
7. Mantenimiento P.Interés
8. Estadist. Global x Zona
9. Estadist. Global x Móvil
10. Estadist. Global x EFL

**Tareas:**
- Insertar las 10 funcionalidades en la tabla de funcionalidades (con código + nombre + descripción).
- Asociarlas a los roles correspondientes (root, supervisor, dashboards, etc.).
- En el front, gatear los botones/menus por la funcionalidad correspondiente.
- Renombrar los 2 botones existentes.

**AC:** un usuario sin la funcionalidad X no ve el botón/menu de X.

---

## 7. Estadísticas

### 7.1 — Gráfico de atrasos en entregados (móvil/zona/empresa) · P2 · M
Agregar en c/u de los 3 botones de estadísticas globales (x Móvil, x Zona, x EFL) un **gráfico nuevo** que analice los atrasos de los pedidos/services **entregados**.

**Definición de "atraso de entregado":** delivery_timestamp - fch_hora_max_ent (positivo = entregado tarde).

**Tareas:**
- Backend: agregación de atrasos por dimensión.
- Frontend: nuevo gráfico (Recharts o lo que usa la app).

---

## 8. Mantenimiento / Retención de datos

### 8.1 — Tareas programadas de limpieza · P1 · M
Crear pg_cron jobs (o equivalente) para purgar:

| Tabla | Retención |
|---|---|
| `gps_tracking_history` (coords) | **N días = configurado en rol root** |
| `pedidos` históricos | **N días = configurado en rol root** |
| `services` históricos | **N días = configurado en rol root** |
| `audit_log` / logs de auditoría | **30 días** |
| Tablas de debug generadas por la app | **7 días** |

**Tareas:**
- Definir el campo de "días" en el rol root (si no existe ya).
- Crear las funciones SQL de cleanup + el pg_cron.
- Documentar la política en `docs/sqls/`.

**AC:** se aplica el cron diario y datos viejos se borran sin afectar la operación.

**Ojo:** este tope de días tiene que ser COHERENTE con el límite de 180 días que pusimos para reconstruir `moviles_dia`. Si root configura > 180, ajustar también.

---

## 9. Prioridad recomendada (resumen)

| Bloque | Items | Prio | Complejidad |
|---|---|---|---|
| **Bugs urgentes (post-refactor)** | 1.1, 1.2, 1.3 | P0 | S-M c/u |
| **Capa cap. de entrega + login demo** | 1.4, 1.5 | P1 | M / S |
| **URGENTE/NOCTURNO + diurno-nocturno** | 2.4, 2.5 | P1 | S + L |
| **Roles SGM** | 3.1, 3.2 | P1 | M + L |
| **Recorridos por EFL + perfil** | 4.1 | P1 | M |
| **Preferencias + refresh inteligente** | 5.1 | P1 | M |
| **10 funcionalidades + renames** | 6.1 | P1 | L |
| **Retención de datos** | 8.1 | P1 | M |
| **Estética mapa (3, 5a, 5b, 5.2, 5.3)** | 2.1, 2.2, 2.3, 5.2, 5.3, 7.1 | P2 | S c/u |

**Sugerencia de orden:**
1. **Oleada A (esta semana):** bugs P0 del refactor (1.1, 1.2, 1.3) + 1.5 (auth demo) → cerrar el rabo del moviles_dia
2. **Oleada B:** 10 funcionalidades + renames (6.1) + retención (8.1) — son enabler para las otras
3. **Oleada C:** roles SGM (3.1 + 3.2)
4. **Oleada D:** capa cap. entrega (1.4) + URGENTE/NOCTURNO (2.4)
5. **Oleada E:** recorridos por perfil (4.1) + preferencias refresh (5.1)
6. **Oleada F:** estética + estadísticas + diurno/nocturno (2.5)

---

## 10. Puntos abiertos / requieren clarificación con el usuario

- **§2.2:** identificar el elemento concreto que cambia de color a azul oscuro.
- **§2.4:** definir tratamiento del "0 / X" en la capa inferior.
- **§4.1:** decidir si para fecha anterior se mantiene criterio actual o se fuerza "todos inactivos" en el recorrido.
- **§5.1:** confirmar QUÉ preferencias se mueven a Preferencias Globales.
- **§5.3:** confirmar UBICACIÓN del contador "Cant Móviles".
- **§6.1:** confirmar la asignación inicial de cada funcionalidad a roles.
- **§8.1:** confirmar el campo en la tabla `roles` que guarda los días de retención (existe? hay que crearlo?).
- **§1.4:** caso concreto de reproducción para la capa de cap. de entrega.

> Cuando estos puntos se confirmen, cada bloque mayor pasa a brainstorming individual antes de plan de implementación. Bugs P0 (1.1, 1.2, 1.3) pueden ir directo a fix.
