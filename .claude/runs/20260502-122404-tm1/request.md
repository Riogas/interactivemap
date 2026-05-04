# Feature Request

Proyecto: trackmovil (Documents/Projects/trackmovil)

## Requerimiento

En el mapa de móviles, cambiar la lógica de visualización de móviles activos sin coordenadas GPS:

1. **Móvil activo SIN coordenadas en `gps_latest_positions` Y SIN `pto_vta_lat/pto_vta_lng` en tabla `moviles`**:
   - Debe seguir apareciendo en el colapsable/listado de móviles (como está actualmente)
   - NO debe mostrarse en el mapa (no tiene ninguna coordenada)

2. **Móvil activo SIN coordenadas en `gps_latest_positions` PERO CON `pto_vta_lat` y `pto_vta_lng` poblados en tabla `moviles`**:
   - Debe generar automáticamente un registro en `gps_latest_positions` usando esas coordenadas (`pto_vta_lat`, `pto_vta_lng`) para mantener consistencia
   - Una vez creado el registro, sí debe mostrarse en el mapa (porque ahora tiene datos en la tabla de coordenadas del día)
   - Debe seguir apareciendo en el colapsable

## Objetivo

Consistencia — el mapa solo lee de `gps_latest_positions`. Si un móvil tiene `pto_vta_lat/lng` configurado pero ningún reporte GPS aún, sembrar la posición del punto de venta para que sea visible.

## A verificar

- En qué momento se ejecuta esta lógica (al cargar el mapa? endpoint? trigger DB? cron?)
- Si ya existe lógica similar de fallback al pto_vta para no romper nada
- Que el listado del colapsable siga mostrando todos los móviles activos sin importar si tienen coordenadas
- Que al refrescar/recargar no se duplique el seed (idempotencia)
