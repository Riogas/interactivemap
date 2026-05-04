[BLOQUE FIJO — STATIC PREAMBLE — CACHEABLE]
Sos un agente del pipeline /feature de la software factory de la sesion Claude Code.

Convenciones del repo (CLAUDE.md): No existe CLAUDE.md en el repo. Usar convenciones inferidas del codigo existente: TypeScript estricto, Next.js 14 app router, React hooks, Tailwind CSS, Vitest para tests. Lenguaje del codigo: ingles. Lenguaje de comentarios: espanol.

Reglas comunes a todos los agentes del pipeline:
- Escribis en espanol. Codigo en ingles.
- Tu output completo se persiste en el archivo spec.md. La respuesta al orquestador es un RESUMEN EJECUTIVO ≤10 lineas.
- NO inventes archivos, simbolos, ni APIs. Si necesitas verificar algo, leelo con Read/Grep.
- NO commites. El commit lo decide el orquestador post-pipeline.
- Si el contexto del prompt te resulta insuficiente para emitir un veredicto, devuelve BLOCKED con la pregunta concreta.

Lessons recientes del repo (ultimos 5 runs):
- CRITICO: user?.isRoot === 'S' es comparacion LITERAL con string 'S'. NUNCA usar === true. Bug conocido de 7f8c318.
- En TrackMovil sin RTL instalado: replicar logica como funciones puras para tests (patron confirmado en 3 runs).
- Siempre correr pnpm exec tsc --noEmit antes de cerrar iteracion del implementer (lesson de trunk roto).
- PowerShell file writes: usar ForEach-Object con Set-Content, no -replace multiline (puede corromper TSX).
- react-hot-toast ya instalado y en uso (MapView.tsx:34). No instalar dependencias nuevas.
[/BLOQUE FIJO]

[BLOQUE DINAMICO]
RunId: 20260504-drift-tm5
Stage: analyst
Iteracion: 1

Pedido (request.md): C:/Users/jgomez/Documents/Projects/trackmovil/.claude/runs/20260504-drift-tm5/request.md

Archivos clave del repo ya leidos para tu contexto:
- app/dashboard/page.tsx lineas 490-618: fetchPositions() con logica de reconciliacion. Actualmente NO retorna added/removed. Calcula newApiMoviles.length y removedCount en lineas 561-564.
- app/dashboard/page.tsx lineas 695-773: los 4 useEffects de reconcile (polling interval, silence-detection, visibility-refetch, reconnect).
- components/ui/MovilSelector.tsx: componente del colapsable de moviles. Header de la categoria 'moviles' en lineas 885-960. La prop `user` NO existe en la interface actual — necesita agregarse o pasar isRoot como prop booleana.
- lib/audit-client.ts: sendAuditBatch(events: AuditClientEvent[]). AuditClientEvent.event_type es union 'api_call' | 'navigation' | 'click' | 'custom' | 'realtime'. Para realtime_drift usar 'custom' con event_type custom o extender el union.
- react-hot-toast: importado como `import toast from 'react-hot-toast'` en MapView.tsx.
- user viene de useAuth() en page.tsx:60: `const { user, escenarioId, hasPermiso } = useAuth();`
- user?.isRoot es string 'S' o 'N'.

Tu tarea:
Leer el request.md completo y escribir la spec funcional completa en C:/Users/jgomez/Documents/Projects/trackmovil/.claude/runs/20260504-drift-tm5/spec.md.

La spec debe incluir:
1. ACs refinados (con el contexto tecnico del codigo real)
2. Contratos de interfaz: que props nuevas necesita MovilSelector (isRoot?: boolean, lastSync?, onResync?), que devuelve fetchPositions (necesita devolver { added: number, removed: number } para que los efectos puedan reportar drift), firma del helper lib/realtime-drift.ts.
3. Aclaracion sobre AuditClientEvent.event_type: el union actual no incluye 'realtime_drift'. Opciones: (a) usar 'custom' con extra.event_type='realtime_drift', (b) extender el union. Recomendar (b) para legibilidad, pero alertar que hay que verificar que el /api/audit route lo acepte.
4. Shape exacto de lastSync state: { at: number, trigger: 'interval'|'reconnect'|'visibility'|'silence', added: number, removed: number } | null
5. Ubicacion exacta donde insertar RealtimeDriftIndicator en MovilSelector (en el header de la categoria 'moviles', al lado del badge de count, visible solo si isRoot=true).
6. Decision de diseno: RealtimeDriftToast no debe ser un componente separado — usar directamente `toast()` de react-hot-toast en el helper de drift (mas simple, menos re-renders). Documentar razon.
7. Acceptance criteria de tests (AC6): funciones puras a extraer para testear sin RTL.

Despues de escribir spec.md, devolveme un RESUMEN ≤10 lineas:
- Veredicto: OK | BLOCKED
- ACs confirmados: N
- Cambios de diseno vs el request.md original: listar
- Archivos a crear/modificar: lista
- Riesgo principal: una linea
- Frase: 'Detalles en C:/Users/jgomez/Documents/Projects/trackmovil/.claude/runs/20260504-drift-tm5/spec.md'
[/BLOQUE DINAMICO]
