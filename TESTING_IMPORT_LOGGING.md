# Testing Import Logging - Guía de Pruebas

## 📦 Logging Extensivo Implementado

Se ha agregado **logging detallado y visual** a los endpoints de importación/actualización de pedidos para facilitar el debugging en tiempo real.

---

## 🎯 Qué se Agregó

### POST `/api/import/pedidos` - Importar nuevos pedidos
### PUT `/api/import/pedidos` - Actualizar pedidos existentes

Ambos endpoints ahora tienen:

1. **🔷 Headers visuales** con timestamps y separadores `═══`
2. **📥 Paso 1**: Lectura del body (tipo, estructura, claves)
3. **🔍 Paso 2**: Normalización (array/objeto, cantidad)
4. **📦 Paso 3**: Transformación PascalCase → snake_case (con JSON dumps antes/después)
5. **🔄 Paso 4**: Inserción/Upsert en Supabase
6. **✅ Paso 5**: Confirmación exitosa con timestamps
7. **❌ Errores detallados**:
   - Código de error de Supabase
   - Mensaje descriptivo
   - Detalles técnicos
   - Hints de solución
   - Stack traces completos

---

## 🧪 Cómo Probar

### 1️⃣ Reiniciar el Servidor

```powershell
# Si usas npm/pnpm
pnpm run dev

# Si usas PM2
pm2 restart trackmovil

# Ver logs en tiempo real con PM2
pm2 logs trackmovil --lines 200
```

---

### 2️⃣ Preparar Postman

**Endpoint:** `http://localhost:3000/api/import/pedidos`

**Método:** `POST` (para importar) o `PUT` (para actualizar)

**Headers:**
```
Content-Type: application/json
```

**Body (ejemplo):**
```json
{
  "ClienteCiudad": "MONTEVIDEO",
  "ClienteDireccion": "CAMINO TENIENTE GALEANO 4201 ESQ. 8 DE OCTUBRE",
  "id": 16619474,
  "escenario": 1000,
  "latitud": -34.82926,
  "longitud": -56.15828,
  "EstadoNro": 2,
  "SubEstadoNro": 3,
  "SubEstadoDesc": "En camino",
  "ClienteNombre": "Juan Pérez",
  "ProductoNom": "Gas 13kg",
  "ImpBruto": 1267.50
}
```

---

### 3️⃣ Hacer el Request desde Postman

**IMPORTANTE**: Antes de hacer el request, asegúrate de tener el terminal/consola visible donde se están mostrando los logs del servidor.

---

### 4️⃣ Observar los Logs

Deberías ver algo como esto en la consola:

```
════════════════════════════════════════════════════════════════════════════
📦 INICIO IMPORTACIÓN DE PEDIDOS [2024-01-15T10:30:45.123Z]
════════════════════════════════════════════════════════════════════════════
📥 1. Leyendo body del request...
✅ Body recibido correctamente
📊 Tipo de body: object
📊 Claves del body: [ 'ClienteCiudad', 'ClienteDireccion', 'id', 'escenario', 'latitud', 'longitud', ... ]

🔍 2. Normalizando estructura...
⚠️  No hay propiedad "pedidos", asumiendo que body ES el pedido
✅ Estructura normalizada: 1 pedido(s)
📊 ¿Es array?: false

────────────────────────────────────────────────────────────────────────────
📦 3. Transformando pedidos a formato Supabase...
📄 Pedido #1 (sin transformar):
{
  "ClienteCiudad": "MONTEVIDEO",
  "ClienteDireccion": "CAMINO TENIENTE GALEANO 4201 ESQ. 8 DE OCTUBRE",
  "id": 16619474,
  "escenario": 1000,
  ...
}

📄 Pedido #1 (transformado):
{
  "id": 16619474,
  "escenario": 1000,
  "cliente_ciudad": "MONTEVIDEO",
  "cliente_direccion": "CAMINO TENIENTE GALEANO 4201 ESQ. 8 DE OCTUBRE",
  ...
}
────────────────────────────────────────────────────────────────────────────

🔄 4. Insertando en Supabase...

✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅
🎉 IMPORTACIÓN EXITOSA [2024-01-15T10:30:45.789Z]
📊 5. Pedidos importados: 1
✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅
```

---

### 5️⃣ Si Hay Errores, Verás:

```
❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌
💥 ERROR DE SUPABASE:
📛 Código: 23505
📛 Mensaje: duplicate key value violates unique constraint "pedidos_pkey"
📛 Detalles: Key (id)=(16619474) already exists.
📛 Hint: Try using UPSERT (PUT request) instead of INSERT
❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌
```

---

## 🔍 Debugging del Error HTML 404

Si sigues recibiendo el error HTML 404 desde Postman:

```json
{
  "Code": "N",
  "Message": "Occurrió un problema... | <!DOCTYPE html>...404: This page could not be found..."
}
```

### Posibles Causas:

1. **❌ URL incorrecta**
   - Verifica: `http://localhost:3000/api/import/pedidos`
   - NO: `http://localhost:3000/import/pedidos`
   - NO: `http://localhost:3001/api/import/pedidos`

2. **❌ Servidor no corriendo**
   - Verifica que el servidor esté activo: `pm2 list` o `pnpm run dev`

3. **❌ Método incorrecto**
   - Debe ser `POST` (importar) o `PUT` (actualizar)
   - NO `GET`

4. **❌ Puerto incorrecto**
   - Verifica en qué puerto corre el servidor
   - Puede ser `:3000`, `:3001`, etc.

5. **❌ Middleware bloqueando**
   - El middleware ya tiene logging, revisa si aparecen logs del middleware en la consola

---

## 📊 Checklist de Debugging

Copia TODA la salida de la consola y compártela. Específicamente busca:

- [ ] ¿Aparecen logs del **middleware** cuando haces el request?
- [ ] ¿Aparecen los headers `════════` del POST/PUT?
- [ ] ¿Qué paso es el último que se ejecuta antes del error?
- [ ] ¿Hay algún error de TypeScript/JavaScript en la consola?
- [ ] ¿El servidor sigue corriendo después del error?

---

## 🎯 Próximos Pasos

Una vez que hagas el request desde Postman:

1. **Copia TODO el output de la consola** (desde el inicio del request hasta el final)
2. **Incluye el response de Postman** (tanto success como error)
3. Comparte esa información para diagnosticar exactamente dónde está fallando

---

## 💡 Tip Extra

Si estás usando PM2, puedes ver logs en tiempo real con colores:

```powershell
pm2 logs trackmovil --lines 500 --raw
```

Esto te mostrará las últimas 500 líneas de logs y continuará mostrando nuevos logs en tiempo real.

---

## 🚀 Testing Rápido desde Terminal (Alternativa)

Si quieres probar sin Postman:

```powershell
# POST (importar)
curl -X POST http://localhost:3000/api/import/pedidos `
  -H "Content-Type: application/json" `
  -d '{\"id\":16619999,\"escenario\":1000,\"ClienteCiudad\":\"MONTEVIDEO\",\"latitud\":-34.82926,\"longitud\":-56.15828}'

# PUT (actualizar)
curl -X PUT http://localhost:3000/api/import/pedidos `
  -H "Content-Type: application/json" `
  -d '{\"id\":16619474,\"escenario\":1000,\"EstadoNro\":3,\"SubEstadoDesc\":\"Entregado\"}'
```

---

¡Ahora tienes **visibilidad completa** de lo que sucede en cada paso del proceso de importación! 🎉
