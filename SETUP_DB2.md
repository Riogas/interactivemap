# 🔧 Configuración de Conexión DB2 AS400

Esta guía te ayudará a configurar la conexión real a la base de datos DB2 AS400.

## 📋 Requisitos Previos

### 1. Instalar IBM i Access ODBC Driver

**Opción A: IBM i Access Client Solutions (Recomendado)**

1. Descarga IBM i Access Client Solutions desde:
   - https://www.ibm.com/support/pages/ibm-i-access-client-solutions
   - O solicita el instalador a tu administrador de sistemas

2. Ejecuta el instalador `AccessClientSolutions_x64.exe`

3. Durante la instalación, asegúrate de seleccionar:
   - ✅ ODBC Driver
   - ✅ Client Access

4. Reinicia tu computadora después de la instalación

**Opción B: Verificar si ya está instalado**

1. Abre **Panel de Control** → **Herramientas administrativas** → **Orígenes de datos ODBC (64 bits)**
2. Ve a la pestaña **Controladores**
3. Busca: `IBM i Access ODBC Driver`

Si lo ves listado, ¡ya está instalado! ✅

### 2. Verificar Conectividad de Red

Prueba la conexión al servidor AS400:

```powershell
ping 192.168.1.8
```

Debería responder con éxito. Si no, verifica:
- 🔌 Que estés conectado a la red correcta
- 🔥 Firewall no esté bloqueando
- 🌐 VPN esté activa (si es necesario)

## ⚙️ Configuración de la Aplicación

### 1. Editar variables de entorno

Abre el archivo `.env.local` y configura:

```env
# Cambiar de 'mock' a 'real' para usar datos reales
DB_MODE=real

# Configuración del servidor (ya está configurado)
DB_CONNECTION_STRING=DRIVER={IBM i Access ODBC Driver};SYSTEM=192.168.1.8;UID=qsecofr;PWD=wwm668;
DB_SCHEMA=GXICAGEO
```

### 2. Compilar módulo ODBC nativo

El módulo `odbc` necesita ser compilado para Node.js:

```powershell
# En la raíz del proyecto
pnpm rebuild odbc
```

Si encuentras errores, necesitarás:

**Instalar herramientas de compilación:**

```powershell
# Opción 1: Usando npm (más rápido)
npm install --global windows-build-tools

# Opción 2: Manual
# - Instalar Visual Studio Build Tools 2019 o superior
# - Incluir "Desktop development with C++"
```

Luego reintenta:

```powershell
pnpm rebuild odbc
```

## 🚀 Probar la Conexión

### 1. Reiniciar el servidor de desarrollo

```powershell
# Detener el servidor actual (Ctrl+C)
# Iniciar nuevamente
pnpm dev
```

### 2. Verificar logs en consola

Cuando la aplicación cargue, deberías ver en la terminal:

```
✅ Connected to DB2 AS400 at 192.168.1.8
📡 Executing query for movil: 693 from date: 2025-10-14 00:00:00
✅ Retrieved X coordinates for movil 693
```

### 3. Abrir la aplicación

Navega a http://localhost:3000

Si ves datos reales en el mapa, ¡funcionó! 🎉

## 🐛 Solución de Problemas

### Error: "Module did not self-register"

**Causa:** El módulo ODBC no está compilado correctamente

**Solución:**
```powershell
# Limpiar y reinstalar
Remove-Item -Recurse -Force node_modules
pnpm install
pnpm rebuild odbc
```

### Error: "Cannot find module 'odbc'"

**Causa:** El módulo no se instaló correctamente

**Solución:**
```powershell
pnpm add odbc
pnpm rebuild odbc
```

### Error: "IM002 Data source name not found"

**Causa:** El driver ODBC no está instalado o el nombre es incorrecto

**Solución:**
1. Verifica que el driver esté instalado (ver Requisitos Previos)
2. Verifica el nombre exacto en ODBC Data Sources
3. Actualiza `.env.local` con el nombre correcto:
   ```env
   # Prueba con estas variantes:
   DRIVER={IBM i Access ODBC Driver}
   # o
   DRIVER={iSeries Access ODBC Driver}
   ```

### Error: "SQL30081N A communication error has been detected"

**Causa:** No se puede conectar al servidor

**Solución:**
1. Verifica conectividad: `ping 192.168.1.8`
2. Verifica que el puerto esté abierto (por defecto: 446)
3. Confirma credenciales con administrador
4. Verifica firewall/antivirus

### Error: "Database connection failed"

**Causa:** Credenciales incorrectas o permisos insuficientes

**Solución:**
1. Verifica usuario y contraseña en `.env.local`
2. Confirma que el usuario `qsecofr` tiene acceso a `GXICAGEO.LOGCOORDMOVIL`
3. Prueba las credenciales con IBM i Navigator u otra herramienta

## 📊 Verificar Datos en la Base

Puedes verificar que hay datos disponibles usando IBM i Navigator o cualquier cliente SQL:

```sql
SELECT COUNT(*) 
FROM GXICAGEO.LOGCOORDMOVIL 
WHERE LOGCOORDMOVILFCHINSLOG >= '2025-10-14 00:00:00' 
  AND LOGCOORDMOVILIDENTIFICADOR IN (693, 251, 337);
```

Debería devolver un número > 0.

## 🔄 Volver al Modo Mock

Si tienes problemas y quieres volver a usar datos de prueba:

```env
# En .env.local
DB_MODE=mock
```

Reinicia el servidor:

```powershell
pnpm dev
```

## 📞 Contacto

Si sigues teniendo problemas:
1. Revisa los logs completos en la terminal
2. Copia el mensaje de error exacto
3. Contacta al administrador de sistemas con:
   - Mensaje de error
   - IP del servidor: 192.168.1.8
   - Usuario: qsecofr
   - Schema: GXICAGEO

---

## ✅ Checklist de Verificación

Antes de reportar un problema, verifica:

- [ ] IBM i Access ODBC Driver está instalado
- [ ] `ping 192.168.1.8` responde exitosamente
- [ ] `.env.local` tiene `DB_MODE=real`
- [ ] String de conexión es correcto
- [ ] Módulo `odbc` está compilado (`pnpm rebuild odbc`)
- [ ] Servidor de desarrollo reiniciado después de cambios
- [ ] Revisar logs en la terminal
- [ ] Hay datos recientes en la tabla LOGCOORDMOVIL

¡Buena suerte! 🚀
