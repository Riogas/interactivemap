# ✅ URL de API Actualizada

## 🔄 Cambio Realizado

**ANTES:**
```
EXTERNAL_API_URL=http://192.168.1.72:8082
```

**AHORA:**
```
EXTERNAL_API_URL=https://sgm.glp.riogas.com.uy
```

## 🌐 Endpoint Completo

```
https://sgm.glp.riogas.com.uy/gestion/login
```

---

## 🚀 Aplicar en el Servidor Linux

```bash
# 1. SSH al servidor
ssh riogas@node

# 2. Ir al proyecto
cd ~/trackmovil

# 3. Pull de cambios
git pull origin main

# 4. Actualizar .env.production automáticamente
./scripts/update-env-api.sh
# Responde 's' (sí) a ambas preguntas

# Listo! ✅
```

### O Manualmente:

```bash
# 1. Pull
git pull origin main

# 2. Editar .env.production
nano .env.production

# Cambiar a:
EXTERNAL_API_URL=https://sgm.glp.riogas.com.uy
NEXT_PUBLIC_EXTERNAL_API_URL=https://sgm.glp.riogas.com.uy

# Guardar: Ctrl+O, Enter
# Salir: Ctrl+X

# 3. Reconstruir
docker build -t trackmovil:latest .

# 4. Reiniciar
docker stop trackmovil && docker rm trackmovil
docker run -d --name trackmovil -p 3001:3000 --env-file .env.production --restart unless-stopped trackmovil:latest

# 5. Ver logs
docker logs -f trackmovil
```

---

## ✅ Verificación

**En los logs deberías ver:**
```
🔄 Proxy POST https://sgm.glp.riogas.com.uy/gestion/login
📤 Headers: { 'Content-Type': 'application/json', Accept: 'application/json' }
📤 Body: {"UserName":"...","Password":"..."}
📥 Response Status: 200
📥 Response Data: {"RespuestaLogin": "...success\":true..."}
```

**Prueba el login en:**
```
http://192.168.7.14:3001/login
```

---

## 📝 Archivos Actualizados

- ✅ `.env.production.template` → URL actualizada
- ✅ `scripts/update-env-api.sh` → URL actualizada
- ✅ Documentación actualizada
- ✅ Commits subidos a GitHub

---

**Fecha:** 2025-12-11  
**Commits:** 2 nuevos
- `f9fa690` - fix: Update API URL to https://www.riogas.com.uy (public domain)
- `6c68dc8` - docs: Update API URL in documentation to riogas.com.uy
