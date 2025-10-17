# 🎯 TrackMovil - Conexión a AS400: Solución Final

## ✅ Estado Actual

Tu aplicación está **funcionando correctamente** con datos MOCK. La conexión directa a AS400 desde Next.js tiene limitaciones técnicas en Windows.

---

## 🚫 ¿Por qué no funciona la conexión directa?

| Driver | Problema | Estado |
|--------|----------|--------|
| **ODBC** | Requiere compilación nativa + IBM i Access ODBC Driver instalado | ❌ Complejo en Windows |
| **ibm_db** | Módulo nativo no se compila correctamente en Windows | ❌ Build falla |
| **node-jt400** | Requiere Java instalado + no compatible con Next.js webpack | ❌ No funciona con Next.js |

---

## ✅ Soluciones Recomendadas

### **Opción 1: API REST Intermedia (RECOMENDADA) ⭐**

Crear un servicio separado que se conecte a AS400 y exponerlo via REST API.

#### Arquitectura:
```
Next.js (puerto 3001)
    ↓ HTTP
API REST (Python/Node/Java) (puerto 8000)
    ↓ JDBC/ODBC
AS400 (192.168.1.8)
```

#### Implementación Python (FastAPI):

```python
# api_as400.py
from fastapi import FastAPI
import jaydebeapi

app = FastAPI()

# Configuración AS400
AS400_CONFIG = {
    'driver': 'com.ibm.as400.access.AS400JDBCDriver',
    'url': 'jdbc:as400://192.168.1.8',
    'user': 'qsecofr',
    'password': 'wwm868'
}

@app.get("/coordinates")
async def get_coordinates(movilId: int, startDate: str, limit: int = 100):
    conn = jaydebeapi.connect(
        AS400_CONFIG['driver'],
        AS400_CONFIG['url'],
        [AS400_CONFIG['user'], AS400_CONFIG['password']],
        'jt400.jar'  # Descarga desde Maven
    )
    cursor = conn.cursor()
    
    query = f"""
        SELECT 
            LOGCOORDMOVILIDENTIFICADOR as identificador,
            LOGCOORDMOVILORIGEN as origen,
            LOGCOORDMOVILCOORDX as coordX,
            LOGCOORDMOVILCOORDY as coordY,
            LOGCOORDMOVILFCHINSLOG as fechaInsLog,
            LOGCOORDMOVILAUXIN2 as auxIn2,
            LOGCOORDMOVILDISTRECORRIDA as distRecorrida
        FROM GXICAGEO.LOGCOORDMOVIL
        WHERE LOGCOORDMOVILFCHINSLOG >= '{startDate}'
          AND LOGCOORDMOVILIDENTIFICADOR = {movilId}
        ORDER BY LOGCOORDMOVILFCHINSLOG DESC
        FETCH FIRST {limit} ROWS ONLY
    """
    
    cursor.execute(query)
    columns = [desc[0] for desc in cursor.description]
    results = []
    
    for row in cursor.fetchall():
        results.append(dict(zip(columns, row)))
    
    cursor.close()
    conn.close()
    
    return results

# Ejecutar: uvicorn api_as400:app --host 0.0.0.0 --port 8000
```

#### Instalar dependencias:
```bash
pip install fastapi uvicorn jaydebeapi
# Descargar jt400.jar de: https://repo1.maven.org/maven2/net/sf/jt400/jt400/
```

#### Configurar Next.js:
```env
# .env.local
DB_MODE=real
EXTERNAL_API_URL=http://localhost:8000
```

---

### **Opción 2: IBM i REST Services**

Si tu AS400 tiene IBM i REST Services habilitado:

```env
# .env.local
DB_MODE=real
EXTERNAL_API_URL=http://192.168.1.8:port/services/GXICAGEO/LOGCOORDMOVIL
```

Consulta con tu administrador AS400 si esto está disponible.

---

### **Opción 3: Microservicio Node.js Independiente**

Crear un proyecto Node.js separado (fuera de Next.js) con node-jt400:

```bash
mkdir as400-api
cd as400-api
npm init -y
npm install express node-jt400
```

