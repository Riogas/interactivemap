# 📦 API de Importación - Documentación

Los endpoints de importación ahora soportan **objetos individuales** Y **arrays de objetos**.

## ✅ Endpoints Disponibles

- `/api/import/moviles` - Móviles
- `/api/import/pedidos` - Pedidos
- `/api/import/demoras` - Demoras
- `/api/import/puntoventa` - Puntos de venta
- `/api/import/zonas` - Zonas

---

## 🎯 Formatos Soportados

### **1️⃣ OBJETO INDIVIDUAL** (tu caso de uso)

#### POST - Insertar un solo registro
```http
POST http://localhost:3000/api/import/moviles
Content-Type: application/json

{
  "movil_id": 251,
  "movil_nombre": "Móvil 251",
  "empresa_fletera_id": 1,
  "latitud": -34.603722,
  "longitud": -58.381592
}
```

#### PUT - Actualizar un solo registro (upsert)
```http
PUT http://localhost:3000/api/import/pedidos
Content-Type: application/json

{
  "pedido_id": 12345,
  "movil": 251,
  "descripcion": "Entrega actualizada",
  "prioridad": 1,
  "latitud": -34.603722,
  "longitud": -58.381592
}
```

---

### **2️⃣ ARRAY DE OBJETOS** (formato opcional)

#### POST - Insertar múltiples registros
```http
POST http://localhost:3000/api/import/moviles
Content-Type: application/json

{
  "moviles": [
    {
      "movil_id": 251,
      "movil_nombre": "Móvil 251"
    },
    {
      "movil_id": 252,
      "movil_nombre": "Móvil 252"
    }
  ]
}
```

O directamente el array:
```json
[
  { "movil_id": 251, "movil_nombre": "Móvil 251" },
  { "movil_id": 252, "movil_nombre": "Móvil 252" }
]
```

---

## 📋 Ejemplos por Entidad

### **Moviles**
```json
{
  "movil_id": 251,
  "movil_nombre": "Móvil 251",
  "empresa_fletera_id": 1,
  "latitud": -34.603722,
  "longitud": -58.381592,
  "estado": "disponible"
}
```

### **Pedidos**
```json
{
  "pedido_id": 12345,
  "movil": 251,
  "descripcion": "Entrega en CABA",
  "prioridad": 1,
  "latitud": -34.603722,
  "longitud": -58.381592,
  "escenario_id": 1,
  "fecha_hora_para": "2025-12-09T14:30:00Z"
}
```

### **Demoras**
```json
{
  "demora_id": 789,
  "pedido_id": 12345,
  "motivo": "Tráfico",
  "minutos": 15,
  "fecha_hora": "2025-12-09T14:00:00Z"
}
```

### **Punto de Venta**
```json
{
  "puntoventa_id": 101,
  "nombre": "Sucursal Centro",
  "direccion": "Av. Corrientes 1234",
  "latitud": -34.603722,
  "longitud": -58.381592
}
```

### **Zonas**
```json
{
  "zona_id": 1,
  "zona_nombre": "Zona Norte",
  "descripcion": "Cobertura norte de la ciudad"
}
```

---

## 🔄 Operaciones DELETE

Para eliminar, siempre se usa un array de IDs:

```http
DELETE http://localhost:3000/api/import/moviles
Content-Type: application/json

{
  "movil_ids": [251, 252, 253]
}
```

O un solo ID:
```json
{
  "movil_ids": [251]
}
```

---

## ✅ Respuestas de Éxito

```json
{
  "success": true,
  "message": "1 móvil(es) importados correctamente",
  "data": [
    {
      "movil_id": 251,
      "movil_nombre": "Móvil 251",
      ...
    }
  ]
}
```

## ❌ Respuestas de Error

```json
{
  "error": "Error al importar móviles",
  "details": "duplicate key value violates unique constraint"
}
```

---

## 🔑 Campos `onConflict` (para upsert)

- **moviles**: `movil_id`
- **pedidos**: `pedido_id`
- **demoras**: `demora_id`
- **puntoventa**: `puntoventa_id`
- **zonas**: `zona_id`

---

## 🚀 Testing en Postman

### Paso 1: Crear Request
1. Método: `POST` / `PUT` / `DELETE`
2. URL: `http://localhost:3000/api/import/moviles`
3. Headers: `Content-Type: application/json`

### Paso 2: Body (raw JSON)
```json
{
  "movil_id": 251,
  "movil_nombre": "Móvil 251",
  "empresa_fletera_id": 1
}
```

### Paso 3: Send y verificar respuesta ✅

---

## 📝 Notas Importantes

1. **POST**: Inserta nuevos registros (falla si ya existe)
2. **PUT**: Upsert (inserta si no existe, actualiza si existe)
3. **DELETE**: Elimina por IDs (siempre array)
4. **Objeto único**: Envía directamente el objeto JSON
5. **Arrays**: Envía con key (`{"moviles": [...]}`) o directo `[...]`

---

## 🎯 Tu Caso de Uso

```http
POST http://localhost:3000/api/import/moviles
Content-Type: application/json

{
  "movil_id": 251,
  "movil_nombre": "Móvil 251",
  "empresa_fletera_id": 1
}
```

✅ **Funciona perfecto sin arrays!** 🚀
