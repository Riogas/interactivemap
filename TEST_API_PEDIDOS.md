# 🧪 Test API Pedidos - Diagnóstico de Error de Red

## ❌ Error detectado
```
Error fetching positions: TypeError: NetworkError when attempting to fetch resource.
📦 Total pedidos completos: 0
```

## 🔍 Posibles causas

### 1️⃣ Problema de autenticación
El endpoint `/api/pedidos` requiere autenticación (`requireAuth`).

**Verifica en la consola:**
- ¿Hay un error 401 Unauthorized?
- ¿Hay un error de CORS?
- ¿La sesión está activa?

### 2️⃣ URL incorrecta
La URL que se está llamando es:
```
/api/pedidos?escenario=1000&fecha=2026-02-06
```

**Verifica:**
- ¿Existe el endpoint `/api/pedidos/route.ts`? ✅ SÍ
- ¿El servidor está corriendo? ✅ Parece que sí (otros endpoints funcionan)

### 3️⃣ Error de Supabase
El endpoint usa `supabase.from('pedidos')`.

**Verifica:**
- ¿Las credenciales de Supabase están configuradas?
- ¿La tabla `pedidos` existe?
- ¿Hay RLS (Row Level Security) bloqueando la consulta?

---

## 🔧 Pasos de debugging

### Paso 1: Verificar en Network Tab (DevTools)

1. Abre **DevTools** (F12)
2. Ve a la pestaña **Network**
3. Filtra por **Fetch/XHR**
4. Busca la llamada a `/api/pedidos`

**¿Qué status code devuelve?**
- ❌ **401**: Problema de autenticación
- ❌ **403**: Problema de permisos/CORS
- ❌ **500**: Error del servidor
- ❌ **Failed**: Error de red/DNS

### Paso 2: Probar el endpoint manualmente

Abre una nueva pestaña del navegador y ve a:
```
http://localhost:3000/api/pedidos?escenario=1000&fecha=2026-02-06
```

**¿Qué devuelve?**
- ✅ JSON con pedidos: El endpoint funciona
- ❌ 401/403: Problema de autenticación
- ❌ Error 500: Revisar logs del servidor

### Paso 3: Verificar autenticación

En la consola del navegador, ejecuta:
```javascript
// Verificar si hay token de sesión
console.log('Cookies:', document.cookie);

// Verificar localStorage
console.log('LocalStorage auth:', localStorage.getItem('auth'));
console.log('LocalStorage token:', localStorage.getItem('token'));
```

### Paso 4: Ver respuesta completa del error

Ya agregué logging detallado en `fetchPedidos()`. Recarga la página y busca en la consola:

```
📦 Fetching pedidos from API...
📅 Selected date: YYYY-MM-DD
🌐 Fetching URL: /api/pedidos?escenario=1000&fecha=YYYY-MM-DD
📡 Response status: XXX
📦 Response data: {...}
```

Si hay un error, verás:
```
❌ Error fetching pedidos: [error details]
❌ Error details: { name, message, stack }
```

---

## 🎯 Soluciones según el error

### Error 401 - No autenticado
**Causa:** No hay sesión activa o el token expiró

**Solución:**
1. Cierra sesión y vuelve a iniciar sesión
2. Verifica que el middleware de auth funcione
3. Revisa `lib/auth-middleware.ts`

### Error 403 - Sin permisos
**Causa:** RLS de Supabase está bloqueando la consulta

**Solución:**
1. Ve a Supabase Dashboard
2. Tabla `pedidos` → Policies
3. Agrega policy para SELECT:
```sql
CREATE POLICY "Allow read pedidos"
ON public.pedidos
FOR SELECT
TO authenticated
USING (true);
```

### Error 500 - Error del servidor
**Causa:** Error en el código del endpoint o en Supabase

**Solución:**
1. Revisa los logs del servidor (terminal donde corre `npm run dev`)
2. Busca el error específico
3. Verifica las credenciales de Supabase en `.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

### NetworkError - Error de red
**Causa:** Problema de conexión o CORS

**Solución:**
1. Verifica que el servidor esté corriendo
2. Prueba abrir `http://localhost:3000` en el navegador
3. Si usas proxy inverso (nginx), verifica su configuración

---

## 🧪 Test rápido en consola

Copia y pega esto en la consola del navegador:

```javascript
// Test manual del endpoint
fetch('/api/pedidos?escenario=1000&fecha=2026-02-06')
  .then(res => {
    console.log('Status:', res.status);
    return res.json();
  })
  .then(data => {
    console.log('Data:', data);
    if (data.success) {
      console.log(`✅ ${data.count} pedidos encontrados`);
      if (data.data.length > 0) {
        console.log('Primer pedido:', data.data[0]);
      }
    } else {
      console.log('❌ Error:', data.error);
    }
  })
  .catch(err => {
    console.error('❌ Network error:', err);
  });
```

---

## 📊 Logging agregado

He agregado los siguientes logs en `app/dashboard/page.tsx`:

```typescript
📦 Fetching pedidos from API...          // Inicio del fetch
📅 Selected date: YYYY-MM-DD             // Fecha seleccionada
🌐 Fetching URL: /api/pedidos?...        // URL completa
📡 Response status: XXX                  // HTTP status
📦 Response data: {...}                  // JSON completo
✅ Loaded X pedidos                      // Si éxito
📍 Primer pedido: {...}                  // Primer pedido
📍 X pedidos tienen coordenadas          // Con coords
❌ Error fetching pedidos: ...           // Si error
❌ Error details: { name, message }      // Detalles del error
```

---

## 🔄 Próximos pasos

1. **Recarga la aplicación** (Ctrl+R o F5)
2. **Abre la consola** (F12)
3. **Busca los nuevos logs** con emojis
4. **Copia y pega TODO el output** relacionado con pedidos
5. **Prueba el test manual** (código JavaScript arriba)
6. **Copia el resultado** del test manual

Con esa información podré identificar exactamente qué está fallando.

---

**Fecha:** 2026-02-06  
**Archivo:** TEST_API_PEDIDOS.md
