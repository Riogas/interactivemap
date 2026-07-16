# Notificación de incidentes por correo (TrackMovil)

**Fecha:** 2026-07-08
**Autor:** Julio (jgomez) + Claude
**Pedido de:** Diego (audio 2026-07-08 8:43)

## Objetivo

Cuando se carga un incidente en TrackMovil, además de guardarlo en la base, la app
debe **enviar un correo** por SMTP a una o varias casillas. Toda la configuración
(servidor SMTP, credenciales, plantillas de asunto/cuerpo, destinatarios) vive en la
pantalla de **Preferencias Globales**, accesible únicamente a root/admin.

El envío es **fire-and-forget**: si el mail falla, el incidente igual se guarda.

## Contexto del código existente

- Incidentes se guardan en `app/api/incidents/route.ts` (tabla `incidents` en Supabase).
  Ya existe una notificación fire-and-forget a `INCIDENT_WEBHOOK_URL` (n8n) — **se mantiene**.
- Preferencias Globales = modal `components/ui/PreferenciasGlobalesModal.tsx`, gateado por
  root o funcionalidad `"Preferencias Globales"`.
- Patrón de config global singleton: tabla `realtime_settings` (fila `id=1`) +
  endpoint `/api/realtime-config` (GET público / PUT gateado por headers
  `x-track-isroot` / `x-track-funcs`) + hook `useGlobalRealtimeSettings`.
- Cliente server de Supabase: `getServerSupabaseClient()` en `lib/supabase.ts` (service_role).

## Decisiones (acordadas en brainstorming)

1. **Envío:** la app manda el mail directo por SMTP con `nodemailer` (no vía n8n).
2. **Plantillas:** asunto y cuerpo con variables `{{...}}` que se reemplazan con datos del incidente.
3. **Destinatarios:** varias casillas separadas por coma.
4. **Toggle on/off** del envío + **botón "Enviar prueba"**.
5. **Password SMTP:** texto plano en la tabla, **nunca devuelta por el GET**.

## Componentes

### 1. Base de datos — tabla `email_settings` (singleton, id=1)

`docs/sqls/2026-07-08-create-email-settings.sql`, mismo estilo que `realtime_settings`:

| campo | tipo | default | nota |
|---|---|---|---|
| `id` | integer PK CHECK(id=1) | 1 | singleton |
| `enabled` | boolean | false | toggle del envío |
| `smtp_host` | text | '' | servidor |
| `smtp_port` | integer | 587 | puerto |
| `smtp_secure` | boolean | false | SSL/TLS (465=true, 587=false/STARTTLS) |
| `smtp_user` | text | '' | usuario |
| `smtp_password` | text | '' | plano, NUNCA devuelto por GET |
| `from_email` | text | '' | remitente |
| `to_emails` | text | '' | destinatarios separados por coma |
| `subject_template` | text | (ver abajo) | plantilla asunto |
| `body_template` | text | (ver abajo) | plantilla cuerpo |
| `updated_at` | timestamptz | now() | |
| `updated_by` | text | | |

Fila inicial con defaults vía `INSERT ... ON CONFLICT (id) DO NOTHING`.

Defaults de plantilla:
- Asunto: `Nuevo incidente #{{id}} en TrackMovil`
- Cuerpo: `Se reportó un incidente el {{fecha}}.\n\nUsuario: {{usuario}}\nReporta: {{reporter}}\nCelular: {{celular}}\nEmail: {{email}}\n\nDescripción:\n{{descripcion}}\n\nVer detalle: {{link}}`

### 2. `lib/email.ts` (nuevo)

Helper server-side con `nodemailer`:
- `interface EmailSettings` (camelCase) + `DEFAULT_EMAIL_SETTINGS`.
- `getEmailSettings(): Promise<EmailSettings & { hasPassword: boolean }>` — lee fila id=1.
- `renderTemplate(tpl: string, vars: Record<string,string>): string` — reemplaza `{{clave}}`.
  Variables soportadas: `id`, `usuario`, `reporter`, `celular`, `email`, `descripcion`, `fecha`, `link`.
