# 🎉 Login Funcionando - Cambios Aplicados

## ✅ Problemas Resueltos

### 1. **Login Error 500 → Login Success 200**
**Problema:** El proxy enviaba cookies del navegador que causaban error 500 en la API.

**Solución:** Deshabilitamos el reenvío de cookies en el proxy. La API genera su propio `GX_CLIENT_ID`.

**Resultado:**
```
📥 Response Status: 200
{
  "RespuestaLogin": {
    "success": true,
    "token": "eyJ0eXAiOiJKV1QiLCJhbGc...",
    "user": {
      "username": "JGOMEZ",
      "id": "5",
      ...
    }
  }
}
```

### 2. **Error de Base de Datos: `escenario_id does not exist`**
**Problema:** El código usaba `escenario_id` pero la columna en Supabase se llama `escenario`.

**Solución:** Actualizado `app/api/pedidos-pendientes/route.ts` para usar `escenario`.

---

## 📝 Archivos Modificados

### 1. **app/api/proxy/[...path]/route.ts**
```diff
- // Copiar Cookie header si existe
- const cookieHeader = request.headers.get('Cookie');
- if (cookieHeader) {
-   headers['Cookie'] = cookieHeader;
- }
+ // NO enviar cookies del navegador - pueden causar conflictos
+ // La API parece generar su propio GX_CLIENT_ID
```

**Cambios:**
- ✅ Deshabilitado envío de cookies
- ✅ Mejorado logging (muestra headers de respuesta)
- ✅ Mejor manejo de JSON en respuestas

### 2. **app/api/pedidos-pendientes/route.ts**
```diff
- escenario_id,
+ escenario,
...
- .eq('escenario_id', escenarioId)
+ .eq('escenario', escenarioId)
```

---

## 🚀 Para Aplicar en Linux

```bash
# 1. Conectarse al servidor
ssh riogas@node

# 2. Ir al proyecto
cd ~/trackmovil

# 3. Hacer pull
git pull origin main

# 4. Ver los cambios
git log --oneline -3

# Deberías ver:
# bd2926d fix: Change escenario_id to escenario in pedidos query
# b8cd4b6 fix: Remove cookie forwarding in proxy and improve logging - Login now works
# 47fdd2d docs: Add ready-to-apply summary for Linux deployment

# 5. Reconstruir imagen Docker
docker build -t trackmovil:latest .

# 6. Reiniciar contenedor
docker stop trackmovil
docker rm trackmovil
docker run -d \
  --name trackmovil \
  -p 3001:3000 \
  --env-file .env.production \
  --restart unless-stopped \
  trackmovil:latest

# 7. Ver logs
docker logs -f trackmovil
```

**O usar el script:**
```bash
cd ~/trackmovil
./scripts/update-trackmovil.sh
```

---

## ✅ Verificación

### 1. Probar Login
```
http://192.168.7.14:3001/login
```

**Credenciales de prueba:**
- Usuario: `jgomez`
- Password: `VeintiunoDeOctubre!`

**Resultado esperado:**
- ✅ Login exitoso
- ✅ Redirección a dashboard
- ✅ Token JWT guardado
- ✅ Nombre de usuario visible en navbar

### 2. Ver Logs del Servidor
```bash
docker logs --tail 100 trackmovil | grep -E "Proxy|Response"
```

**Deberías ver:**
```
🔄 Proxy POST http://192.168.1.72:8082/puestos/gestion/login
📤 Headers: { 'Content-Type': 'application/json', Accept: 'application/json' }
📤 Body: {"UserName":"jgomez","Password":"..."}
📥 Response Status: 200
📥 Response Data: {"RespuestaLogin": "...success\":true..."}
POST /api/proxy/puestos/gestion/login 200 in ~7000ms
```

---

## 🔍 Troubleshooting

### Si el login sigue fallando

**1. Verificar variables de entorno:**
```bash
docker exec trackmovil printenv | grep API
```

Debe mostrar:
```
EXTERNAL_API_URL=http://192.168.1.72:8082
NEXT_PUBLIC_EXTERNAL_API_URL=http://192.168.1.72:8082
```

**2. Si no están configuradas:**
```bash
cd ~/trackmovil
./scripts/update-env-api.sh
```

**3. Verificar que la API esté accesible:**
```bash
curl -X POST http://192.168.1.72:8082/puestos/gestion/login \
  -H "Content-Type: application/json" \
  -d '{"UserName":"jgomez","Password":"VeintiunoDeOctubre!"}'
```

---

## 📊 Commits Realizados

1. **b8cd4b6** - `fix: Remove cookie forwarding in proxy and improve logging - Login now works`
   - Deshabilitado reenvío de cookies que causaban error 500
   - Mejorado logging del proxy

2. **bd2926d** - `fix: Change escenario_id to escenario in pedidos query`
   - Corregido nombre de columna en queries de pedidos

3. **47fdd2d** - `docs: Add ready-to-apply summary for Linux deployment`
   - Documentación de configuración de API

4. **ac7ff9c** - `feat: Add script to update API configuration`
   - Script automático para actualizar .env

5. **5759bea** - `docs: Add quick reference guide`
   - Guía rápida de actualización

---

## 🎊 Estado Final

✅ **Login funcionando** en desarrollo (Windows)  
✅ **Código subido** a GitHub  
⏳ **Pendiente:** Aplicar en producción (Linux)

**Próximo paso:** Ejecutar `git pull` en el servidor Linux y reconstruir el contenedor.

---

**Fecha:** 2025-12-11  
**Commits:** 2 nuevos (login fix + pedidos fix)  
**Tiempo estimado para deploy:** 3-5 minutos
