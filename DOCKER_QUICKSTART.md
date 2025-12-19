# 🚀 Deployment con Docker - Guía Rápida

## 📌 Opciones de Instalación

### **Opción 1: Script Automático Completo** ⭐ RECOMENDADO

Un solo comando que instala TODO desde cero:

```bash
# Conectarse al servidor
ssh riogas@node

# Ejecutar script de instalación
bash <(curl -sSL https://raw.githubusercontent.com/Riogas/interactivemap/main/scripts/install-docker-full.sh)
```

**Lo que hace automáticamente:**
1. ✅ Instala Docker si no está instalado
2. ✅ Configura usuario sin sudo
3. ✅ Clona el repositorio
4. ✅ Crea `.env.production` desde template
5. ✅ Te pide que configures las credenciales
6. ✅ Construye la imagen Docker
7. ✅ Inicia el contenedor
8. ✅ Verifica que funciona

**Tiempo estimado:** 10-15 minutos (primera vez)

---

### **Opción 2: Paso a Paso Manual**

Si prefieres control total, sigue la guía completa: **`DOCKER_DEPLOYMENT_DESDE_CERO.md`**

---

## 🔄 Workflow de Actualización

Una vez instalado, los updates son súper simples:

```bash
ssh riogas@node
cd ~/trackmovil
./scripts/update-trackmovil.sh
```

**Tiempo:** 2-3 minutos

---

## 📋 Comandos Esenciales

### **Ver estado del contenedor:**
```bash
docker ps | grep trackmovil
```

### **Ver logs en tiempo real:**
```bash
docker logs -f trackmovil
```

### **Reiniciar contenedor:**
```bash
docker restart trackmovil
```

### **Detener contenedor:**
```bash
docker stop trackmovil
```

### **Ver variables de entorno:**
```bash
docker exec trackmovil printenv | grep API
```

---

## 🆘 Troubleshooting Rápido

### Problema: El contenedor no inicia
```bash
docker logs trackmovil
```

### Problema: Login no funciona
```bash
# Verificar API URL
docker exec trackmovil printenv | grep EXTERNAL_API_URL

# Editar si es necesario
nano ~/trackmovil/.env.production
docker restart trackmovil
```

### Problema: Puerto ocupado
```bash
# Ver qué está usando el puerto 3001
sudo lsof -i :3001

# Cambiar a otro puerto
docker run -d --name trackmovil -p 3002:3000 --env-file .env.production --restart unless-stopped trackmovil:latest
```

---

## 🌐 URLs de Acceso

Según tu configuración:

```
# Localhost (desde el servidor)
http://localhost:3001

# Red local (desde Windows)
http://192.168.7.14:3001
```

---

## 📚 Documentación Completa

- **`DOCKER_DEPLOYMENT_DESDE_CERO.md`** - Guía paso a paso detallada
- **`DOCKER_VS_PM2.md`** - Comparación con PM2
- **`DEPLOYMENT_PM2.md`** - Alternativa con PM2

---

## ✅ Checklist Post-Instalación

- [ ] Contenedor corriendo: `docker ps | grep trackmovil`
- [ ] Logs sin errores: `docker logs trackmovil`
- [ ] Aplicación accesible: `curl http://localhost:3001`
- [ ] Login funciona
- [ ] Dashboard carga correctamente
- [ ] Mapa muestra móviles

---

## 🔐 Configuración de `.env.production`

Variables críticas que debes configurar:

```bash
# API de Login (ajusta según dónde esté tu API)
EXTERNAL_API_URL=http://localhost:3000
NEXT_PUBLIC_EXTERNAL_API_URL=http://localhost:3000

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu-anon-key
SUPABASE_SERVICE_ROLE_KEY=tu-service-role-key
```

---

## 🎯 Próximos Pasos Opcionales

1. **Configurar dominio con Nginx**
2. **Habilitar HTTPS con Let's Encrypt**
3. **Setup de backups automáticos**
4. **Configurar monitoreo**
5. **CI/CD con GitHub Actions**

---

**¿Necesitas ayuda?** Lee la documentación completa en `DOCKER_DEPLOYMENT_DESDE_CERO.md` 📖
