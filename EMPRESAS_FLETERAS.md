# 🏢 Sistema de Filtrado por Empresas Fleteras

## 📋 Descripción

Sistema completo de filtrado de móviles por empresas fleteras, permitiendo al usuario visualizar solo los vehículos de una o más empresas específicas.

## ✨ Funcionalidades Implementadas

### 1. **Backend - Python FastAPI** (as400-api/api_as400.py)

#### Nuevos Endpoints:

**GET `/empresas-fleteras`**
```json
{
  "success": true,
  "count": 25,
  "data": [
    {
      "eflid": 103,
      "eflnom": "EMPRESA TRANSPORTE S.A.",
      "eflestado": "A"
    }
  ]
}
```
- Lista todas las empresas fleteras desde `GXCALDTA.EFLETERA`
- Incluye ID, nombre y estado
- Ordena por nombre

**GET `/moviles-por-empresa?empresaId=103`**
```json
{
  "success": true,
  "empresaId": 103,
  "count": 15,
  "data": [
    {
      "movid": 693,
      "eflid": 103,
      "movestcod": "ACT"
    }
  ]
}
```
- Obtiene móviles de una empresa específica
- Consulta `GXCALDTA.MOVILES WHERE EFLID = X`

#### Endpoints Modificados:

**GET `/coordinates` - Ahora soporta filtrado por empresas**
```
/coordinates?movilId=693&startDate=2025-10-16&limit=100&empresaIds=103,105
```
- Nuevo parámetro opcional: `empresaIds` (separados por coma)
- Query con JOIN: `LOGCOORDMOVIL l JOIN MOVILES m ON l.LOGCOORDMOVILIDENTIFICADOR = m.MOVID`
- Filtro: `WHERE m.EFLID IN (103, 105)`

**GET `/latest-positions` - Ahora soporta filtrado por empresas**
```
/latest-positions?startDate=2025-10-16&empresaIds=103,105,107
```
- Nuevo parámetro opcional: `empresaIds` (separados por coma)
- Query optimizado con subconsulta y JOIN a MOVILES
- Filtra posiciones solo de móviles de las empresas seleccionadas

### 2. **Frontend - Next.js/TypeScript**

#### Nuevos Tipos (`types/index.ts`):
```typescript
export interface EmpresaFletera {
  eflid: number;
  eflnom: string;
  eflestado: string;
}

export interface MovilEmpresa {
  movid: number;
  eflid: number;
  movestcod: string;
}
```

#### Nuevas Funciones (`lib/db.ts`):
```typescript
// Obtener todas las empresas fleteras
getEmpresasFleteras(): Promise<EmpresaFletera[]>

// Obtener móviles de una empresa
getMovilesByEmpresa(empresaId: number): Promise<MovilEmpresa[]>

// Obtener posiciones filtradas por empresas
getAllMovilesLatestPositionsByEmpresas(
  startDate?: string,
  empresaIds?: number[]
): Promise<Map<number, MovilCoordinate>>
```

#### Nueva API Route (`app/api/empresas/route.ts`):
```typescript
GET /api/empresas
// Retorna lista de empresas fleteras
```

#### API Route Modificada (`app/api/all-positions/route.ts`):
```typescript
GET /api/all-positions?empresaIds=103,105,107
// Ahora acepta filtrado por empresas
```

### 3. **Nuevo Componente UI** (`components/ui/EmpresaSelector.tsx`)

Selector multi-opción con dropdown animado:

**Características:**
- ✅ Checkbox para cada empresa
- ✅ Botones "Todas" / "Ninguna"
- ✅ Contador de selección
- ✅ Búsqueda visual (resalta seleccionadas)
- ✅ Cierre automático al hacer click fuera
- ✅ Animaciones suaves con Framer Motion
- ✅ Botón "Aplicar Filtro"

**Estados del Botón:**
- Sin selección: "Seleccione empresas fleteras"
- Todas: "Todas las empresas (25)"
- Una: Muestra el nombre de la empresa
- Múltiples: "5 empresas seleccionadas"

### 4. **Integración en Página Principal** (`app/page.tsx`)

**Estado Agregado:**
```typescript
const [empresas, setEmpresas] = useState<EmpresaFletera[]>([]);
const [selectedEmpresas, setSelectedEmpresas] = useState<number[]>([]);
const [isLoadingEmpresas, setIsLoadingEmpresas] = useState(true);
```

