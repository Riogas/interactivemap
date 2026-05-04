# Lessons — 20260503-tz01-tm3

## Pedido
Fix timezone bug: 24 ocurrencias de `new Date().toISOString().split('T')[0]` devuelven fecha equivocada entre 21:00-23:59 Montevideo.

## Bucket inicial
bug-fix

## Resumen del path
triage (10s) → implementer sonnet (10m) → code-reviewer APPROVED → qa PASSED 320/320

## Patrones detectados
- PowerShell `-replace` con `-Encoding UTF8 -NoNewline` puede corromper archivos TSX con template literals cuando se hacen reemplazos multiline. Solución: usar line-by-line `ForEach-Object` con `Set-Content` sin `-NoNewline`.
- El antipatrón `new Date().toISOString().split('T')[0]` es peligroso en apps con usuarios en TZ != UTC. Centralizarlo en un helper con `now?` inyectable facilita tests.
- `Intl.DateTimeFormat('en-CA', { timeZone })` es el approach correcto y funciona igual en Node y browser.

## Métrica clave
- Iteraciones: 1 (implementer + reviewer + qa en 1 vuelta)
- Archivos cambiados: 19 (17 modificados + 2 nuevos)
- Antipatrones eliminados: 24
- Tests nuevos: 10 (4 AC3 + 6 edge cases)
- Regresiones: 0 (320/320)
- Hubo escalación al arbiter: no
- Hubo escalación al humano: no
