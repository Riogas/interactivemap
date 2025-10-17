# 🔧 Instalación de ODBC Driver

## Problema

El módulo `odbc` requiere compilación nativa y el IBM i Access ODBC Driver para funcionar.

## Soluciones

### Opción 1: Instalar IBM i Access Client Solutions (Recomendado)

1. **Descargar IBM i Access Client Solutions**
   - Visita: https://www.ibm.com/support/pages/ibm-i-access-client-solutions
   - Descarga la versión para Windows
   - Instala el paquete completo

2. **Instalar Visual Studio Build Tools** (necesario para compilar ODBC)
   ```powershell
   # Descargar desde:
   https://visualstudio.microsoft.com/visual-cpp-build-tools/
   
   # Durante instalación, seleccionar:
   - "Desarrollo para escritorio con C++"
   - Windows 10 SDK
   ```

3. **Recompilar el módulo ODBC**
   ```bash
   pnpm rebuild odbc
   ```

### Opción 2: Usar API Intermedia (Alternativa Rápida)

Si tienes problemas con ODBC, puedes crear una API intermedia en otro servidor:

1. **Servidor Node.js separado** con acceso a DB2
2. **API Gateway** que exponga los datos
3. Esta aplicación Next.js consume esa API

#### Configuración rápida:

Edita `lib/db.ts` para usar fetch en lugar de ODBC directo:

```typescript
// En lugar de conexión directa, usa una API externa
export async function getMovilCoordinates(movilId: number) {
  const response = await fetch(`http://tu-servidor-api/coordinates?movil=${movilId}`);
  return await response.json();
}
```

### Opción 3: Modo Demo (Solo para desarrollo)

Usa datos mock para desarrollo sin DB2:

```bash
pnpm dev:mock
```

Ver archivo `lib/db-mock.ts` para datos de ejemplo.

## Verificación

Para verificar que ODBC funciona:

```powershell
node -e "const odbc = require('odbc'); console.log('ODBC OK');"
```

Si no hay errores, ODBC está listo.

## Alternativa: REST API en Python o Java

Si prefieres, puedes crear una API REST simple en Python/Java que se conecte a DB2 y exponerla para que Next.js la consuma.
