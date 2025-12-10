# 🔌 Configuración de Puertos en Servidor Linux

## Estado Actual del Servidor

```bash
CONTAINER ID   IMAGE                  PORTS                      NAMES
0aa5356ec525   securitysuite_web      0.0.0.0:4000->3000/tcp    security-users
200b4de78904   riogasgestion:latest   (sin puerto externo)       riogasgestion-app
```

## Asignación de Puertos

| Servicio          | Puerto Host | Puerto Contenedor | Estado    |
|-------------------|-------------|-------------------|-----------|
| security-users    | **4000**    | 3000              | ✅ Activo |
| riogasgestion-app | N/A         | (posiblemente 3000) | ✅ Activo |
| **TracMovil**     | **3001**    | 3000              | 🆕 Nuevo  |

## 🎯 TracMovil Configurado en Puerto 3001

Para evitar conflictos con los servicios existentes, TracMovil está configurado para:

- **Puerto interno del contenedor**: `3000` (Next.js)
- **Puerto expuesto en el host**: `3001`

### Acceso:
- **Local**: `http://localhost:3001`
- **Red externa**: `http://IP-SERVIDOR:3001`
- **Ejemplo**: `http://192.168.7.100:3001`

## Comandos de Despliegue

### Opción 1: Automático (con script)
```bash
chmod +x deploy-linux.sh
./deploy-linux.sh
```

### Opción 2: Manual
```bash
# Descomprimir
unzip trackmovil.zip

# Cargar imagen
docker load -i trackmovil.tar

# Crear .env
nano .env

# Ejecutar en puerto 3001
docker run -d \
  --name trackmovil \
  --restart unless-stopped \
  -p 3001:3000 \
  --env-file .env \
  trackmovil:latest
```

## Verificación

```bash
# Ver todos los contenedores
docker ps

# Ver logs de TracMovil
docker logs -f trackmovil

# Probar API
curl http://localhost:3001/api/all-positions

# Ver puertos en uso
sudo netstat -tulpn | grep LISTEN
```

## 🔄 Cambiar Puerto (si es necesario)

Si necesitas usar otro puerto diferente a 3001:

```bash
# Detener contenedor
docker stop trackmovil
docker rm trackmovil

# Reiniciar con nuevo puerto (ejemplo: 3002)
docker run -d \
  --name trackmovil \
  --restart unless-stopped \
  -p 3002:3000 \
  --env-file .env \
  trackmovil:latest
```

## 🌐 Configurar Nginx como Proxy Reverso (Opcional)

Si quieres acceder con un dominio en lugar de IP:PORT:

```nginx
# /etc/nginx/sites-available/trackmovil
server {
    listen 80;
    server_name trackmovil.tudominio.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Activar:
```bash
sudo ln -s /etc/nginx/sites-available/trackmovil /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 🔥 Firewall

Si tienes firewall activo, abre el puerto:

```bash
# UFW
sudo ufw allow 3001/tcp
sudo ufw status

# Firewalld
sudo firewall-cmd --permanent --add-port=3001/tcp
sudo firewall-cmd --reload
```

## 📊 Resumen de Servicios

Después del despliegue, tendrás:

1. **security-users** → `http://IP:4000`
2. **riogasgestion-app** → (puerto interno)
3. **trackmovil** → `http://IP:3001` ✨
