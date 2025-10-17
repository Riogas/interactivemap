# 🔧 Configuración IBM DB2 para TrackMovil

## ✅ Migración Completada: ODBC → IBM_DB

Hemos migrado de `odbc` a `ibm_db` (driver oficial de IBM) para mejorar la compatibilidad y evitar problemas con módulos nativos.

---

## 📋 Variables de Entorno

Configura estas variables en tu archivo `.env.local`:

```env
# Database Configuration (IBM DB2 AS400)
DB_HOST=192.168.1.8          # IP del servidor AS400
DB_PORT=50000                # Puerto por defecto de DB2
DB_USER=qsecofr              # Usuario de la base de datos
DB_PASSWORD=wwm868           # Contraseña
DB_SCHEMA=GXICAGEO           # Esquema donde está la tabla

# Modo de operación
DB_MODE=mock                 # 'mock' para datos de prueba, 'real' para DB2
```

---

## 🎯 Modos de Operación

### Modo MOCK (Desarrollo)
```env
DB_MODE=mock
```
- ✅ **Sin necesidad de conexión a DB2**
- ✅ Datos de prueba realistas
- ✅ Funciona sin drivers nativos
- ✅ Ideal para desarrollo local

### Modo REAL (Producción)
```env
DB_MODE=real
```
- 🔌 Conecta a DB2 AS400 real
- 📊 Datos en tiempo real desde `LOGCOORDMOVIL`
- ⚠️ Requiere acceso de red a 192.168.1.8
- 🔐 Usa credenciales reales

---

## 🚀 Ventajas de IBM_DB vs ODBC

| Característica | ODBC | IBM_DB |
|---------------|------|--------|
| **Driver oficial IBM** | ❌ No | ✅ Sí |
| **Compilación nativa** | ⚠️ Compleja | ✅ Automática |
| **Compatibilidad AS400** | ⚠️ Limitada | ✅ Completa |
| **Performance** | 🟡 Media | ✅ Alta |
| **Documentación** | 🟡 Limitada | ✅ Excelente |
| **Mantenimiento** | ⚠️ Bajo | ✅ Activo |

---

## 🔍 Verificar Conexión

### 1. Con Datos Mock (Sin DB2)
```bash
# En .env.local
DB_MODE=mock

# Ejecutar
pnpm dev

# Deberías ver en consola:
🔵 Using MOCK data (DB_MODE=mock)
```

### 2. Con DB2 Real
```bash
# En .env.local
DB_MODE=real

# Ejecutar
pnpm dev

# Deberías ver en consola:
🔴 Attempting REAL DB2 connection (DB_MODE=real)...
🔌 Connecting to DB2 AS400 at 192.168.1.8:50000...
✅ Connected to DB2 AS400 at 192.168.1.8
📡 Executing query for movil: 693
✅ Retrieved X coordinates for movil 693
```

---

## 🛠️ Troubleshooting

### Error: "Cannot connect to DB2"
```bash
# Verificar conectividad de red
ping 192.168.1.8

# Verificar puerto abierto (requiere telnet)
Test-NetConnection 192.168.1.8 -Port 50000
```

**Soluciones:**
1. ✅ Verificar que el servidor AS400 esté encendido
2. ✅ Comprobar firewall/VPN
3. ✅ Validar credenciales (usuario/password)
4. ✅ Confirmar que el puerto 50000 esté abierto
5. ⚠️ Si falla, la app automáticamente usa MOCK data

### Error: "ibm_db build failed"
```bash
# Reinstalar con build
pnpm remove ibm_db
pnpm add ibm_db
pnpm approve-builds ibm_db
```

### Modo Mock no funciona
```bash
# Verificar .env.local
cat .env.local | findstr DB_MODE

# Debe mostrar:
DB_MODE=mock

# Limpiar caché y reiniciar
Remove-Item -Recurse -Force .next
pnpm dev
```

---

## 📦 Dependencias

```json
{
  "dependencies": {
    "ibm_db": "^3.3.4"  // Driver oficial IBM para DB2
  }
}
```

---

## 🔐 Seguridad

### ⚠️ IMPORTANTE: 
- **NUNCA** commitear el archivo `.env.local` con credenciales reales
- Usar variables de entorno en producción
- Considerar usar Azure Key Vault o AWS Secrets Manager
- Rotar contraseñas regularmente

### Configuración de Producción
```bash
# En tu servidor/cloud, configurar:
export DB_HOST=192.168.1.8
export DB_USER=qsecofr
export DB_PASSWORD=tu_password_seguro
export DB_SCHEMA=GXICAGEO
export DB_MODE=real
```

---

## 📊 Estructura de la Tabla

```sql
-- Tabla: GXICAGEO.LOGCOORDMOVIL
LOGCOORDMOVILIDENTIFICADOR  INT      -- ID del vehículo (693, 251, 337)
LOGCOORDMOVILORIGEN         VARCHAR  -- Origen de la coordenada
LOGCOORDMOVILCOORDX         DECIMAL  -- Latitud
LOGCOORDMOVILCOORDY         DECIMAL  -- Longitud
LOGCOORDMOVILFCHINSLOG      TIMESTAMP-- Fecha/hora del registro
LOGCOORDMOVILAUXIN2         VARCHAR  -- Información adicional
LOGCOORDMOVILDISTRECORRIDA  DECIMAL  -- Distancia recorrida
```

---

## ✨ Características del Sistema

- 🗺️ **Mapa en tiempo real** con OpenStreetMap
- 🔄 **Auto-refresh** cada 5 segundos
- 📍 **Tracking de 3 vehículos**: 693, 251, 337
- 💫 **Animaciones suaves** con Framer Motion
- 🎯 **Marcadores personalizados** con efecto pulse
- 📱 **Diseño responsive** para móviles
- 🔌 **Fallback automático** a datos mock si falla DB2

---

## 🆘 Soporte

Si encuentras problemas:

1. Verifica los logs del servidor (`pnpm dev`)
2. Revisa el archivo `.env.local`
3. Prueba con `DB_MODE=mock` primero
4. Consulta la documentación de [ibm_db](https://github.com/ibmdb/node-ibm_db)

---

**Última actualización:** Octubre 2025  
**Versión:** 1.0.0 con IBM_DB