**Flujo de Funcionamiento:**
1. Al montar, carga todas las empresas desde `/api/empresas`
2. Por defecto, selecciona TODAS las empresas (muestra todos los móviles)
3. Cuando el usuario cambia la selección:
   - Actualiza `selectedEmpresas`
   - `useEffect` detecta el cambio
   - Llama a `fetchPositions()` con filtro
   - Actualiza mapa y lista de móviles

**Layout:**
```
┌─────────────────────────────────────────┐
│  🏢 Empresas Fleteras                  │
│  [Selector Multi-opción]               │
├─────────────────────────────────────────┤
│  🚗 Móviles (filtrados)                │
│  [Lista de móviles]                    │
└─────────────────────────────────────────┘
```

## 🎯 Flujo de Usuario

### Escenario 1: Ver todos los móviles
1. Al cargar la app, TODAS las empresas están seleccionadas por defecto
2. Mapa muestra todos los móviles de todas las empresas
3. Panel lateral muestra lista completa

### Escenario 2: Filtrar por una empresa
1. Usuario hace click en selector de empresas
2. Deselecciona todas ("Ninguna")
3. Selecciona solo "EMPRESA TRANSPORTE S.A." (ID: 103)
4. Click en "Aplicar Filtro"
5. Mapa actualiza mostrando solo móviles de empresa 103
6. Lista lateral se filtra automáticamente
7. Si selecciona un móvil específico, funciona igual que antes

### Escenario 3: Filtrar por múltiples empresas
1. Usuario selecciona empresas 103, 105, y 107
2. Click en "Aplicar Filtro"
3. Mapa y lista muestran móviles de las 3 empresas seleccionadas
4. Coordenadas históricas respetan el filtro

### Escenario 4: Cambio dinámico
1. Usuario está viendo móviles de empresa 103
2. Agrega empresa 105 al filtro
3. Mapa actualiza instantáneamente
4. Nuevos móviles aparecen en la lista
5. Auto-refresh (cada 5s) respeta el filtro activo

## 🔧 Consultas SQL Utilizadas

### Consulta 1: Empresas Fleteras
```sql
SELECT EFLID, EFLNOM, EFLESTADO 
FROM GXCALDTA.EFLETERA 
ORDER BY EFLNOM
```

### Consulta 2: Móviles por Empresa
```sql
SELECT MOVID, EFLID, MOVESTCOD 
FROM GXCALDTA.MOVILES 
WHERE EFLID = 103
ORDER BY MOVID
```

### Consulta 3: Últimas Posiciones con Filtro (Optimizada)
```sql
SELECT 
    l.LOGCOORDMOVILIDENTIFICADOR as identificador,
    l.LOGCOORDMOVILORIGEN as origen,
    l.LOGCOORDMOVILCOORDX as coordX,
    l.LOGCOORDMOVILCOORDY as coordY,
    l.LOGCOORDMOVILFCHINSLOG as fechaInsLog,
    l.LOGCOORDMOVILAUXIN2 as auxIn2,
    l.LOGCOORDMOVILDISTRECORRIDA as distRecorrida
FROM GXICAGEO.LOGCOORDMOVIL l
INNER JOIN (
    SELECT 
        l2.LOGCOORDMOVILIDENTIFICADOR,
        MAX(l2.LOGCOORDMOVILFCHINSLOG) as max_fecha
    FROM GXICAGEO.LOGCOORDMOVIL l2
    JOIN GXCALDTA.MOVILES mov2 ON l2.LOGCOORDMOVILIDENTIFICADOR = mov2.MOVID
    WHERE l2.LOGCOORDMOVILFCHINSLOG >= '2025-10-16 00:00:00'
    AND mov2.EFLID IN (103, 105, 107)
    GROUP BY l2.LOGCOORDMOVILIDENTIFICADOR
) latest ON l.LOGCOORDMOVILIDENTIFICADOR = latest.LOGCOORDMOVILIDENTIFICADOR
        AND l.LOGCOORDMOVILFCHINSLOG = latest.max_fecha
ORDER BY l.LOGCOORDMOVILFCHINSLOG DESC
```

