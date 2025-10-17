# 🚗 TrackMovil - Configuración para Datos Reales (DB2 AS400)

## 📝 Resumen

Tu aplicación está **lista para usar datos reales** de la base de datos DB2 AS400 ubicada en `192.168.1.8`.

Actualmente está configurada en **modo MOCK** (datos de prueba) para que puedas probarla inmediatamente. Para cambiar a datos reales, sigue esta guía.

---

## 🎯 Configuración Rápida (3 Pasos)

### Paso 1: Verificar Requisitos

**¿Tienes instalado el driver IBM i Access ODBC?**

Para verificar:
1. Abre **Panel de Control** → **Herramientas administrativas** → **Orígenes de datos ODBC (64 bits)**
2. Ve a **Controladores**
3. Busca: `IBM i Access ODBC Driver`

- ✅ **SÍ lo tengo** → Continúa al Paso 2
- ❌ **NO lo tengo** → [Descargar e instalar](https://www.ibm.com/support/pages/ibm-i-access-client-solutions)

### Paso 2: Cambiar a Modo Real

Edita el archivo `.env.local` y cambia:

```env
# Cambiar esta línea:
DB_MODE=mock

# Por esta:
DB_MODE=real
```

### Paso 3: Compilar módulo ODBC

```powershell
pnpm rebuild odbc
```

Si obtienes un error, ejecuta primero:
```powershell
npm install --global windows-build-tools
```

---

## 🚀 Iniciar la Aplicación

```powershell
pnpm dev
```

Abre http://localhost:3000

---

## ✅ ¿Cómo sé que está funcionando?

### En la terminal verás:

```
✅ Connected to DB2 AS400 at 192.168.1.8
📡 Executing query for movil: 693 from date: 2025-10-14 00:00:00
✅ Retrieved X coordinates for movil 693
```

### En la aplicación web:

- Los móviles aparecerán en el mapa en sus posiciones reales
- Los datos se actualizarán automáticamente cada 5 segundos
- Verás información real: estado, distancia, coordenadas

---

## 🔧 Script Automático de Configuración

Ejecuta este script PowerShell que verifica todo automáticamente:

```powershell
.\setup-db2.ps1
```

El script verifica:
- ✅ Driver ODBC instalado
- ✅ Conectividad al servidor 192.168.1.8
- ✅ Configuración correcta
- ✅ Compilación del módulo ODBC

---

## 🗂️ Configuración Actual

### Servidor DB2 AS400
- **Host:** 192.168.1.8
- **Usuario:** qsecofr
- **Contraseña:** wwm668 (⚠️ Ya configurada en `.env.local`)

### Base de Datos
- **Schema:** GXICAGEO
- **Tabla:** LOGCOORDMOVIL

### Móviles Rastreados
- 🚙 **Móvil 693** (Azul)
- 🚙 **Móvil 251** (Rojo)
- 🚙 **Móvil 337** (Verde)

### Consulta SQL utilizada

```sql
SELECT 
  LOGCOORDMOVILIDENTIFICADOR as identificador,
  LOGCOORDMOVILORIGEN as origen,
  LOGCOORDMOVILCOORDX as coordX,
  LOGCOORDMOVILCOORDY as coordY,
  LOGCOORDMOVILFCHINSLOG as fechaInsLog,
  LOGCOORDMOVILAUXIN2 as auxIn2,
  LOGCOORDMOVILDISTRECORRIDA as distRecorrida
FROM GXICAGEO.LOGCOORDMOVIL
WHERE LOGCOORDMOVILFCHINSLOG >= '2025-10-14 00:00:00'
  AND LOGCOORDMOVILIDENTIFICADOR = ?
ORDER BY LOGCOORDMOVILFCHINSLOG DESC
FETCH FIRST 100 ROWS ONLY
```

---

## 🐛 Problemas Comunes

### "No se puede conectar al servidor"

**Solución:**
```powershell
ping 192.168.1.8
```
- Si no responde: verifica red, VPN, firewall

### "Module did not self-register" (error de ODBC)

**Solución:**
```powershell
Remove-Item -Recurse -Force node_modules
pnpm install
pnpm rebuild odbc
```

### "No hay datos en el mapa"

**Verificar:**
1. ¿Hay datos recientes en la tabla?
   ```sql
   SELECT COUNT(*) 
   FROM GXICAGEO.LOGCOORDMOVIL 
   WHERE LOGCOORDMOVILFCHINSLOG >= CURRENT_DATE
   ```
2. ¿Las coordenadas son válidas? (latitud/longitud de Paraguay)
3. Revisar logs en la terminal del servidor

### "Error de autenticación"

**Solución:**
- Verificar usuario y contraseña con el administrador
- Confirmar permisos en la tabla LOGCOORDMOVIL

---

## 🔄 Volver al Modo Mock

Si tienes problemas y quieres usar datos de prueba:

```env
# En .env.local
DB_MODE=mock
```

Reinicia: `pnpm dev`

---

## 📚 Documentación Adicional

- **SETUP_DB2.md** - Guía detallada de configuración
- **README.md** - Documentación general del proyecto
- **setup-db2.ps1** - Script automático de configuración

---

## 🎨 Características de la Aplicación

- ✨ **Tiempo real** - Actualización automática cada 3-30 segundos (configurable)
- 🗺️ **Mapa interactivo** - OpenStreetMap con marcadores animados
- 📊 **Panel de información** - Estado, distancia, coordenadas en tiempo real
- 🎯 **Selector de móviles** - Vista individual o todos a la vez
- 📱 **Responsive** - Funciona en desktop, tablet y móvil
- 🎭 **Animaciones** - Transiciones suaves con Framer Motion

---

## 💡 Tips

### Optimizar rendimiento

Si tienes muchos datos:
```env
# Limitar consulta a las últimas 24 horas
# Editar lib/db.ts, línea del dateFilter
```

### Agregar más móviles

Editar `types/index.ts`:
```typescript
export const AVAILABLE_MOVILES: MovilData[] = [
  { id: 693, name: 'Móvil 693', color: '#3b82f6' },
  { id: 251, name: 'Móvil 251', color: '#ef4444' },
  { id: 337, name: 'Móvil 337', color: '#10b981' },
  { id: 999, name: 'Móvil 999', color: '#f59e0b' }, // ← Agregar aquí
];
```

### Cambiar frecuencia de actualización

En la aplicación web (header), selecciona:
- 3 segundos (muy frecuente)
- 5 segundos (recomendado) ← **Default**
- 10 segundos
- 30 segundos (bajo uso)

---

## 📞 Soporte

### Logs importantes

**Terminal del servidor:**
```
✅ Connected to DB2 AS400 at 192.168.1.8
📡 Executing query for movil: XXX
✅ Retrieved N coordinates
```

**Consola del navegador (F12):**
- Errores de red
- Respuestas de API
- Errores JavaScript

### Información para reportar problemas

Si necesitas ayuda, proporciona:
1. ✅ Mensaje de error exacto
2. ✅ Logs de la terminal
3. ✅ Logs de consola del navegador (F12)
4. ✅ Sistema operativo y versión de Node.js
5. ✅ Resultado de: `ping 192.168.1.8`

---

## 🎉 ¡Todo listo!

Tu aplicación TrackMovil está configurada y lista para rastrear tus móviles en tiempo real.

**Comandos principales:**

```powershell
# Modo desarrollo
pnpm dev

# Build para producción
pnpm build

# Ejecutar en producción
pnpm start

# Compilar ODBC
pnpm rebuild odbc

# Setup automático
.\setup-db2.ps1
```

**¡Disfruta tu aplicación de rastreo! 🚀🗺️**
