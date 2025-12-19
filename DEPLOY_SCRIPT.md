# 🚀 Deploy Script - TrackMovil

Script único para instalación desde cero o actualización de la aplicación TrackMovil.

## ✨ Características

- ✅ **Solo aplicación**: No toca Docker, Node.js, ni el sistema operativo
- ✅ **Detección automática**: Identifica si es instalación inicial o actualización
- ✅ **3 modos de ejecución**: Completo, rápido, solo configuración
- ✅ **Interfaz amigable**: Colores, emojis y mensajes claros
- ✅ **Manejo de errores**: Validación de requisitos previos
- ✅ **Backup automático**: Guarda cambios locales antes de actualizar

---

## 📋 Requisitos Previos

El script asume que **YA TIENES** instalado:

1. **Docker** (funcionando y con permisos)
2. **Git**
3. Usuario en grupo `docker`

> **Nota**: Si no tienes Docker instalado, usa primero `scripts/install-docker-full.sh`

---

## 📥 Instalación del Script

### Opción 1: Descarga Directa

```bash
# Descarga el script
curl -sSL https://raw.githubusercontent.com/Riogas/interactivemap/main/deploy-trackmovil.sh -o deploy-trackmovil.sh

# Dale permisos de ejecución
chmod +x deploy-trackmovil.sh
```

### Opción 2: Desde el Repositorio Clonado

```bash
cd ~/trackmovil
chmod +x deploy-trackmovil.sh
```

---

## 🎯 Modos de Uso

### 1️⃣ Deploy Completo (Instalación o Actualización Full)

**Cuándo usar**: Primera instalación o actualización completa con cambios grandes

```bash
./deploy-trackmovil.sh
```

**Lo que hace**:
- ✅ Clona el repositorio (si no existe) o actualiza (si existe)
- ✅ Configura `.env.production` (te permite editarlo)
- ✅ Construye la imagen Docker
- ✅ Detiene y elimina container anterior
- ✅ Inicia nuevo container
- ✅ Verifica que todo funcione

**Tiempo**: 3-10 minutos (dependiendo de cache)

---

### 2️⃣ Actualización Rápida

**Cuándo usar**: Actualizaciones frecuentes de código (sin cambios de .env)

```bash
./deploy-trackmovil.sh --quick
```

**Lo que hace**:
- ✅ Git pull
- ✅ Rebuild imagen
- ✅ Reinicia container con mismo network mode

**Tiempo**: 1-3 minutos

---

### 3️⃣ Solo Configuración

**Cuándo usar**: Cambiar variables de entorno o configuración

```bash
./deploy-trackmovil.sh --config
```

**Lo que hace**:
- ✅ Te permite editar `.env.production`
- ✅ Rebuild SIN cache (fuerza usar nuevo .env)
- ✅ Reinicia container

**Tiempo**: 2-5 minutos

---

## 📖 Ejemplo de Uso Completo

### Primera Instalación

```bash
# 1. Descarga el script
curl -sSL https://raw.githubusercontent.com/Riogas/interactivemap/main/deploy-trackmovil.sh -o deploy-trackmovil.sh
chmod +x deploy-trackmovil.sh

# 2. Ejecuta deploy completo
./deploy-trackmovil.sh

# Durante la ejecución te preguntará:
# - Si editar .env.production (configura API URL)
# - Qué modo de red usar (opción 1 recomendada)

# 3. Espera a que termine (3-10 minutos)

# 4. Accede a la aplicación
# http://localhost:3001  (si elegiste opción 1)
```

### Actualización Diaria

```bash
# Cambios pequeños de código
./deploy-trackmovil.sh --quick

# Cambios en configuración
./deploy-trackmovil.sh --config
```

---

## ⚙️ Configuración Importante

### `.env.production` - API URL

Durante el deploy se te pedirá configurar el archivo `.env.production`.

**Opciones según modo de red**:

#### Opción 1: Port Mapping (3001:3000) - **RECOMENDADO**

```bash
# Si la API está en OTRO servicio del MISMO servidor
EXTERNAL_API_URL=http://192.168.7.14:3000
NEXT_PUBLIC_EXTERNAL_API_URL=http://192.168.7.14:3000
```

**Cuándo usar**: 
- API en `riogasgestion-app` (puerto 3000)
- Múltiples servicios en el servidor
- Mejor aislamiento

#### Opción 2: Host Network

```bash
# Si usas --network host
EXTERNAL_API_URL=http://localhost:3000
NEXT_PUBLIC_EXTERNAL_API_URL=http://localhost:3000
```

**Cuándo usar**:
- Necesitas acceso directo a localhost
- Problemas de conectividad entre containers

---

## 🔍 Verificación Post-Deploy

El script muestra automáticamente:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🎉 Deployment Completado
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📍 Acceso Local:   http://localhost:3001
📍 Acceso Remoto:  http://192.168.7.14:3001

