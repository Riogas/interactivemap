# ✅ LISTO PARA APLICAR EN LINUX

## 📊 Estado Actual

### ✅ Completado en Windows
- [x] `.env.production` local actualizaDebe mostrar:
```
EXTERNAL_API_URL=https://sgm.glp.riogas.com.uy
NEXT_PUBLIC_EXTERNAL_API_URL=https://sgm.glp.riogas.com.uy
```n API correcta
- [x] `.env.production.template` creado y subido a Git
- [x] `CONFIGURACION_API_LOGIN.md` documentación completa
- [x] `GUIA_RAPIDA_UPDATE_API.md` guía paso a paso
- [x] `scripts/update-env-api.sh` script automático
- [x] Todo subido a GitHub (4 commits)

### ⏳ Pendiente en Linux
- [ ] Hacer `git pull` en el servidor
- [ ] Ejecutar script de actualización de API
- [ ] Probar login

---

## 🎯 PRÓXIMOS PASOS (En el servidor Linux)

### Opción A: Script Automático (RECOMENDADO - 3 minutos)

```bash
ssh riogas@node
cd ~/trackmovil
git pull origin main
chmod +x scripts/update-env-api.sh
./scripts/update-env-api.sh
```

Responder:
1. `s` (sí) para confirmar actualización de .env
2. `s` (sí) para reconstruir y reiniciar contenedor

¡Listo! Probar login en: http://192.168.7.14:3001

### Opción B: Manual (5 minutos)

```bash
ssh riogas@node
cd ~/trackmovil
git pull origin main
nano .env.production
```

Cambiar:
```bash
# De:
EXTERNAL_API_URL=http://localhost:3000

# A:
EXTERNAL_API_URL=http://192.168.1.72:8082
NEXT_PUBLIC_EXTERNAL_API_URL=http://192.168.1.72:8082
```

Guardar (Ctrl+O, Enter) y salir (Ctrl+X)

Luego:
```bash
docker build -t trackmovil:latest .
docker stop trackmovil && docker rm trackmovil
docker run -d --name trackmovil -p 3001:3000 --env-file .env.production --restart unless-stopped trackmovil:latest
docker logs -f trackmovil
```

---

## 📁 Archivos Nuevos en Git

```
trackmovil/
├── .env.production.template           ← Plantilla de referencia
├── CONFIGURACION_API_LOGIN.md         ← Documentación técnica completa
├── GUIA_RAPIDA_UPDATE_API.md          ← Esta guía (paso a paso)
└── scripts/
    └── update-env-api.sh              ← Script automático
```

---

## 🔧 ¿Qué Hace el Script?

El script `update-env-api.sh` automáticamente:

1. ✅ Verifica que estás en el directorio correcto
2. ✅ Crea backup de tu `.env.production` actual
3. ✅ Actualiza `EXTERNAL_API_URL=https://sgm.glp.riogas.com.uy`
4. ✅ Agrega `NEXT_PUBLIC_EXTERNAL_API_URL=https://sgm.glp.riogas.com.uy`
5. ✅ Te pregunta si quieres reconstruir el contenedor
6. ✅ Si dices sí:
   - Hace `docker build`
   - Detiene y elimina contenedor viejo
   - Crea contenedor nuevo con la configuración actualizada
   - Muestra los logs
7. ✅ Te confirma que todo está listo

---

## ✅ Verificación

Después de aplicar los cambios:

### 1. Verificar contenedor
```bash
docker ps | grep trackmovil
```
Debería aparecer: `trackmovil ... Up X minutes ... 0.0.0.0:3001->3000/tcp`

### 2. Verificar logs
```bash
docker logs --tail 50 trackmovil
```
Buscar líneas como:
```
▲ Next.js 15.1.5
- Local:        http://localhost:3000
- Network:      http://0.0.0.0:3000
✓ Starting...
✓ Ready in 2.5s
```

### 3. Verificar variables de entorno
```bash
docker exec trackmovil printenv | grep API_URL
```
Debería mostrar:
```
EXTERNAL_API_URL=http://192.168.1.72:8082
NEXT_PUBLIC_EXTERNAL_API_URL=http://192.168.1.72:8082
```

### 4. Probar en navegador
1. Ir a: http://192.168.7.14:3001/login
2. Abrir DevTools (F12) → pestaña Network
3. Intentar login con credenciales válidas
4. Verificar que la petición vaya a: `/api/proxy/puestos/gestion/login`
5. Verificar que NO aparezca "Error de conexión con el servidor"

---

## 🎊 Resultado Esperado

### ANTES (❌ Error)
```
Usuario intenta login
  ↓
"Error de conexión con el servidor"
  ↓
Console: Network Error / Connection Refused
  ↓
EXTERNAL_API_URL apuntaba a localhost:3000
```

### DESPUÉS (✅ Funciona)
```
Usuario intenta login
  ↓
Petición a /api/proxy/puestos/gestion/login
  ↓
Proxy reenvía a http://192.168.1.72:8082/puestos/gestion/login
  ↓
API responde con token JWT
  ↓
Usuario entra al dashboard
```

---

## 📞 Soporte

Si algo no funciona:

### 1. Verificar API externa
```bash
curl http://192.168.1.72:8082/puestos/gestion/login
```
Debería responder (aunque sea con error 405 o 400, lo importante es que responda)

### 2. Ver logs completos del contenedor
```bash
docker logs trackmovil 2>&1 | less
```

### 3. Verificar configuración del contenedor
```bash
docker inspect trackmovil | grep -A 20 Env
```

### 4. Probar reconstrucción limpia
```bash
docker stop trackmovil
docker rm trackmovil
docker rmi trackmovil:latest
docker build --no-cache -t trackmovil:latest .
docker run -d --name trackmovil -p 3001:3000 --env-file .env.production --restart unless-stopped trackmovil:latest
```

---

## 📝 Notas Importantes

1. **`.env.production` NO está en Git**
   - Por seguridad, este archivo está en `.gitignore`
   - Contiene credenciales de Supabase
   - Debes actualizarlo manualmente en cada servidor

2. **`.env.production.template` SÍ está en Git**
   - Es una plantilla de referencia
   - NO contiene secretos reales
   - Úsala como guía para crear `.env.production` en nuevos servidores

3. **El script es idempotente**
   - Puedes ejecutarlo múltiples veces sin problemas
   - Siempre crea backup antes de modificar
   - Puedes revertir usando los backups

4. **Tiempo de reconstrucción**
   - Primera vez: ~3-5 minutos (descarga dependencias)
   - Siguientes veces: ~1-2 minutos (usa cache de Docker)

---

## 🚀 Resumen Ejecutivo

**Problema:** Login falla con "Error de conexión con el servidor"

**Causa:** `.env.production` tiene URL incorrecta

**Solución:** 
```bash
ssh riogas@node
cd ~/trackmovil
git pull
./scripts/update-env-api.sh
```

**Tiempo:** 3 minutos

**Resultado:** Login funcionando ✅

---

**Última actualización:** 2025-01-16  
**Commits realizados:** 4  
**Estado:** ✅ Listo para aplicar en Linux
