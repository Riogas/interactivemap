# Notificaciones de incidencias via webhook (n8n)

Cuando un usuario sube una nueva incidencia, la app hace un POST fire-and-forget
a `INCIDENT_WEBHOOK_URL`. Si la variable no está configurada, el comportamiento
es identico al anterior (la incidencia se crea, sin notificacion).

## Payload que recibe el webhook

```json
{
  "id": 42,
  "username": "jperez",
  "ts": "2026-05-18T17:21:00.000Z",
  "description": "El mapa no carga en la pantalla de pedidos",
  "detail_url": "https://track.riogas.com.uy/admin/incidencias?id=42",
  "ip": "192.168.1.100"
}
```

Todos los campos son strings o numbers. `description` puede ser `null`.

## Configuracion en n8n

### Paso 1 — Crear el webhook

1. En n8n, crear un nuevo workflow.
2. Agregar nodo **Webhook** (tipo "Webhook").
3. Configurar:
   - HTTP Method: `POST`
   - Path: `incident-created` (resulta en `/webhook/incident-created`)
   - Authentication: None (el payload no contiene datos sensibles)
   - Response Mode: `Immediately` (la app no espera respuesta)
4. Activar el webhook y copiar la URL de produccion.

### Paso 2 — Agregar nodo Telegram

1. Agregar nodo **Telegram** despues del webhook.
2. Configurar con tu bot token (creado en BotFather).
3. Operation: `Send Message`
4. Chat ID: el chat o grupo donde llegan las alertas.
5. Text (expresion):

```
*Nueva incidencia #{{ $json.id }}*
Usuario: {{ $json.username ?? 'anonimo' }}
Hora: {{ new Date($json.ts).toLocaleString('es-UY') }}
Descripcion: {{ ($json.description ?? 'Sin descripcion').slice(0, 200) }}
[Ver en panel]({{ $json.detail_url }})
```

6. Parse Mode: `MarkdownV2` (o `Markdown` segun version de n8n).

### Paso 3 — Configurar la variable de entorno en la app

En `.env.production` (o via variables de entorno del servidor):

```env
INCIDENT_WEBHOOK_URL=https://n8n.riogas.com.uy/webhook/incident-created
```

Reiniciar la app con `pm2 restart track --update-env`.

## Agregar otros canales (email, Slack, etc.)

Solo agregar mas nodos en el workflow de n8n, despues del nodo Webhook.
La app no necesita cambios.

## Verificacion manual

Para testear el webhook sin crear una incidencia real:

```bash
curl -X POST https://n8n.riogas.com.uy/webhook/incident-created \
  -H "Content-Type: application/json" \
  -d '{
    "id": 999,
    "username": "test",
    "ts": "2026-05-18T17:00:00.000Z",
    "description": "Prueba de webhook",
    "detail_url": "https://track.riogas.com.uy/admin/incidencias?id=999",
    "ip": "127.0.0.1"
  }'
```

## Comportamiento ante fallos

- Si el webhook no responde o devuelve error, se loguea un `warn` en los logs del servidor.
- La incidencia queda guardada en la base de datos independientemente.
- El usuario que reporto la incidencia no ve ningun error.