### Consulta 4: Historial con Filtro
```sql
SELECT 
    l.LOGCOORDMOVILIDENTIFICADOR as identificador,
    l.LOGCOORDMOVILORIGEN as origen,
    l.LOGCOORDMOVILCOORDX as coordX,
    l.LOGCOORDMOVILCOORDY as coordY,
    l.LOGCOORDMOVILFCHINSLOG as fechaInsLog,
    l.LOGCOORDMOVILAUXIN2 as auxIn2,
    l.LOGCOORDMOVILDISTRECORRIDA as distRecorrida
FROM GXICAGEO.LOGCOORDMOVIL l
JOIN GXCALDTA.MOVILES m ON l.LOGCOORDMOVILIDENTIFICADOR = m.MOVID
WHERE l.LOGCOORDMOVILFCHINSLOG >= '2025-10-16 00:00:00'
  AND l.LOGCOORDMOVILIDENTIFICADOR = 693
  AND m.EFLID IN (103, 105)
ORDER BY l.LOGCOORDMOVILFCHINSLOG DESC
FETCH FIRST 100 ROWS ONLY
```

## 📊 Performance

### Optimizaciones Implementadas:
1. **Subconsulta para MAX()**: Evita full table scan
2. **JOIN solo cuando necesario**: Si no hay filtro de empresas, no hace JOIN
3. **Índices recomendados**:
   ```sql
   CREATE INDEX IDX_MOVILES_EFLID ON GXCALDTA.MOVILES(EFLID);
   CREATE INDEX IDX_LOGCOORD_FECHA ON GXICAGEO.LOGCOORDMOVIL(LOGCOORDMOVILFCHINSLOG);
   ```

### Tiempos de Respuesta (estimados):
- `/empresas-fleteras`: < 100ms (pocas empresas)
- `/latest-positions` (sin filtro): ~500-1000ms (101 móviles)
- `/latest-positions` (con filtro): ~300-700ms (menos móviles)
- `/coordinates` (historial): ~200-500ms

## 🚀 Testing

### Casos de Prueba:

1. **Carga inicial**
   - ✅ Todas las empresas seleccionadas por defecto
   - ✅ Todos los móviles visibles en mapa
   
2. **Filtrado por una empresa**
   - ✅ Seleccionar empresa 103
   - ✅ Verificar que solo móviles de empresa 103 aparecen
   
3. **Filtrado por múltiples empresas**
   - ✅ Seleccionar 103, 105, 107
   - ✅ Verificar móviles de las 3 empresas
   
4. **Desseleccionar todas**
   - ✅ Mapa vacío / mensaje "Sin móviles"
   
5. **Cambio dinámico**
   - ✅ Agregar/quitar empresas sin recargar página
   - ✅ Auto-refresh respeta filtro activo
   
6. **Móvil individual**
   - ✅ Seleccionar móvil específico funciona con filtro
   - ✅ Historial se carga correctamente
   - ✅ Animación de recorrido funciona

## 📁 Archivos Modificados/Creados

### Modificados:
- `as400-api/api_as400.py` - Endpoints nuevos y modificados
- `lib/db.ts` - Funciones de consulta
- `types/index.ts` - Interfaces TypeScript
- `app/api/all-positions/route.ts` - Soporte para filtro
- `app/page.tsx` - Integración de selector

### Creados:
- `app/api/empresas/route.ts` - API route para empresas
- `components/ui/EmpresaSelector.tsx` - Componente selector
- `EMPRESAS_FLETERAS.md` - Esta documentación

## 💡 Notas de Uso

- **Comportamiento por defecto**: Todas las empresas seleccionadas = todos los móviles
- **Persistencia**: La selección NO persiste al recargar (puede agregarse con localStorage)
- **Performance**: Filtrar reduce la cantidad de datos → mejora rendimiento
- **Compatibilidad**: Funciona con todas las features existentes (animación, auto-refresh, etc.)

## 🔮 Mejoras Futuras

- [ ] Persistir selección en localStorage
- [ ] Agregar búsqueda de empresas por nombre
- [ ] Estadísticas por empresa (cantidad de móviles, distancia total)
- [ ] Colores diferentes por empresa en el mapa
- [ ] Exportar reporte por empresa
- [ ] Filtro rápido "Solo activas" / "Solo inactivas"
- [ ] Vista de tabla con ordenamiento por empresa

---

**Implementado**: Octubre 2025  
**Tecnologías**: Python FastAPI, Next.js, TypeScript, PostgreSQL (AS400 DB2), React, Leaflet  
**Base de datos**: AS400 DB2 (GXCALDTA, GXICAGEO)
