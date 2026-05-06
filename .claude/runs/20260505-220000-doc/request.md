# Documentación + presentación de funcionalidades del mapa para distribuidores

## Pedido literal

> ¿Puedes armar un documento listando todas las funcionalidades que tiene el mapa que hemos creado, para los distribuidores? Recuerda que no tienen acceso a algunas cosas como root o despacho o supervisor o dashboard, que esos roles tienen cosas más específicas. La idea es que sea lo más humanizado posible y lo más entendible ya que es para presentarlo a personas que no conocen nada del tema. Y si puedes además del documento que crees una presentación corta en PPT a ver si podemos utilizarla. Cuando lo termines devolvémela por Telegram.

## Tipo de pedido

**Documentación + presentación** (NO es código). El bucket apropiado probablemente es `docs-only` o similar — no requiere implementer, code-reviewer, qa-tester ni ux-validator. Se debería ir directo al `documenter` agent (o equivalente).

## Audiencia

**Distribuidores** (no técnicos, no conocen nada del sistema). Lenguaje:
- Sin jerga técnica.
- Sin nombres de variables, endpoints, ni columnas de DB.
- Tono cálido, ejemplos concretos.
- Ideal para presentar como onboarding a un distribuidor nuevo.

## Alcance — qué incluir

Solo las funcionalidades que un usuario con rol **distribuidor** ve y puede usar. Excluir explícitamente:

- ❌ Página `/admin/auditoria` (solo root)
- ❌ Página `/admin/incidencias` (solo root)
- ❌ Toggle de auditoría en Preferencias (solo root)
- ❌ Sección "Indicadores" del dashboard (DashboardIndicators — solo root/despacho/supervisor)
- ❌ Selector de empresas fleteras (los distribuidores ven solo su empresa)
- ❌ Sección de zonas/estadísticas avanzadas
- ❌ Botón "Tracking" / "Ranking" / FAB admin
- ❌ Funcionalidades exclusivas de root/despacho/supervisor/dashboard
- ❌ Ver pedidos sin asignar (huérfanos) — los distribuidores no los ven
- ❌ Ver pedidos / services de móviles ocultos-pero-operativos cuando filtra subset

Funcionalidades a documentar (a confirmar leyendo el código de `app/dashboard/page.tsx`, `MovilSelector.tsx`, `MapView.tsx`, `FloatingToolbar.tsx`, `PreferencesModal.tsx`):

1. **Vista del mapa** — qué se ve por defecto
2. **Selector de fecha** — cómo elegir qué día mirar (si el rol distribuidor tiene permiso `date`, si no, día actual fijo)
3. **Móviles** — íconos, colores por estado, click para ver info, selección
4. **Pedidos en el mapa** — íconos, colores por atraso/estado, click para ver detalle
5. **Services en el mapa** — diferencia con pedidos, íconos
6. **Colapsable lateral** — móviles, pedidos, services agrupados; búsqueda; filtros locales
7. **Vista extendida** (PedidosTableModal / ServicesTableModal) — tabla completa con filtros
8. **Selección de móviles** — botones "Seleccionar Todos" / "Deseleccionar Todos"; click individual; cómo afecta lo que ven (mapa + colapsable + tabla extendida)
9. **Realtime** — cómo se actualizan automáticamente las posiciones GPS, los pedidos y los services
10. **Preferencias** (las accesibles a distribuidor — fecha, layer del mapa, polling, etc.; SIN la sección de auditoría)
11. **Cerrar sesión**
12. Cualquier funcionalidad menor: zoom, layers de mapa, POIs si los ven los distribuidores, indicadores de drift/sync.

## Entregables

1. **Documento** en formato markdown (preferido — fácil de exportar a PDF si quieren). Path sugerido: `Documents/trackmovil/user/funcionalidades-distribuidor.md`. Si el documenter agent ya tiene una convención de paths para docs de usuario final, seguir esa.
2. **Presentación PPT** corta (8–12 slides, 5–10 minutos). Estructura:
   - Slide 1: portada
   - Slide 2: ¿qué es TrackMovil para distribuidor?
   - Slides 3–N: una funcionalidad por slide (con captura/diagrama si se puede)
   - Slide final: tips + cómo pedir ayuda

   Tecnología: si se puede generar `.pptx` programáticamente (python-pptx, marp, etc.), bienvenido. Si no, generar `.md` + `.html` con marp y darme el comando para convertir, o entregar las slides en `.md` con marker `---` entre slides.

3. **Entrega por Telegram**: chat_id `5467882117`. Adjuntar ambos archivos al mensaje final.

## Restricciones

- NO modificar código fuente del proyecto. Esto es solo documentación.
- NO ejecutar servidor ni hacer screenshots reales — describir las pantallas con palabras.
- Si necesita íconos/diagramas en la PPT, usar emojis o SVG simples inline.
- Tono y vocabulario: español rioplatense (Uruguay), informal pero profesional. Evitar tecnicismos.

## Branch / git

Si los archivos generados van al repo, branch = `dev` (mismo workflow que venimos usando). Si van a `Documents/trackmovil/user/` (fuera del repo), no commit — solo entregar.

## Aceptación

- Documento markdown completo, sin tecnicismos, listo para entregar a un distribuidor que nunca usó el sistema.
- Presentación corta en formato PPT (.pptx) o equivalente convertible.
- Ambos enviados por Telegram al chat_id `5467882117` cuando esté listo.
- Lista exhaustiva de funcionalidades visibles para rol distribuidor (excluyendo todo lo que es admin/root/despacho/supervisor/dashboard).
