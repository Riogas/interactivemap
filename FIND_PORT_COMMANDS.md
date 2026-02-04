# Comandos para encontrar el puerto de Next.js

## Método 1: Ver detalles de PM2
```bash
pm2 info track
```
Busca la línea que dice "PORT" o "exec mode details"

## Método 2: Ver qué puertos usa el proceso
```bash
sudo netstat -tulpn | grep 31027
# O con ss:
sudo ss -tulpn | grep 31027
```

## Método 3: Ver las variables de entorno de PM2
```bash
pm2 env 3
# (usa el id de track que es 3)
```
Busca `PORT=` o `NEXT_PUBLIC_PORT=`

## Método 4: Ver todos los puertos que escuchan entre 3000-3010
```bash
sudo netstat -tulpn | grep ":300"
# O:
sudo ss -tulpn | grep ":300"
```

## Método 5: Test rápido de puertos comunes
```bash
curl -m 2 http://localhost:3000/
curl -m 2 http://localhost:3001/
curl -m 2 http://localhost:3002/
curl -m 2 http://localhost:3003/
```
El que responda más rápido (sin timeout) es el correcto.

## Método 6: Ver logs de PM2 al iniciar
```bash
pm2 logs track --lines 50 | grep -i "port\|local\|ready"
```
Deberías ver algo como: "- Local: http://localhost:3000"
