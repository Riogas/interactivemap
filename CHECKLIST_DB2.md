# ✅ CHECKLIST: Configurar TrackMovil con Datos Reales DB2

## 🎯 Objetivo
Conectar la aplicación TrackMovil a la base de datos DB2 AS400 real en `192.168.1.8`.

---

## 📋 Checklist de Configuración

### Requisitos Previos

- [ ] **Node.js** instalado (v18+)
- [ ] **pnpm** instalado
- [ ] **Windows PowerShell** disponible
- [ ] **Acceso a la red** donde está el servidor 192.168.1.8

---

### Paso 1: Verificar Driver ODBC

- [ ] Abrir **Panel de Control** → **Herramientas administrativas**
- [ ] Abrir **Orígenes de datos ODBC (64 bits)**
- [ ] Ir a pestaña **Controladores**
- [ ] Buscar: `IBM i Access ODBC Driver`

**¿Lo encontraste?**
- ✅ **SÍ** → Continuar al Paso 2
- ❌ **NO** → Instalar desde: https://www.ibm.com/support/pages/ibm-i-access-client-solutions

---

### Paso 2: Verificar Conectividad

Abrir PowerShell y ejecutar:

```powershell
ping 192.168.1.8
```

**Resultado esperado:**
```
Respuesta desde 192.168.1.8: bytes=32 tiempo<1ms TTL=128
```

- [ ] El servidor responde correctamente

**Si no responde:**
- [ ] ¿Estás en la red correcta?
- [ ] ¿VPN está activa (si es necesario)?
- [ ] ¿Firewall no está bloqueando?

---

### Paso 3: Configurar Variables de Entorno

Abrir el archivo `.env.local` en el proyecto

- [ ] Cambiar `DB_MODE=mock` por `DB_MODE=real`

El archivo debe quedar así:

```env
# Database Configuration
DB_CONNECTION_STRING=DRIVER={IBM i Access ODBC Driver};SYSTEM=192.168.1.8;UID=qsecofr;PWD=wwm668;
DB_SCHEMA=GXICAGEO

# Set to 'real' to use actual DB2 connection, 'mock' for test data
DB_MODE=real    ← ✅ Cambiar aquí
```

- [ ] Guardar el archivo

---

### Paso 4: Compilar Módulo ODBC

En PowerShell, en la raíz del proyecto:

```powershell
pnpm rebuild odbc
```

**¿Obtuviste un error?**

Si ves error sobre compilación, instalar herramientas:

```powershell
npm install --global windows-build-tools
```

Luego reintentar:

```powershell
pnpm rebuild odbc
```

- [ ] Módulo compilado exitosamente (o sin errores críticos)

---

### Paso 5: Iniciar Aplicación

```powershell
pnpm dev
```

- [ ] Servidor inició sin errores

---

### Paso 6: Verificar Conexión

**En la terminal**, buscar estos mensajes:

```
✅ Connected to DB2 AS400 at 192.168.1.8
📡 Executing query for movil: 693 from date: 2025-10-14 00:00:00
✅ Retrieved X coordinates for movil 693
```

- [ ] Veo el mensaje "Connected to DB2 AS400"
- [ ] Veo el mensaje "Retrieved X coordinates"

**Si ves errores:**
- Consultar `SETUP_DB2.md` para solución de problemas

---

### Paso 7: Verificar en Navegador

Abrir: http://localhost:3000

**Verificar:**
- [ ] El mapa se carga correctamente
- [ ] Veo marcadores de móviles en el mapa
- [ ] Los marcadores están en posiciones reales (Paraguay)
- [ ] Al hacer clic en un móvil, veo información real
- [ ] El indicador "En vivo" está parpadeando
- [ ] Los datos se actualizan automáticamente

---

### Paso 8: Verificar Datos Reales

**En el panel de información (derecha):**
- [ ] Veo móvil 693
- [ ] Veo móvil 251
- [ ] Veo móvil 337
- [ ] Cada uno tiene coordenadas distintas
- [ ] Las fechas/horas son actuales
- [ ] Los estados muestran datos reales

---

## 🎉 ¡Configuración Completada!

Si completaste todos los pasos con ✅, tu aplicación está conectada a la base de datos DB2 real.

---

## 🚨 Solución Rápida de Problemas

### No veo el mensaje "Connected to DB2"

1. Verificar que `.env.local` tiene `DB_MODE=real`
2. Verificar driver ODBC instalado
3. Verificar conectividad: `ping 192.168.1.8`
4. Revisar credenciales en `.env.local`

### Error "Module did not self-register"

```powershell
Remove-Item -Recurse -Force node_modules
pnpm install
pnpm rebuild odbc
```

### No hay marcadores en el mapa

1. Abrir consola del navegador (F12)
2. Buscar errores en red
3. Verificar que hay datos en la tabla:
   ```sql
   SELECT COUNT(*) FROM GXICAGEO.LOGCOORDMOVIL 
   WHERE LOGCOORDMOVILFCHINSLOG >= CURRENT_DATE
   ```

### Las coordenadas no son correctas

Verificar en la base de datos:
- `LOGCOORDMOVILCOORDX` debe ser longitud (ejemplo: -57.xxxx)
- `LOGCOORDMOVILCOORDY` debe ser latitud (ejemplo: -25.xxxx)

---

## 🤖 Script Automático

En lugar de hacer todo manual, ejecuta:

```powershell
.\setup-db2.ps1
```

El script verifica automáticamente:
- ✅ Driver ODBC
- ✅ Conectividad
- ✅ Configuración
- ✅ Compilación ODBC

---

## 📚 Documentación de Ayuda

- **CONFIGURACION_REAL.md** - Guía completa paso a paso
- **SETUP_DB2.md** - Solución de problemas detallada
- **ESTRUCTURA_PROYECTO.md** - Estructura del código
- **README.md** - Documentación general

---

## 📞 ¿Necesitas Ayuda?

Si después de seguir esta checklist aún tienes problemas:

1. **Captura de pantalla** del error en terminal
2. **Captura de pantalla** de la consola del navegador (F12)
3. **Resultado** de: `ping 192.168.1.8`
4. **Contenido** de `.env.local` (sin mostrar contraseña)

---

## 🔄 Volver al Modo Mock

Si necesitas volver a datos de prueba:

```env
# En .env.local
DB_MODE=mock
```

Reiniciar: `pnpm dev`

---

**¡Mucha suerte! 🚀**