```javascript
// server.js
const express = require('express');
const jt400 = require('node-jt400');

const app = express();
const pool = jt400.pool({
  host: '192.168.1.8',
  user: 'qsecofr',
  password: 'wwm868'
});

app.get('/coordinates', async (req, res) => {
  const { movilId, startDate, limit = 100 } = req.query;
  
  const query = `
    SELECT * FROM GXICAGEO.LOGCOORDMOVIL
    WHERE LOGCOORDMOVILFCHINSLOG >= '${startDate}'
      AND LOGCOORDMOVILIDENTIFICADOR = ${movilId}
    ORDER BY LOGCOORDMOVILFCHINSLOG DESC
    FETCH FIRST ${limit} ROWS ONLY
  `;
  
  try {
    const results = await pool.query(query);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(8000, () => {
  console.log('AS400 API running on port 8000');
});
```

Ejecutar:
```bash
node server.js
```

Configurar Next.js:
```env
EXTERNAL_API_URL=http://localhost:8000
```

---

### **Opción 4: Usar Datos MOCK (Actual)**

Mantener la aplicación funcionando con datos simulados:

```env
# .env.local
DB_MODE=mock
```

**Ventajas:**
- ✅ Funciona inmediatamente
- ✅ Sin dependencias externas
- ✅ Perfecto para desarrollo/demos
- ✅ Datos realistas

---

## 🔧 Configuración Actual

Tu aplicación está configurada para aceptar una API externa:

### Cambiar a API Externa

1. **Crear o configurar tu API REST**
2. **Actualizar `.env.local`:**
   ```env
   DB_MODE=real
   EXTERNAL_API_URL=http://tu-servidor:puerto/api
   ```
3. **Reiniciar servidor:**
   ```bash
   pnpm dev
   ```

### La API debe responder con este formato:

```json
GET /coordinates?movilId=693&startDate=2025-10-14&limit=100

[
  {
    "identificador": 693,
    "origen": "GPS",
    "coordX": -34.9011,
    "coordY": -56.1645,
    "fechaInsLog": "2025-10-14T10:30:00",
    "auxIn2": "INFO",
    "distRecorrida": 12.5
  },
  ...
]
```

---

## 📊 Comparación de Opciones

| Opción | Complejidad | Performance | Recomendado |
|--------|-------------|-------------|-------------|
| **API REST Python** | 🟡 Media | ✅ Alta | ⭐⭐⭐⭐⭐ |
| **IBM i REST Services** | ✅ Baja | ✅ Alta | ⭐⭐⭐⭐ (si está disponible) |
| **Microservicio Node** | 🟡 Media | ✅ Alta | ⭐⭐⭐⭐ |
| **Datos MOCK** | ✅ Muy Baja | ✅ Alta | ⭐⭐⭐ (para desarrollo) |

---

## 🚀 Recomendación Final

**Para producción:** Implementa la **Opción 1 (API REST Python con FastAPI)**

**Razones:**
1. ✅ Separación de responsabilidades
2. ✅ FastAPI es rápido y fácil de implementar
3. ✅ JayDeBeAPI funciona bien con AS400
4. ✅ Fácil de escalar y mantener
5. ✅ Puedes deployar la API y Next.js independientemente

---

## 📝 Próximos Pasos

### Para usar datos reales:

1. **Implementa la API REST** (Python recomendado)
2. **Descarga jt400.jar** desde Maven
3. **Prueba la API independientemente**
4. **Configura EXTERNAL_API_URL en .env.local**
5. **Cambia DB_MODE=real**
6. **Reinicia Next.js**

### Para desarrollo:

Mantén `DB_MODE=mock` y continúa desarrollando con datos simulados.

---

## 🆘 Soporte

Si necesitas ayuda:

1. **Para API Python:**
   - Documentación FastAPI: https://fastapi.tiangolo.com/
   - JayDeBeAPI: https://github.com/baztian/jaydebeapi

2. **Para IBM i REST Services:**
   - Contacta al administrador de tu AS400
   - Documentación: https://www.ibm.com/docs/en/i/7.5?topic=services-rest

3. **Para Microservicio Node:**
   - node-jt400: https://github.com/tryggingamidstodin/node-jt400

---

## ✨ Estado de la Aplicación

🎉 **Tu aplicación Next.js está lista y funcionando**

- ✅ Interfaz completa con mapa interactivo
- ✅ Tracking de 3 vehículos
- ✅ Auto-refresh cada 5 segundos
- ✅ Diseño moderno y responsivo
- ✅ Sistema de fallback automático
- ✅ Preparada para conectarse a API externa

**URL:** http://localhost:3001

---

**Última actualización:** Octubre 2025  
**Versión:** 3.0.0 - Arquitectura con API Externa
