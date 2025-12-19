# ⚡ Deploy TrackMovil - Referencia Rápida

## 🎯 Un Solo Script - Tres Modos

```bash
./deploy-trackmovil.sh           # Deploy completo (instalación o actualización)
./deploy-trackmovil.sh --quick   # Actualización rápida
./deploy-trackmovil.sh --config  # Solo configuración
```

---

## 📥 Primera Vez (Instalación)

```bash
# 1. Descarga el script
curl -sSL https://raw.githubusercontent.com/Riogas/interactivemap/main/deploy-trackmovil.sh -o deploy-trackmovil.sh
chmod +x deploy-trackmovil.sh

# 2. Ejecuta
./deploy-trackmovil.sh

# 3. Sigue las instrucciones:
#    - Edita .env.production (configura EXTERNAL_API_URL)
#    - Selecciona modo de red (opción 1 recomendada)

# 4. Listo! Accede en http://localhost:3001
```

**Tiempo**: 3-10 minutos

---

## 🔄 Actualización Diaria

```bash
# Cambios de código
./deploy-trackmovil.sh --quick

# Cambios de configuración (.env)
./deploy-trackmovil.sh --config
```

**Tiempo**: 1-3 minutos

---

## ⚙️ Configuración .env.production

### Con Port Mapping (Recomendado)

```bash
EXTERNAL_API_URL=http://192.168.7.14:3000
NEXT_PUBLIC_EXTERNAL_API_URL=http://192.168.7.14:3000
```

### Con Host Network

```bash
EXTERNAL_API_URL=http://localhost:3000
NEXT_PUBLIC_EXTERNAL_API_URL=http://localhost:3000
```

---

## 🔍 Verificación

```bash
# Estado
docker ps | grep trackmovil

# Logs
docker logs -f trackmovil

# Test login
curl -X POST http://localhost:3001/api/proxy/puestos/gestion/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"test"}'
```

---

## 🐛 Solución Rápida de Problemas

### Login falla

```bash
# 1. Verifica API URL
cat ~/trackmovil/.env.production

# 2. Actualiza configuración
./deploy-trackmovil.sh --config
```

### Container no inicia

```bash
# Ver logs
docker logs trackmovil

# Reiniciar
docker restart trackmovil
```

---

## ✨ Características

- ✅ Solo maneja la **aplicación** (no toca Docker/Node/Linux)
- ✅ Detección **automática** (instalación o actualización)
- ✅ Backup de cambios locales con `git stash`
- ✅ Interfaz con **colores y emojis**
- ✅ Validación de requisitos previos

---

## 📋 Requisitos Previos

- Docker instalado y funcionando
- Git instalado
- Usuario en grupo `docker`

**Si no tienes Docker**: Usa primero `scripts/install-docker-full.sh`

---

## 📊 Comparación de Modos

| Modo | Tiempo | Usa Git Pull | Edita .env | No Cache |
|------|--------|--------------|------------|----------|
| Normal | 3-10 min | ✅ | ✅ | ❌ |
| --quick | 1-3 min | ✅ | ❌ | ❌ |
| --config | 2-5 min | ❌ | ✅ | ✅ |

---

## 🔗 Documentación Completa

- [Guía Detallada del Script](./DEPLOY_SCRIPT.md)
- [Deploy Docker Desde Cero](./DOCKER_DEPLOYMENT_DESDE_CERO.md)
- [Docker vs PM2](./DOCKER_VS_PM2.md)

---

## 🎉 Listo!

Ahora solo necesitas un comando para deploy o actualización:

```bash
./deploy-trackmovil.sh --quick
```