🔧 Comandos Útiles:
  Ver logs:       docker logs -f trackmovil
  Reiniciar:      docker restart trackmovil
  Detener:        docker stop trackmovil
  Estado:         docker ps | grep trackmovil
  Actualizar:     ./deploy-trackmovil.sh

✨ TrackMovil está listo para usar!
```

### Verificación Manual

```bash
# 1. Ver logs en tiempo real
docker logs -f trackmovil

# 2. Verificar que esté corriendo
docker ps | grep trackmovil

# 3. Probar login
curl -X POST http://localhost:3001/api/proxy/puestos/gestion/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"test"}'
```

---

## 🐛 Troubleshooting

### Error: "Docker no está instalado"

```bash
# Instala Docker primero
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Añade tu usuario al grupo docker
sudo usermod -aG docker $USER
newgrp docker
```

### Error: "Permission denied" al ejecutar Docker

```bash
# Verifica que estés en el grupo docker
groups | grep docker

# Si no estás, añádete
sudo usermod -aG docker $USER
newgrp docker
```

### Error: Login falla con "Error de conexión"

```bash
# 1. Verifica la API URL en .env.production
cat ~/trackmovil/.env.production

# 2. Prueba la API directamente
curl http://localhost:3000/puestos/gestion/login

# 3. Si funciona, actualiza configuración
./deploy-trackmovil.sh --config
```

### Error: Container no inicia

```bash
# Ver logs completos
docker logs trackmovil

# Reiniciar Docker
sudo systemctl restart docker
./deploy-trackmovil.sh
```

---

## 📊 Comparación de Modos

| Modo | Tiempo | Cuándo Usar | Git Pull | Edit .env | No Cache |
|------|--------|-------------|----------|-----------|----------|
| **Completo** | 3-10 min | Primera vez, cambios grandes | ✅ | ✅ | ❌ |
| **--quick** | 1-3 min | Updates frecuentes | ✅ | ❌ | ❌ |
| **--config** | 2-5 min | Cambios solo en .env | ❌ | ✅ | ✅ |

---

## 🔄 Flujo de Trabajo Recomendado

### Desarrollo Diario

```bash
# Mañana: Pull últimos cambios
./deploy-trackmovil.sh --quick

# Durante el día: Si cambias .env
./deploy-trackmovil.sh --config

# Noche: Deploy completo semanal
./deploy-trackmovil.sh
```

### Producción

```bash
# Deploy inicial
./deploy-trackmovil.sh

# Updates programados (cron)
0 2 * * 0 /home/riogas/deploy-trackmovil.sh --quick
```

---

## 📁 Estructura de Archivos

Después del deploy tendrás:

```
~/
├── trackmovil/                    # Clonado automáticamente
│   ├── .env.production           # Configurado durante deploy
│   ├── deploy-trackmovil.sh      # Este script
│   ├── Dockerfile
│   └── ...
└── deploy-trackmovil.sh          # Script standalone (opcional)
```

---

## 🎨 Características Visuales

El script usa colores y emojis para facilitar el seguimiento:

- 🔵 **Azul**: Información general
- 🟢 **Verde**: Operaciones exitosas
- 🟡 **Amarillo**: Advertencias y pasos
- 🔴 **Rojo**: Errores
- 🔷 **Cyan**: Encabezados de secciones

---

## 🆘 Ayuda

```bash
# Ver ayuda
./deploy-trackmovil.sh --help

# Ver qué hace cada modo
./deploy-trackmovil.sh -h
```

---

## 📝 Notas Adicionales

### Cambios Locales

Si tienes cambios sin commit en `~/trackmovil`, el script:

1. Los guarda automáticamente con `git stash`
2. Hace el `git pull`
3. Puedes recuperarlos después con: `git stash pop`

### Network Modes

El script te pregunta qué modo de red usar:

- **Opción 1** (Port Mapping): Aísla el container, mapea puerto 3001→3000
- **Opción 2** (Host Network): Container usa red del host directamente

**Recomendación**: Usa opción 1 (Port Mapping) a menos que tengas problemas de conectividad.

---

## 🔗 Links Útiles

- [Documentación Docker Completa](./DOCKER_DEPLOYMENT_DESDE_CERO.md)
- [Guía Docker vs PM2](./DOCKER_VS_PM2.md)
- [Quick Start Docker](./DOCKER_QUICKSTART.md)

---

## ✅ Checklist Post-Deploy

- [ ] Container corriendo: `docker ps | grep trackmovil`
- [ ] Logs sin errores: `docker logs trackmovil | tail -20`
- [ ] Login funciona en UI
- [ ] Supabase Realtime conectado
- [ ] Mapa se visualiza correctamente

---

**¿Todo listo?** 🎉

Ahora puedes usar `./deploy-trackmovil.sh --quick` para actualizaciones rápidas!
