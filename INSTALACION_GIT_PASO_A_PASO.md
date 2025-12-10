# 🚀 Instalación de TracMovil con Git - Paso a Paso

## 📋 Pre-requisitos

✅ Servidor Linux con Docker instalado  
✅ Acceso SSH al servidor  
✅ Git instalado en el servidor  

---

## 🔧 Paso 1: Transferir Scripts de Instalación

### Desde Windows PowerShell:

```powershell
# Transferir los scripts de instalación y actualización
scp scripts/install-trackmovil-git.sh riogas@node:/home/riogas/
scp scripts/update-trackmovil.sh riogas@node:/home/riogas/
```

**Salida esperada:**
```
install-trackmovil-git.sh    100%  3.5KB   3.5KB/s   00:00
update-trackmovil.sh         100%  2.8KB   2.8KB/s   00:00
```

---

## 🐧 Paso 2: Conectar al Servidor Linux

```bash
ssh riogas@node
```

---

## 📦 Paso 3: Limpiar Instalación Anterior (Opcional)

Si ya ejecutaste el deploy anterior con .tar, limpiemos:

```bash
# Detener y eliminar contenedor anterior
docker stop trackmovil 2>/dev/null || true
docker rm trackmovil 2>/dev/null || true

# Limpiar archivos temporales (OPCIONAL - solo si quieres)
rm -f ~/trackmovil.tar ~/trackmovil.zip ~/deploy-linux.sh ~/.env
```

---

## 🚀 Paso 4: Ejecutar Instalación Inicial

```bash
# Dar permisos de ejecución
chmod +x install-trackmovil-git.sh update-trackmovil.sh

# Ejecutar instalación (toma 3-5 minutos)
./install-trackmovil-git.sh
```

**Lo que hace este script:**

1. ✅ Clona el repositorio en `~/trackmovil`
2. ✅ Crea archivo `.env.production` con tus credenciales
3. ✅ Construye la imagen Docker (~3-5 minutos)
4. ✅ Ejecuta el contenedor en puerto 3001
5. ✅ Verifica que todo funcione

**Salida esperada:**
```
🐧 Configuración inicial de TracMovil...
📦 Clonando repositorio...
✓ Repositorio clonado
📝 Creando archivo .env.production...
✓ Archivo .env.production creado
🏗️ Construyendo imagen Docker (puede tomar 3-5 minutos)...
✓ Imagen construida
🚀 Iniciando contenedor...
✅ ¡Instalación completada exitosamente!

📊 Estado del contenedor:
NAMES       STATUS         PORTS
trackmovil  Up 5 seconds  0.0.0.0:3001->3000/tcp

📂 Código fuente en:
   /home/riogas/trackmovil

🌐 Acceso:
   Local: http://localhost:3001
   Red:   http://192.168.X.X:3001

📋 Comandos útiles:
   Ver logs:       docker logs -f trackmovil
   Actualizar app: cd /home/riogas/trackmovil && ./update-trackmovil.sh
   Reiniciar:      docker restart trackmovil
   Detener:        docker stop trackmovil
```

---

## ✅ Paso 5: Verificar Instalación

```bash
# Ver logs en tiempo real
docker logs -f trackmovil

# Presiona Ctrl+C para salir

# Probar API
curl http://localhost:3001/api/all-positions

# Ver estructura de archivos
ls -la ~/trackmovil
```

**Deberías ver:**
```
/home/riogas/trackmovil/
├── .git/
├── app/
├── components/
├── lib/
├── .env.production  ← Variables de entorno
├── Dockerfile
├── next.config.mjs
├── package.json
└── update-trackmovil.sh  ← Script de actualización
```

---

## 🌐 Paso 6: Acceder a la Aplicación

Abre en tu navegador:
```
http://IP-DEL-SERVIDOR:3001
```

Por ejemplo:
```
http://192.168.7.100:3001
```

---

## 🔄 Para Actualizaciones Futuras

### En Windows (hacer cambios):

```powershell
# 1. Hacer cambios en el código
# 2. Commit
git add .
git commit -m "feat: agregar nueva funcionalidad"

# 3. Push
git push origin main
```

### En Linux (aplicar cambios):

```bash
# ¡Un solo comando!
cd ~/trackmovil
./update-trackmovil.sh
```

**El script automáticamente:**
- ✅ Hace `git pull`
- ✅ Rebuild de imagen (con caché, ~1-2 min)
- ✅ Reinicia contenedor
- ✅ Verifica estado

**Tiempo total: ~2-3 minutos** ⚡

---

## 📊 Estructura Final

```
/home/riogas/
├── trackmovil/              ← Código fuente + Git
│   ├── .git/
│   ├── app/
│   ├── components/
│   ├── .env.production
│   ├── Dockerfile
│   ├── update-trackmovil.sh
│   └── ...
├── goya/
├── securitysuite/
├── install-trackmovil-git.sh (ya no necesario)
└── update-trackmovil.sh      (backup)
```

---

## 🔧 Comandos Útiles

### Ver logs:
```bash
docker logs -f trackmovil
```

### Ver commits recientes:
```bash
cd ~/trackmovil
git log --oneline -5
```

### Ver cambios antes de actualizar:
```bash
cd ~/trackmovil
git fetch
git log HEAD..origin/main --oneline
```

### Actualizar:
```bash
cd ~/trackmovil
./update-trackmovil.sh
```

### Reiniciar:
```bash
docker restart trackmovil
```

### Ver estado:
```bash
docker ps | grep trackmovil
```

### Editar variables de entorno:
```bash
nano ~/trackmovil/.env.production
docker restart trackmovil
```

---

## ❌ Troubleshooting

### Error: "directory already exists"

```bash
# Eliminar carpeta existente
rm -rf ~/trackmovil

# Volver a ejecutar instalación
./install-trackmovil-git.sh
```

### Error en git clone (credenciales)

El repositorio es público, no debería pedir credenciales. Si pide:

```bash
# Verificar que puedes acceder al repo
curl -I https://github.com/Riogas/interactivemap
```

### Contenedor no inicia:

```bash
# Ver logs completos
docker logs trackmovil

# Verificar .env
cat ~/trackmovil/.env.production

# Rebuild sin caché
cd ~/trackmovil
docker build --no-cache -t trackmovil:latest .
docker restart trackmovil
```

### Error en build de Docker:

```bash
# Ver espacio en disco
df -h

# Limpiar imágenes antiguas
docker system prune -a
```

---

## 🎉 ¡Listo!

Ahora tienes:

✅ Código fuente en `~/trackmovil` con Git  
✅ Actualizaciones rápidas con `./update-trackmovil.sh`  
✅ Aplicación corriendo en puerto 3001  
✅ No más transferencias de 100MB  

**Próxima actualización: ~2 minutos** ⚡ en lugar de ~15 minutos 🐢