- `sendIncidentEmail(incident): Promise<void>` — lee settings; si `enabled` y hay host+to,
  arma transport nodemailer, renderiza asunto/cuerpo y envía. **Nunca lanza** (try/catch + warn).
- `sendTestEmail(overrideSettings?): Promise<{ ok: boolean; error?: string }>` — envía un mail
  de prueba con datos ficticios. Devuelve resultado explícito (para mostrar al admin).

### 3. API `/api/email-config` (nuevo) — GET / PUT

`app/api/email-config/route.ts`, mismo modelo de confianza que `realtime-config`:
- **GET:** gateado por `x-track-isroot=S` o `x-track-funcs` contiene `"Preferencias Globales"`
  (a diferencia de realtime-config, este GET NO es público). Devuelve toda la config
  **menos `smtp_password`**, con `hasPassword: boolean`.
- **PUT:** mismo gate. Guarda (upsert id=1). Si el body trae `smtpPassword` vacío/undefined,
  **conserva la password existente** (no la pisa). `updated_by` = header `x-track-user`.

### 4. API `/api/email-config/test` (nuevo) — POST

`app/api/email-config/test/route.ts`, mismo gate. Llama `sendTestEmail()` con la config
guardada (o la que venga en el body para probar antes de guardar). Devuelve `{ success, error? }`.

### 5. Hook `useEmailSettings` (nuevo)

`hooks/dashboard/useEmailSettings.ts`, espejo de `useGlobalRealtimeSettings`:
- GET al montar (con headers de admin), `updateSettings` (PUT), `sendTest` (POST /test).
- No expone la password; maneja `hasPassword` para el placeholder del input.

### 6. Modal — nueva sección en `PreferenciasGlobalesModal.tsx`

Sección **"Notificación de incidentes por correo"** (badge ADMIN), visible con el mismo
criterio del resto de secciones admin. Campos:
- Toggle `enabled` ("Enviar mail al cargar incidente").
- `smtp_host`, `smtp_port`, checkbox `smtp_secure` ("Conexión segura SSL/TLS").
- `smtp_user`, `smtp_password` (write-only: placeholder "•••• (sin cambios)" si `hasPassword`).
- `from_email`, `to_emails` (coma).
- `subject_template` (input), `body_template` (textarea) + ayuda con las variables.
- Botón **"Enviar prueba"** con feedback de resultado (ok/error).
- Se guarda con el botón 💾 del modal (o botón propio de la sección — a criterio del implementer,
  preferible integrarlo al guardado existente si es simple).

### 7. Disparo en `app/api/incidents/route.ts`

Después del insert exitoso (donde hoy se llama `notifyWebhook(...)`), agregar llamada
**no-bloqueante** a `sendIncidentEmail({...})` con los datos del incidente. Mantener el webhook.

### 8. Dependencia

Agregar `nodemailer` y `@types/nodemailer` (devDep) al `package.json`. Instalar con el
gestor del repo (pnpm).

## Manejo de errores

- Falla de envío de mail **nunca** bloquea ni hace fallar la carga del incidente.
- GET del config **jamás** devuelve `smtp_password`.
- PUT con password vacía = conserva la anterior.
- Test devuelve el error de SMTP en texto claro para diagnóstico del admin.

## Testing

- Unit: `renderTemplate` sustituye todas las variables y deja intactas las desconocidas.
- El insert de incidente sigue devolviendo `success:true` aunque `sendIncidentEmail` tire
  error (mock de nodemailer que lanza).
- Gate del PUT/GET/test: 403 sin headers de admin.
- Manual: configurar SMTP real → "Enviar prueba" → cargar incidente → verificar mail.

## Fuera de alcance

- Reintentos / cola de mails (fire-and-forget alcanza).
- Cifrado en reposo de la password (se eligió texto plano).
- Verificación del bug previo de reporte de incidentes (tarea separada).
