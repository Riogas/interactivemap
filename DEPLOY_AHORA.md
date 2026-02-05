# 🚀 DEPLOY URGENTE - Fix Login + GPS Timeout

## 📋 Commits Pendientes de Desplegar

1. **232cbb1** - Fix: Evitar doble parseo de JSON en authService
2. **ec26a75** - Fix: Agregar timeout y fallback a GPS batch queue

---

## 🔧 COMANDOS PARA EJECUTAR

### **1. Conectar al Servidor**
```bash
ssh jgomez@192.168.7.13
```

### **2. Navegar al Proyecto**
```bash
cd /var/www/track
```

### **3. Verificar Estado Actual**
```bash
git status
git log --oneline -5
```

**Deberías ver:**
- `7fdedb3` como último commit (VIEJO)

### **4. Pull de Cambios**
```bash
git pull origin main
```

**Deberías ver:**
```
Updating 7fdedb3..ec26a75
Fast-forward
 lib/api/auth.ts            | 16 ++++++++++------
 lib/gps-batch-queue.ts     | 69 +++++++++++++++++++++++++++++++++++++++++++++++------
 2 files changed, 73 insertions(+), 12 deletions(-)
```

### **5. Verificar Nuevos Commits**
```bash
git log --oneline -5
```

**Deberías ver:**
```
ec26a75 fix: Agregar timeout y fallback a GPS batch queue
232cbb1 fix: Evitar doble parseo de JSON en authService
7fdedb3 fix: Add manual timeout to proxy general route
```

### **6. Limpiar Build Anterior**
```bash
rm -rf .next
```

### **7. Instalar Dependencias (por si acaso)**
```bash
pnpm install
```

### **8. Rebuild del Proyecto**
```bash
pnpm build
```

**Esto tardará 2-3 minutos. Deberías ver:**
```
✓ Compiled successfully
✓ Collecting page data
✓ Generating static pages
```

### **9. Reiniciar PM2**
```bash
pm2 restart track
```

### **10. Ver Logs en Tiempo Real**
```bash
pm2 logs track --lines 50
```

---

## ✅ Verificación Post-Deploy

### **Test 1: Login**
1. Ir a https://track.riogas.com.uy/login
2. Ingresar credenciales
3. **Esperado:** Login exitoso, sin error JSON.parse

**Ver logs:**
```bash
pm2 logs track --lines 500 | grep -A5 "RespuestaLogin"
```

**Deberías ver:**
```
✅ Fetch completado en 6780ms
🔄 RespuestaLogin parseado: { success: true, token: "...", user: {...} }
📤 RETORNANDO AL CLIENTE
```

### **Test 2: GPS Timeout**
Esperar 5 minutos y ver logs de GPS:

```bash
pm2 logs track --lines 200 | grep -E "(Batch insertado|Error en intento|TIMEOUT)"
```

**Esperado:**
```
✅ Batch insertado exitosamente
   - Registros: 50
   - Duración: 423ms
```

**SI aparece timeout:**
```
❌ Error en intento 1/3:
   ⏱️ TIMEOUT: Supabase no respondió en 15 segundos
⏳ Esperando 2000ms antes de reintentar...
✅ Batch insertado exitosamente (intento 2)
```

### **Test 3: Sin Pérdida de Datos**
```bash
pm2 logs track --lines 500 | grep "BATCH FALLIDO"
```

**Esperado:** Sin resultados (no debería fallar)

**SI falla (muy raro):**
```
💥 BATCH FALLIDO después de 3 intentos
💾 Batch guardado en: /var/www/track/failed-batches/failed-batch-2026-02-05T14-30-00.json
```

---

## 🎯 Checklist de Verificación

- [ ] `git pull` ejecutado correctamente
- [ ] Build completado sin errores
- [ ] PM2 reiniciado (uptime reseteado)
- [ ] Login funciona visualmente
- [ ] Logs muestran "RespuestaLogin parseado"
- [ ] GPS batches se insertan sin errores
- [ ] No aparece "TypeError: fetch failed"

---

## 🆘 Si Algo Falla

### **Error en Build**
```bash
# Limpiar todo y reintentar
rm -rf .next node_modules
pnpm install
pnpm build
```

### **Login Sigue Fallando**
```bash
# Ver logs completos del último login
pm2 logs track --lines 500 | grep -A20 "gestion/login"
```

Compartir esos logs conmigo.

### **PM2 No Arranca**
```bash
# Ver errores de PM2
pm2 logs track --err --lines 50

# Verificar configuración
pm2 show track
```

---

## 📞 Siguiente Paso

Una vez completado el deploy, **probar login inmediatamente** y compartirme:

1. ✅ o ❌ ¿Login funciona?
2. Screenshot si sigue fallando
3. Logs completos:
   ```bash
   pm2 logs track --lines 500 | grep -A10 "RespuestaLogin"
   ```

🚀 **EJECUTA ESTOS COMANDOS AHORA** 🚀
