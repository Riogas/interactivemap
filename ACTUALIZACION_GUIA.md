# 🔄 Guía de Actualización de TracMovil

## 📚 Índice
1. [Estrategias de Actualización](#estrategias)
2. [Método Actual (.tar)](#metodo-tar)
3. [Método Recomendado (Git)](#metodo-git)
4. [Comandos Rápidos](#comandos-rapidos)

---

## 🎯 Estrategias de Actualización {#estrategias}

### **Método 1: Transfer de .tar (Actual)**
- ✅ **Ventaja**: Simple, no necesita Git en servidor
- ❌ **Desventaja**: Transferir ~100MB cada vez
- 📦 **Uso**: Despliegues poco frecuentes

### **Método 2: Git + Build Remoto (Recomendado)**
- ✅ **Ventaja**: Solo transfieres código (~KB), build usa caché
- ✅ **Ventaja**: Actualizaciones con `git pull`
- ❌ **Desventaja**: Necesitas build en servidor (3-5 min primera vez)
- 🚀 **Uso**: Desarrollo activo, actualizaciones frecuentes

---

## 📦 Método 1: Actualización con .tar {#metodo-tar}

### En Windows:

```powershell
# 1. Hacer cambios en código
git add .
git commit -m "descripción de cambios"
git push origin main

# 2. Rebuild imagen Docker
docker build -t trackmovil:latest .

# 3. Exportar imagen
docker save trackmovil:latest -o trackmovil.tar

# 4. Comprimir
Compress-Archive -Path trackmovil.tar -DestinationPath trackmovil.zip -Force

# 5. Transferir
scp trackmovil.zip riogas@node:/home/riogas/
```

### En Linux:

```bash
# 6. Desplegar nueva versión
./deploy-linux-organized.sh
```

**Tiempo total:** ~10-15 minutos (build + transfer)

---

## 🚀 Método 2: Git + Build Remoto {#metodo-git}

### ⚙️ Instalación Inicial (UNA SOLA VEZ)

#### Transferir scripts de instalación:

```powershell
# En Windows
scp scripts/install-trackmovil-git.sh riogas@node:/home/riogas/
scp scripts/update-trackmovil.sh riogas@node:/home/riogas/
```

#### En Linux:

```bash
# Ejecutar instalación inicial
chmod +x install-trackmovil-git.sh update-trackmovil.sh
./install-trackmovil-git.sh
```

Esto hará:
1. Clonar repositorio en `~/trackmovil-source`
2. Crear `.env.production`
3. Build de imagen Docker
4. Ejecutar contenedor en puerto 3001

---

### 🔄 Actualizaciones Futuras (SUPER RÁPIDO)

#### En Windows:

```powershell
# 1. Hacer cambios en código
git add .
git commit -m "fix: corregir bug en mapa"
git push origin main
```

#### En Linux:

```bash
# 2. Actualizar (¡un solo comando!)
cd ~/trackmovil-source
./update-trackmovil.sh
```

El script automáticamente:
- ✅ Hace `git pull`
- ✅ Rebuild de imagen (con caché, más rápido)
- ✅ Stop del contenedor anterior
- ✅ Start del nuevo contenedor
- ✅ Verificación de estado

**Tiempo total:** ~2-3 minutos (solo build, sin transfer)

---

## ⚡ Comandos Rápidos {#comandos-rapidos}

### Ver logs en tiempo real:
```bash
docker logs -f trackmovil
```

### Reiniciar aplicación:
```bash
docker restart trackmovil
```

### Ver estado:
```bash
docker ps | grep trackmovil
```

### Actualizar desde Git:
```bash
cd ~/trackmovil-source
./update-trackmovil.sh
```

### Ver cambios antes de actualizar:
```bash
cd ~/trackmovil-source
git fetch
git log HEAD..origin/main --oneline
```

### Editar variables de entorno:
```bash
nano ~/trackmovil-source/.env.production
docker restart trackmovil
```

### Limpiar imágenes antiguas:
```bash
docker image prune -f
```

---

## 🔧 Troubleshooting

### Contenedor no inicia después de actualización:

```bash
# Ver logs de error
docker logs trackmovil

# Verificar .env
cat ~/trackmovil-source/.env.production

# Rebuild forzado sin caché
cd ~/trackmovil-source
docker build --no-cache -t trackmovil:latest .
docker restart trackmovil
```

### Error en git pull:

```bash
cd ~/trackmovil-source

# Ver estado
git status

# Descartar cambios locales
git reset --hard origin/main

# Volver a actualizar
./update-trackmovil.sh
```

### Puerto 3001 en uso:

```bash
# Ver qué usa el puerto
sudo lsof -i :3001

# Cambiar a otro puerto (ejemplo: 3002)
docker stop trackmovil
docker rm trackmovil

docker run -d \
  --name trackmovil \
  --restart unless-stopped \
  -p 3002:3000 \
  --env-file ~/trackmovil-source/.env.production \
  trackmovil:latest
```

---

## 📊 Comparación de Métodos

| Aspecto | .tar Transfer | Git + Build Remoto |
|---------|--------------|-------------------|
| Instalación inicial | ⚡ Rápida | 🐢 Lenta (primera vez) |
| Actualizaciones | 🐢 Lentas (~100MB) | ⚡ Rápidas (~KB) |
| Requiere Git | ❌ No | ✅ Sí |
| Requiere Docker build | ❌ No | ✅ Sí (en servidor) |
| Mejor para | Pocos deploys | Desarrollo activo |
| Tiempo actualización | ~10-15 min | ~2-3 min |

---

## 🎯 Recomendación

**Si actualizas menos de 1 vez por semana:** Usa método .tar  
**Si actualizas frecuentemente:** Cambia a Git + Build Remoto

### Migrar de .tar a Git:

```bash
# En Linux
./install-trackmovil-git.sh

# Eliminar archivos .tar antiguos
rm -rf ~/trackmovil.tar ~/trackmovil.zip

# Futuras actualizaciones
cd ~/trackmovil-source
./update-trackmovil.sh
```

---

## 📞 Recursos

- **Logs**: `docker logs -f trackmovil`
- **Repositorio**: https://github.com/Riogas/interactivemap
- **Puerto**: 3001
- **Código fuente**: `~/trackmovil-source`
