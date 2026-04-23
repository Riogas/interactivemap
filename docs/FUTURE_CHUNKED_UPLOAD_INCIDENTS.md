# TrackMovil — Mejora futura: chunked upload de incidencias

Contexto: hoy el `IncidentRecorder` sube el video completo en un solo `POST /api/incidents` multipart. Eso depende del `client_max_body_size` del nginx (principal + track) y de los timeouts del proxy. Si querés independizarte **completamente del nginx**, la solución es subir el video en chunks chicos (<2 MB cada uno) para que **ningún request individual pegue el tope** de nginx.

Esta mejora **no es urgente**. Mientras nginx esté bien configurado (`client_max_body_size 500M` en los dos nginx + `proxy_request_buffering off`), el upload directo funciona. Hacer chunked tiene sentido si:

- No se puede/quiere tocar el nginx principal.
- Se esperan videos muy largos (30+ min, 100+ MB).
- Se quiere resilencia: si el upload se corta, retomar donde quedó en vez de volver a empezar.

---

## Diseño

### Cambios en la tabla (compatible hacia atrás)

`public.incidents` suma una columna:

```sql
ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS upload_status TEXT DEFAULT 'complete'
    CHECK (upload_status IN ('pending', 'uploading', 'complete', 'failed'));
```

Los incidentes viejos quedan con `upload_status = 'complete'` automáticamente.

### Tres endpoints nuevos

**1. `POST /api/incidents/init`** — crea la fila con `upload_status='pending'` y genera path único.

```ts
// body: { description?: string, duration_s?: number, mime?: string, total_chunks: number }
// respuesta: { uploadId: number, videoPath: string }
```

**2. `POST /api/incidents/chunk`** — recibe un chunk del video y lo appendea a un archivo temporal en el server (o al bucket usando Storage resumable upload).

```ts
// multipart:
//   - uploadId (string)
//   - chunkIndex (number, 0-based)
//   - data (Blob, max 2 MB)
// respuesta: { received: number, chunkIndex: number }
```

Chunks se guardan en `/tmp/incidents/<uploadId>/chunk-<NNNN>.bin`. Si el server se reinicia en el medio, el upload se pierde — el cliente debería reintentar desde cero. (Para resiliencia real, usar Supabase Storage resumable via protocolo TUS.)

**3. `POST /api/incidents/finalize`** — concatena los chunks, sube el archivo final al bucket `incident-videos`, actualiza la fila con `video_path` + `upload_status='complete'` + tamaño real.

```ts
// body: { uploadId: number, total_chunks: number }
// respuesta: { id, video_path, size_bytes }
```

### Flujo del cliente

```ts
// 1. Preparar chunks
const CHUNK_SIZE = 1.5 * 1024 * 1024; // 1.5 MB (margen vs 2 MB de nginx)
const chunks: Blob[] = [];
for (let i = 0; i < blob.size; i += CHUNK_SIZE) {
  chunks.push(blob.slice(i, i + CHUNK_SIZE));
}

// 2. Init
const initRes = await fetch('/api/incidents/init', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    description,
    duration_s: pendingDurationS,
    mime: blob.type,
    total_chunks: chunks.length,
  }),
});
const { uploadId } = await initRes.json();

// 3. Upload chunks secuencial con retry
for (let i = 0; i < chunks.length; i++) {
  await uploadChunkWithRetry(uploadId, i, chunks[i], 3);
  setProgress(((i + 1) / chunks.length) * 100);
}

// 4. Finalize
const finalRes = await fetch('/api/incidents/finalize', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ uploadId, total_chunks: chunks.length }),
});
```

### UX

- Progress bar real (porcentaje = chunks subidos / total).
- Si falla un chunk, reintentar 3x con backoff.
- Si falla definitivamente, marcar `upload_status='failed'` en la DB y mostrar error con opción de reintentar.
- Opción avanzada: persistir el `uploadId` + `chunkIndex` en `localStorage` para retomar después de un refresh.

### Cleanup

- Job periódico (o `BEFORE INSERT` trigger) que borre uploads `pending` con más de 1 hora de antigüedad + sus chunks en `/tmp`.

---

## Alternativa "zero server" — Supabase Storage Resumable Upload (TUS)

Supabase Storage soporta el protocolo [TUS](https://tus.io/) en `/storage/v1/upload/resumable`. El cliente usa `tus-js-client` y sube **directamente al bucket** en chunks, sin pasar por el server del track para el blob. El server solo recibe una notificación final ligera con metadata.

Ventaja: cero infraestructura en el server del track (ni `/tmp`, ni endpoints de chunk).
Desventaja: los chunks siguen pasando por nginx principal si el bucket está detrás de `track.riogas.com.uy/storage/...`. Si no, el browser va directo al host de Supabase.

Librería: `tus-js-client` (12 KB minified, gratis).

```ts
import * as tus from 'tus-js-client';

const upload = new tus.Upload(blob, {
  endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
  headers: {
    authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    'x-upsert': 'true',
  },
  uploadDataDuringCreation: true,
  removeFingerprintOnSuccess: true,
  metadata: {
    bucketName: 'incident-videos',
    objectName: videoPath,
    contentType: blob.type,
  },
  chunkSize: 6 * 1024 * 1024, // Supabase requiere 6 MB salvo el último
  onSuccess: () => { /* POST /api/incidents/finalize con el path */ },
});
upload.start();
```

Esto es la forma más profesional y performante. Pero requiere:
1. Que el browser pueda llegar al endpoint de Storage vía `track.riogas.com.uy/storage/v1/` (proxy en nginx principal hacia Supabase Kong, al igual que ya tenés para `/realtime/v1/`).
2. Configurar RLS / policies de Storage para que `anon` pueda hacer upload al bucket (con un path prefix seguro).

---

## Orden recomendado cuando retomemos

1. **Configurar proxy `/storage/v1/` en nginx principal** hacia el Kong de Supabase (3 líneas).
2. **Agregar `tus-js-client`** al proyecto.
3. **Generar signed upload URLs server-side** (`supabase.storage.from(...).createSignedUploadUrl(path)`) y usarlas como auth token del TUS client.
4. **Refactorizar `IncidentRecorderContext.confirmUpload`** para usar TUS en lugar de POST multipart.
5. **Añadir progress bar** al modal de upload.

Tiempo estimado: medio día si ya está la metadata table, 1 día si hay que refactor + tests.

---

## Mientras tanto (estado actual)

- Upload directo vía `POST /api/incidents` (multipart).
- `nginx-track-fixed.conf` tiene `client_max_body_size 500M` + `proxy_request_buffering off` para `/api/incidents`.
- Cliente reduce bitrate a 500 kbps y cap resolución a 720p (commit a334157).
- El nginx principal **también debe** tener el mismo `client_max_body_size` para `/api/incidents`; ver docs en el commit 7552d1b.

Con eso actual, videos de 10-30 min funcionan sin issues.
