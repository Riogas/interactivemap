# 🚀 Guía Rápida: Actualizar API en Servidor Linux

## 📋 Resumen

El archivo `.env.production` NO se sube a Git (está en `.gitignore` por seguridad).
Por lo tanto, necesitas actualizar manualmente este archivo en el servidor Linux.

## 🎯 Opción 1: Script Automático (RECOMENDADO)

```bash
# 1. Conectarse al servidor
ssh riogas@node

# 2. Ir al proyecto
cd ~/trackmovil

# 3. Hacer git pull para obtener el nuevo script
git pull origin main

# 4. Dar permisos de ejecución
chmod +x scripts/update-env-api.sh

# 5. Ejecutar el script
./scripts/update-env-api.sh
```

El script hará automáticamente:
- ✅ Crear backup de tu .env.production actual
- ✅ Actualizar EXTERNAL_API_URL a http://192.168.1.72:8082
- ✅ Agregar NEXT_PUBLIC_EXTERNAL_API_URL
- ✅ Preguntar si quieres reconstruir el contenedor
- ✅ Si aceptas, hará: build, stop, rm, run del contenedor

## 🎯 Opción 2: Manual (si prefieres control total)

```bash
# 1. Conectarse al servidor
ssh riogas@node

# 2. Ir al proyecto
cd ~/trackmovil

# 3. Hacer backup del .env actual
cp .env.production .env.production.backup

# 4. Editar el archivo
nano .env.production

# 5. Buscar estas líneas y cambiarlas:
#    EXTERNAL_API_URL=http://localhost:3000
#    Cambiar a:
#    EXTERNAL_API_URL=http://192.168.1.72:8082
#
#    También agregar (si no existe):
#    NEXT_PUBLIC_EXTERNAL_API_URL=http://192.168.1.72:8082

# 6. Guardar: Ctrl+O, Enter
# 7. Salir: Ctrl+X

# 8. Reconstruir imagen
docker build -t trackmovil:latest .

# 9. Reiniciar contenedor
docker stop trackmovil
docker rm trackmovil
docker run -d \
  --name trackmovil \
  -p 3001:3000 \
  --env-file .env.production \
  --restart unless-stopped \
  trackmovil:latest

# 10. Ver logs
docker logs -f trackmovil
```

## 🎯 Opción 3: Un Solo Comando (Usando Script de Update Existente)

```bash
ssh riogas@node
cd ~/trackmovil

# Primero actualizar el .env.production manualmente (ver Opción 2, pasos 3-7)
# Luego:
./scripts/update-trackmovil.sh
```

**⚠️ NOTA:** El script `update-trackmovil.sh` NO actualiza el `.env.production` automáticamente.
Usa `update-env-api.sh` para eso, o edítalo manualmente antes de ejecutar el update.

## ✅ Verificación

Después de actualizar:

```bash
# 1. Verificar que el contenedor esté corriendo
docker ps | grep trackmovil

# 2. Ver los logs (Ctrl+C para salir)
docker logs -f trackmovil

# 3. Abrir en navegador
http://192.168.7.14:3001/login

# 4. Intentar hacer login

# 5. Verificar en DevTools (F12) → Network
#    Debería ver petición a: /api/proxy/puestos/gestion/login
```

## 📁 Archivos Importantes

```
~/trackmovil/
├── .env.production              ← EDITAR ESTE (no está en Git)
├── .env.production.template     ← Referencia (está en Git)
├── CONFIGURACION_API_LOGIN.md   ← Documentación completa
└── scripts/
    ├── update-env-api.sh        ← Script automático
    └── update-trackmovil.sh     ← Script de update general
```

## 🔑 Configuración Correcta

Tu `.env.production` debe tener estas líneas:

```bash
# API Externa - URL de Login
EXTERNAL_API_URL=http://192.168.1.72:8082
NEXT_PUBLIC_EXTERNAL_API_URL=http://192.168.1.72:8082

# Endpoint completo de login:
# http://192.168.1.72:8082/puestos/gestion/login
```

## 🆘 Troubleshooting

### Problema: "Error de conexión con el servidor"
- ✅ Verifica que EXTERNAL_API_URL sea http://192.168.1.72:8082
- ✅ Verifica que reconstruiste el contenedor después de editar .env
- ✅ Verifica que la API en 192.168.1.72:8082 esté corriendo

### Problema: El contenedor no inicia
```bash
docker logs trackmovil
```

### Problema: Cambios no se reflejan
```bash
# Verifica que usaste --env-file al crear el contenedor
docker inspect trackmovil | grep -A 10 "Env"

# Si no tiene las variables correctas, recréalo:
docker rm -f trackmovil
docker run -d --name trackmovil -p 3001:3000 --env-file .env.production --restart unless-stopped trackmovil:latest
```

---

## 🎬 Flujo Completo Desde Windows

**En tu máquina Windows (ya hecho):**
```powershell
# Ya se actualizó tu .env.production local
# Ya se creó .env.production.template
# Ya se creó CONFIGURACION_API_LOGIN.md
# Ya se creó scripts/update-env-api.sh
# Ya se hizo git push
```

**En el servidor Linux (por hacer):**
```bash
ssh riogas@node
cd ~/trackmovil
git pull origin main
chmod +x scripts/update-env-api.sh
./scripts/update-env-api.sh
# Responder 's' a las dos preguntas
# Esperar a que termine
# Probar login en http://192.168.7.14:3001
```

---

**Tiempo estimado:** 3-5 minutos  
**Dificultad:** ⭐⭐☆☆☆ (Fácil)
