# 🔧 Configuración de API de Login

## ⚠️ Problema Resuelto: Error de conexión con el servidor

### Síntoma
Al intentar hacer login, aparecía el error: **"Error de conexión con el servidor"**

### Causa
La aplicación intentaba conectarse a una API incorrecta configurada en las variables de entorno.

### Solución

#### 1. API de Login Correcta
```
Base URL: http://192.168.1.72:8082
Endpoint: /puestos/gestion/login
URL Completa: http://192.168.1.72:8082/puestos/gestion/login
```

#### 2. Actualizar .env.production en el Servidor Linux

**Ubicación:** `~/trackmovil/.env.production`

**Variables a configurar:**
```bash
# API Externa - URL de Login
EXTERNAL_API_URL=http://192.168.1.72:8082
NEXT_PUBLIC_EXTERNAL_API_URL=http://192.168.1.72:8082
```

#### 3. Proceso Completo de Actualización

**En Windows (tu máquina local):**
```powershell
# Ya actualizado el .env.production local
# El archivo .env.production NO se sube a Git (está en .gitignore)
```

**En Linux (servidor node):**
```bash
# Conectarse al servidor
ssh riogas@node

# Ir a la carpeta del proyecto
cd ~/trackmovil

# Editar el archivo .env.production
nano .env.production

# Buscar la línea EXTERNAL_API_URL y cambiarla a:
EXTERNAL_API_URL=http://192.168.1.72:8082

# También agregar (si no existe):
NEXT_PUBLIC_EXTERNAL_API_URL=http://192.168.1.72:8082

# Guardar: Ctrl+O, Enter
# Salir: Ctrl+X

# Reconstruir la imagen Docker con la nueva configuración
docker build -t trackmovil:latest .

# Detener el contenedor actual
docker stop trackmovil

# Eliminar el contenedor
docker rm trackmovil

# Iniciar nuevo contenedor con la configuración actualizada
docker run -d \
  --name trackmovil \
  -p 3001:3000 \
  --env-file .env.production \
  --restart unless-stopped \
  trackmovil:latest

# Ver los logs para verificar
docker logs -f trackmovil
```

#### 4. Verificar el Cambio

1. **Abrir la aplicación:**
   ```
   http://192.168.7.14:3001/login
   ```

2. **Intentar hacer login** con credenciales válidas

3. **Verificar en las herramientas de desarrollo del navegador:**
   - Abrir DevTools (F12)
   - Pestaña "Network"
   - Al hacer login, debería aparecer una petición a:
     ```
     /api/proxy/puestos/gestion/login
     ```
   - Esta petición se redirige internamente a:
     ```
     http://192.168.1.72:8082/puestos/gestion/login
     ```

#### 5. Script de Actualización Automática

**Opción rápida - script ya creado:**
```bash
cd ~/trackmovil
./scripts/update-trackmovil.sh
```

Este script hace automáticamente:
- git pull (si hay cambios en el código)
- docker build
- docker stop/rm
- docker run

**⚠️ IMPORTANTE:** El script `update-trackmovil.sh` NO actualizará el `.env.production` porque este archivo no está en Git. Debes editarlo manualmente la primera vez.

---

## 📋 Resumen de Archivos Involucrados

### lib/api/config.ts
Este archivo **YA está configurado correctamente** para usar variables de entorno:

```typescript
export const API_BASE_URL = 
  process.env.EXTERNAL_API_URL || 
  process.env.NEXT_PUBLIC_EXTERNAL_API_URL || 
  'http://localhost:8000';
```

### .env.production (en el servidor Linux)
**Debe contener:**
```bash
EXTERNAL_API_URL=http://192.168.1.72:8082
NEXT_PUBLIC_EXTERNAL_API_URL=http://192.168.1.72:8082
```

### .env.production.template (en Git)
Plantilla de referencia con todas las variables necesarias. Se puede usar como base para crear el `.env.production` en nuevos servidores.

---

## 🔍 Flujo de Autenticación

```
Usuario → Login Form
  ↓
authService.login(username, password)
  ↓
apiClient.post('/puestos/gestion/login')
  ↓
Proxy Interno: /api/proxy/puestos/gestion/login
  ↓
API Externa: http://192.168.1.72:8082/puestos/gestion/login
  ↓
Respuesta con token JWT
  ↓
Almacenar en localStorage
  ↓
Redireccionar a dashboard
```

---

## 🚨 Troubleshooting

### Error: "Error de conexión con el servidor"
- **Causa:** URL de API incorrecta en .env.production
- **Solución:** Verificar que EXTERNAL_API_URL apunte a http://192.168.1.72:8082

### Error: "Network Error" o "ERR_CONNECTION_REFUSED"
- **Causa:** La API en http://192.168.1.72:8082 no está corriendo
- **Solución:** Verificar que el servidor de API esté activo y accesible

### Error: 401 Unauthorized
- **Causa:** Credenciales incorrectas
- **Solución:** Verificar usuario y contraseña

### Error: 404 Not Found
- **Causa:** Ruta incorrecta en la API
- **Solución:** Verificar que el endpoint sea exactamente `/puestos/gestion/login`

---

## ✅ Checklist de Implementación

- [x] Actualizar .env.production local con API correcta
- [x] Crear .env.production.template para referencia
- [x] Documentar proceso de actualización
- [ ] SSH al servidor Linux
- [ ] Editar .env.production en ~/trackmovil
- [ ] Reconstruir imagen Docker
- [ ] Reiniciar contenedor
- [ ] Probar login
- [ ] Verificar en Network DevTools

---

**Última actualización:** $(date)
**API de Login:** http://192.168.1.72:8082/puestos/gestion/login
