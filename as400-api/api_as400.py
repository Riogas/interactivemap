"""
API REST para conectar Next.js con AS400 DB2
Usa JT400 (Open Source IBM Toolbox para Java) via JayDeBeAPI
"""

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from typing import Optional, List, Dict, Any
import jaydebeapi
import os
import json
from dotenv import load_dotenv
from datetime import datetime, timedelta
import logging
import time
import signal
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError

# Configurar logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Cargar variables de entorno
load_dotenv()

# 🔧 ENCODING FIX: Forzar UTF-8 como encoding por defecto del proceso Python
import sys
if sys.stdout.encoding != 'utf-8':
    logger.warning(f"⚠️ stdout encoding es {sys.stdout.encoding}, no UTF-8")
os.environ['PYTHONIOENCODING'] = 'utf-8'

# 🔥 CACHÉ SIMPLE para evitar consultas repetitivas a AS400
# Cache de últimas posiciones con TTL de 30 segundos
CACHE = {
    'latest_positions': {
        'data': None,
        'timestamp': None,
        'ttl_seconds': 30  # Cache válido por 30 segundos
    }
}

def get_cached_data(cache_key: str):
    """Obtener datos del cache si son recientes"""
    if cache_key not in CACHE:
        return None
    
    cache_entry = CACHE[cache_key]
    if cache_entry['data'] is None or cache_entry['timestamp'] is None:
        return None
    
    # Verificar si el cache expiró
    elapsed = (datetime.now() - cache_entry['timestamp']).total_seconds()
    if elapsed > cache_entry['ttl_seconds']:
        logger.info(f"💨 Cache expirado para {cache_key} (edad: {elapsed:.1f}s)")
        return None
    
    logger.info(f"✨ Cache HIT para {cache_key} (edad: {elapsed:.1f}s)")
    return cache_entry['data']

def set_cached_data(cache_key: str, data: Any):
    """Guardar datos en cache"""
    CACHE[cache_key]['data'] = data
    CACHE[cache_key]['timestamp'] = datetime.now()
    logger.info(f"💾 Cache actualizado para {cache_key}")

# 🔧 ENCODING FIX: Respuesta JSON con charset=utf-8 explícito y ensure_ascii=False
# para que ñ, á, é, í, ó, ú se serialicen correctamente (no como \u00f1 etc.)
class UTF8JSONResponse(JSONResponse):
    media_type = "application/json; charset=utf-8"
    
    def render(self, content: Any) -> bytes:
        return json.dumps(
            content,
            ensure_ascii=False,
            allow_nan=False,
            indent=None,
            separators=(",", ":"),
            default=str,
        ).encode("utf-8")


app = FastAPI(
    title="TrackMovil AS400 API",
    description="API REST para consultar datos de tracking de vehículos desde AS400 DB2",
    version="1.0.0",
    default_response_class=UTF8JSONResponse,
)

# Middleware deshabilitado temporalmente para diagnosticar
# @app.middleware("http")
# async def log_requests(request: Request, call_next):
#     start_time = time.time()
#     
#     # Log tanto con logger como con print para estar seguros
#     msg = f"🌐 {request.method} {request.url.path} Query: {dict(request.query_params)}"
#     logger.info(msg)
#     print(f"\n{'='*60}")
#     print(msg)
#     print(f"{'='*60}\n")
#     
#     response = await call_next(request)
#     
#     process_time = time.time() - start_time
#     result_msg = f"✅ Completed in {process_time:.2f}s - Status: {response.status_code}"
#     logger.info(result_msg)
#     print(result_msg)
#     
#     return response

# Configurar CORS para permitir requests desde Next.js
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3002"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuración AS400
# 🔧 ENCODING FIX: Se agregan propiedades de traducción de caracteres al JDBC URL.
# - translate binary=true: Fuerza traducción de campos CCSID 65535 (binary/hex) al CCSID del job
# - ccsid=1208: Solicita que el driver convierta datos a UTF-8 (CCSID 1208 = UTF-8 en AS400)
# Sin estas propiedades, ñ y vocales acentuadas (á,é,í,ó,ú) llegan con caracteres incorrectos.
AS400_CONFIG = {
    'driver': 'com.ibm.as400.access.AS400JDBCDriver',
    'url': f"jdbc:as400://{os.getenv('DB_HOST', '192.168.1.8')};translate binary=true;ccsid=1208",
    'user': os.getenv('DB_USER', 'qsecofr'),
    'password': os.getenv('DB_PASSWORD', 'wwm868'),
    'schema': os.getenv('DB_SCHEMA', 'GXICAGEO')
}

# Path al driver JT400
JT400_JAR = os.getenv('JT400_JAR_PATH', './jt400.jar')


def _connect_to_db():
    """Función auxiliar para conectar (se ejecutará en thread)"""
    # Forzar Java 21 para evitar crashes con JPype + Python 3.13
    os.environ['JAVA_HOME'] = r'C:\Program Files\Java\jdk-21'
    logger.info(f"☕ Usando JAVA_HOME: {os.environ['JAVA_HOME']}")
    
    # 🔧 ENCODING FIX: Pasar propiedades de conexión para forzar traducción de caracteres
    # Estas propiedades complementan las del JDBC URL y aseguran la conversión EBCDIC → UTF-8
    conn_props = {
        'user': AS400_CONFIG['user'],
        'password': AS400_CONFIG['password'],
        'translate binary': 'true',
        'sort': 'language',
        'sort language': 'ESP',
    }
    
    return jaydebeapi.connect(
        AS400_CONFIG['driver'],
        AS400_CONFIG['url'],
        conn_props,
        JT400_JAR
    )


def get_db_connection(timeout_seconds=10):
    """Crear conexión a AS400 usando JayDeBeAPI con timeout"""
    try:
        logger.info(f"🔵 Intentando conectar a AS400: {AS400_CONFIG['url']} (timeout: {timeout_seconds}s)")
        
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(_connect_to_db)
            try:
                conn = future.result(timeout=timeout_seconds)
                logger.info("✅ Conexión exitosa a AS400")
                return conn
            except FuturesTimeoutError:
                logger.error(f"⏱️ Timeout: No se pudo conectar a AS400 en {timeout_seconds} segundos")
                raise HTTPException(
                    status_code=504,
                    detail=f"Timeout conectando a AS400 después de {timeout_seconds}s. Verifica que AS400 está accesible."
                )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error conectando a AS400: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Error de conexión a AS400: {str(e)}"
        )


def execute_query(query: str) -> List[Dict[str, Any]]:
    """Ejecutar query y retornar resultados como lista de diccionarios"""
    conn = None
    cursor = None
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        logger.info(f"🔍 Ejecutando query: {query[:100]}...")
        cursor.execute(query)
        
        # Obtener nombres de columnas
        columns = [desc[0].lower() for desc in cursor.description]
        
        # Convertir filas a diccionarios
        results = []
        for row in cursor.fetchall():
            row_dict = {}
            for i, value in enumerate(row):
                col_name = columns[i]
                
                # Convertir tipos de datos
                if isinstance(value, datetime):
                    row_dict[col_name] = value.isoformat()
                elif value is None:
                    row_dict[col_name] = None
                elif isinstance(value, (bytes, bytearray)):
                    # 🔧 ENCODING FIX: JayDeBeAPI puede devolver bytes para campos CHAR/VARCHAR
                    # de AS400 con CCSID 65535. Intentar decodificar con múltiples encodings.
                    try:
                        row_dict[col_name] = value.decode('utf-8')
                    except UnicodeDecodeError:
                        try:
                            row_dict[col_name] = value.decode('latin-1')
                        except UnicodeDecodeError:
                            try:
                                row_dict[col_name] = value.decode('cp1252')
                            except UnicodeDecodeError:
                                row_dict[col_name] = value.decode('utf-8', errors='replace')
                                logger.warning(f"⚠️ Encoding fallback (replace) para columna {col_name}")
                elif isinstance(value, str):
                    row_dict[col_name] = value
                else:
                    row_dict[col_name] = value
            
            results.append(row_dict)
        
        logger.info(f"✅ Query exitoso: {len(results)} filas retornadas")
        return results
    
    except Exception as e:
        logger.error(f"❌ Error en query: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Error ejecutando query: {str(e)}"
        )
    
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@app.get("/")
async def root():
    """Endpoint raíz - información de la API"""
    print("🌐 ROOT ENDPOINT LLAMADO!", flush=True)
    logger.info("Root endpoint llamado")
    return {
        "api": "TrackMovil AS400 API",
        "version": "1.0.0",
        "status": "running",
        "endpoints": {
            "latest-positions": "/latest-positions?startDate=2025-10-14 (última posición de TODOS los móviles)",
            "latest-positions-filtered": "/latest-positions?startDate=2025-10-14&movilIds=693,251,337 (última posición de móviles específicos)",
            "coordinates": "/coordinates?movilId=693&startDate=2025-10-14 (última coordenada de UN móvil)",
            "coordinates-history": "/coordinates?movilId=693&startDate=2025-10-14&limit=100 (historial de UN móvil)",
            "all-coordinates": "/all-coordinates?startDate=2025-10-14 (historial de TODOS los móviles)",
            "health": "/health",
            "test-db": "/test-db (prueba conexión AS400)",
            "docs": "/docs"
        }
    }


@app.get("/ping")
async def ping():
    """Endpoint ultra simple para verificar que la API responde"""
    print("🏓 PING RECIBIDO!", flush=True)
    logger.info("🏓 PING recibido")
    return {"status": "ok", "message": "pong", "timestamp": datetime.now().isoformat()}


@app.get("/coordinates-mock")
async def get_coordinates_mock(
    movilId: int = Query(..., description="ID del vehículo"),
    startDate: str = Query("2025-10-14", description="Fecha inicial"),
    limit: int = Query(10, description="Límite de registros")
):
    """Endpoint de prueba que devuelve datos simulados (NO consulta AS400)"""
    logger.info(f"📥 MOCK Request: movilId={movilId}, startDate={startDate}, limit={limit}")
    
    # Datos de prueba para verificar que la comunicación funciona
    mock_data = [
        {
            "identificador": movilId,
            "origen": "GPS",
            "coordx": -34.9011 + (i * 0.001),
            "coordy": -56.1645 + (i * 0.001),
            "fechainslog": f"{startDate}T{10+i}:30:00",
            "auxin2": "TEST",
            "distrecorrida": 10.5 + i
        }
        for i in range(min(limit, 10))
    ]
    
    return {
        "success": True,
        "movilId": movilId,
        "startDate": startDate,
        "count": len(mock_data),
        "data": mock_data,
        "note": "DATOS DE PRUEBA - No son datos reales de AS400"
    }


@app.get("/health")
async def health_check():
    """Verificar estado de la API"""
    return {
        "status": "healthy",
        "api": "running",
        "timestamp": datetime.now().isoformat(),
        "message": "API is running. Use /test-db to test AS400 connection"
    }


@app.get("/test-db")
async def test_database():
    """Probar conexión con AS400 (puede tardar)"""
    try:
        logger.info("🔍 Intentando conectar a AS400...")
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT 1 FROM SYSIBM.SYSDUMMY1")
        cursor.fetchone()
        cursor.close()
        conn.close()
        
        return {
            "status": "success",
            "database": "connected",
            "host": AS400_CONFIG['url'],
            "timestamp": datetime.now().isoformat()
        }
    
    except Exception as e:
        logger.error(f"❌ Error de conexión: {str(e)}")
        return {
            "status": "error",
            "database": "disconnected",
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }


@app.get("/empresas-fleteras")
async def get_empresas_fleteras():
    """
    Obtener lista de todas las empresas fleteras
    
    Returns:
        Lista de empresas con EFLID, EFLNOM (nombre), EFLESTADO
    """
    try:
        logger.info("📋 Obteniendo empresas fleteras...")
        
        query = """
            SELECT EFLID, EFLNOM, EFLESTADO 
            FROM GXCALDTA.EFLETERA 
            ORDER BY EFLNOM
        """
        
        results = execute_query(query)
        
        # Procesar resultados para limpiar espacios en CHAR fields
        for row in results:
            if 'eflnom' in row and row['eflnom']:
                row['eflnom'] = str(row['eflnom']).strip()
            if 'eflestado' in row and row['eflestado']:
                row['eflestado'] = str(row['eflestado']).strip()
        
        logger.info(f"✅ {len(results)} empresas fleteras encontradas")
        
        return {
            "success": True,
            "count": len(results),
            "data": results,
            "timestamp": datetime.now().isoformat()
        }
    
    except Exception as e:
        logger.error(f"❌ Error obteniendo empresas fleteras: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/moviles-por-empresa")
async def get_moviles_por_empresa(
    empresaId: int = Query(..., description="ID de la empresa fletera (EFLID)")
):
    """
    Obtener móviles de una empresa fletera específica
    
    Args:
        empresaId: ID de la empresa fletera
        
    Returns:
        Lista de móviles con MOVID, EFLID, MOVESTCOD
    """
    try:
        logger.info(f"🚗 Obteniendo móviles de empresa {empresaId}...")
        
        query = f"""
            SELECT MOVID, EFLID, MOVESTCOD 
            FROM GXCALDTA.MOVILES 
            WHERE EFLID = {empresaId}
            ORDER BY MOVID
        """
        
        results = execute_query(query)
        
        # Procesar resultados para limpiar espacios
        for row in results:
            if 'movestcod' in row and row['movestcod']:
                row['movestcod'] = str(row['movestcod']).strip()
        
        logger.info(f"✅ {len(results)} móviles encontrados para empresa {empresaId}")
        
        return {
            "success": True,
            "empresaId": empresaId,
            "count": len(results),
            "data": results,
            "timestamp": datetime.now().isoformat()
        }
    
    except Exception as e:
        logger.error(f"❌ Error obteniendo móviles de empresa {empresaId}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/coordinates")
async def get_coordinates(
    movilId: int = Query(..., description="ID del vehículo a consultar"),
    startDate: str = Query(..., description="Fecha inicial en formato YYYY-MM-DD"),
    limit: int = Query(1, ge=1, le=1000, description="Límite de registros (1-1000, default: 1 = más reciente)"),
    empresaIds: Optional[str] = Query(None, description="IDs de empresas fleteras separados por coma (opcional)")
):
    """
    Obtener coordenadas de un vehículo específico (por defecto solo la más reciente)
    
    Parámetros:
    - movilId: ID del vehículo (ej: 693, 251, 337)
    - startDate: Fecha inicial en formato YYYY-MM-DD (ej: 2025-10-14)
    - limit: Cantidad máxima de registros a retornar (default: 1 = solo la más reciente)
    
    Retorna lista de coordenadas con formato:
    ```json
    [
      {
        "identificador": 693,
        "origen": "GPS",
        "coordx": -34.9011,
        "coordy": -56.1645,
        "fechainslog": "2025-10-14T10:30:00",
        "auxin2": "INFO",
        "distrecorrida": 12.5
      }
    ]
    ```
    """
    
    logger.info(f"📥 Request recibido: movilId={movilId}, startDate={startDate}, limit={limit}")
    
    try:
        # Validar formato de fecha
        try:
            datetime.strptime(startDate, '%Y-%m-%d')
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="Formato de fecha inválido. Use YYYY-MM-DD"
            )
        
        # Construir query con JOIN opcional para filtro de empresas
        schema = AS400_CONFIG['schema']
        
        # Determinar si necesitamos JOIN con MOVILES
        if empresaIds:
            empresa_list = empresaIds.split(',')
            empresa_filter = f"AND m.EFLID IN ({','.join(empresa_list)})"
            
            query = f"""
                SELECT 
                    l.LOGCOORDMOVILIDENTIFICADOR as identificador,
                    l.LOGCOORDMOVILORIGEN as origen,
                    l.LOGCOORDMOVILCOORDX as coordX,
                    l.LOGCOORDMOVILCOORDY as coordY,
                    l.LOGCOORDMOVILFCHINSLOG as fechaInsLog,
                    l.LOGCOORDMOVILAUXIN2 as auxIn2,
                    l.LOGCOORDMOVILDISTRECORRIDA as distRecorrida,
                    l.LOGCOORDMOVILOBS as obs,
                    l.LOGCOORDMOVILpedid as pedidoId,
                    l.logcoordmovilcoordclix as clienteX,
                    l.logcoordmovilcoordcliy as clienteY
                FROM {schema}.LOGCOORDMOVIL l
                JOIN GXCALDTA.MOVILES m ON l.LOGCOORDMOVILIDENTIFICADOR = m.MOVID
                WHERE l.LOGCOORDMOVILFCHINSLOG >= '{startDate}'
                  AND l.LOGCOORDMOVILIDENTIFICADOR = {movilId}
                  AND l.LOGCOORDMOVILCOORDX BETWEEN -35 AND -30
                  AND l.LOGCOORDMOVILCOORDY BETWEEN -58 AND -53
                  {empresa_filter}
                ORDER BY l.LOGCOORDMOVILFCHINSLOG DESC
                FETCH FIRST {limit} ROWS ONLY
            """
        else:
            query = f"""
                SELECT 
                    LOGCOORDMOVILIDENTIFICADOR as identificador,
                    LOGCOORDMOVILORIGEN as origen,
                    LOGCOORDMOVILCOORDX as coordX,
                    LOGCOORDMOVILCOORDY as coordY,
                    LOGCOORDMOVILFCHINSLOG as fechaInsLog,
                    LOGCOORDMOVILAUXIN2 as auxIn2,
                    LOGCOORDMOVILDISTRECORRIDA as distRecorrida,
                    LOGCOORDMOVILOBS as obs,
                    LOGCOORDMOVILpedid as pedidoId,
                    logcoordmovilcoordclix as clienteX,
                    logcoordmovilcoordcliy as clienteY
                FROM {schema}.LOGCOORDMOVIL
                WHERE LOGCOORDMOVILFCHINSLOG >= '{startDate}'
                  AND LOGCOORDMOVILIDENTIFICADOR = {movilId}
                  AND LOGCOORDMOVILCOORDX BETWEEN -35 AND -30
                  AND LOGCOORDMOVILCOORDY BETWEEN -58 AND -53
                ORDER BY LOGCOORDMOVILFCHINSLOG DESC
                FETCH FIRST {limit} ROWS ONLY
            """
        
        # LOG: Imprimir query completo para debugging
        logger.info(f"🔍 QUERY COMPLETO:\n{query}")
        
        results = execute_query(query)
        
        # LOG: Contar tipos de origen en los resultados
        origen_counts = {}
        updpedidos_count = 0
        for r in results:
            origen = r.get('origen', '').strip() if r.get('origen') else 'N/A'
            origen_counts[origen] = origen_counts.get(origen, 0) + 1
            if origen in ['UPDPEDIDOS', 'DYLPEDIDOS']:
                updpedidos_count += 1
                logger.info(f"  📦 {origen}: pedidoId={r.get('pedidoid')}, clienteX={r.get('clientex')}, clienteY={r.get('clientey')}")
        
        logger.info(f"✅ Retrieved {len(results)} coordinates from AS400")
        logger.info(f"📊 Origen breakdown: {origen_counts}")
        logger.info(f"🎯 Pedidos completados encontrados: {updpedidos_count}")
        
        return {
            "success": True,
            "movilId": movilId,
            "startDate": startDate,
            "count": len(results),
            "data": results
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error en /coordinates: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Error obteniendo coordenadas: {str(e)}"
        )


@app.get("/latest-positions")
async def get_latest_positions(
    startDate: str = Query(..., description="Fecha inicial en formato YYYY-MM-DD HH:MM:SS o YYYY-MM-DD"),
    movilIds: Optional[str] = Query(None, description="IDs de vehículos separados por comas (ej: 693,251,337). Si no se especifica, retorna todos los móviles."),
    empresaIds: Optional[str] = Query(None, description="IDs de empresas fleteras separados por coma (ej: 103,105). Filtra móviles por empresa.")
):
    """
    Obtener la ÚLTIMA posición de cada móvil (solo una coordenada por móvil)
    
    Parámetros:
    - startDate: Fecha inicial (ej: '2025-10-14' o '2025-10-14 14:30:00')
    - movilIds: IDs de vehículos separados por comas (opcional)
    
    Retorna un objeto por cada móvil con su última coordenada registrada.
    """
    
    # 🔥 INTENTAR USAR CACHE PRIMERO (solo para consultas sin filtros específicos)
    cache_key = f"latest_positions_{startDate}_{movilIds}_{empresaIds}"
    if not movilIds and not empresaIds:  # Solo cachear consultas generales
        cached = get_cached_data('latest_positions')
        if cached:
            return cached
    
    logger.info(f"📥 /latest-positions - startDate={startDate}, movilIds={movilIds}")
    
    try:
        # Validar y formatear fecha
        try:
            if ' ' in startDate:
                # Ya tiene hora
                datetime.strptime(startDate, '%Y-%m-%d %H:%M:%S')
                fecha_filtro = startDate
            else:
                # Solo fecha, agregar hora 00:00:00
                datetime.strptime(startDate, '%Y-%m-%d')
                fecha_filtro = f"{startDate} 00:00:00"
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="Formato de fecha inválido. Use 'YYYY-MM-DD' o 'YYYY-MM-DD HH:MM:SS'"
            )
        
        # Construir filtro de vehículos
        movil_filter = ""
        if movilIds:
            ids = [int(id.strip()) for id in movilIds.split(',')]
            movil_filter = f"AND l.LOGCOORDMOVILIDENTIFICADOR IN ({','.join(map(str, ids))})"
            logger.info(f"🔍 Filtrando móviles: {ids}")
        else:
            logger.info(f"🔍 Sin filtro de móviles - retornando todos")
        
        # Construir filtro de empresas fleteras
        empresa_filter = ""
        if empresaIds:
            emp_ids = [int(id.strip()) for id in empresaIds.split(',')]
            empresa_filter = f"AND mov.EFLID IN ({','.join(map(str, emp_ids))})"
            logger.info(f"🏢 Filtrando empresas fleteras: {emp_ids}")
        
        schema = AS400_CONFIG['schema']
        
        # Filtros geográficos de Uruguay (aproximado)
        # Uruguay: Lat -30° a -35°, Lng -53° a -58°
        
        # Query optimizado con JOIN a MOVILES para filtrar por empresa fletera
        query = f"""
            SELECT 
                l.LOGCOORDMOVILIDENTIFICADOR as identificador,
                l.LOGCOORDMOVILORIGEN as origen,
                l.LOGCOORDMOVILCOORDX as coordX,
                l.LOGCOORDMOVILCOORDY as coordY,
                l.LOGCOORDMOVILFCHINSLOG as fechaInsLog,
                l.LOGCOORDMOVILAUXIN2 as auxIn2,
                l.LOGCOORDMOVILDISTRECORRIDA as distRecorrida,
                l.LOGCOORDMOVILOBS as obs,
                l.LOGCOORDMOVILpedid as pedidoId,
                l.logcoordmovilcoordclix as clienteX,
                l.logcoordmovilcoordcliy as clienteY
            FROM {schema}.LOGCOORDMOVIL l
            INNER JOIN (
                SELECT 
                    l2.LOGCOORDMOVILIDENTIFICADOR,
                    MAX(l2.LOGCOORDMOVILFCHINSLOG) as max_fecha
                FROM {schema}.LOGCOORDMOVIL l2
                {"JOIN GXCALDTA.MOVILES mov2 ON l2.LOGCOORDMOVILIDENTIFICADOR = mov2.MOVID" if empresa_filter else ""}
                WHERE l2.LOGCOORDMOVILFCHINSLOG >= '{fecha_filtro}'
                  AND l2.LOGCOORDMOVILCOORDX BETWEEN -35 AND -30
                  AND l2.LOGCOORDMOVILCOORDY BETWEEN -58 AND -53
                {movil_filter}
                {"AND mov2.EFLID IN (" + ','.join(map(str, [int(id.strip()) for id in empresaIds.split(',')])) + ")" if empresaIds else ""}
                GROUP BY l2.LOGCOORDMOVILIDENTIFICADOR
            ) latest ON l.LOGCOORDMOVILIDENTIFICADOR = latest.LOGCOORDMOVILIDENTIFICADOR
                    AND l.LOGCOORDMOVILFCHINSLOG = latest.max_fecha
            {"JOIN GXCALDTA.MOVILES mov ON l.LOGCOORDMOVILIDENTIFICADOR = mov.MOVID" if empresa_filter else ""}
            WHERE l.LOGCOORDMOVILCOORDX BETWEEN -35 AND -30
              AND l.LOGCOORDMOVILCOORDY BETWEEN -58 AND -53
              {empresa_filter[4:] if empresa_filter else ""}
            ORDER BY l.LOGCOORDMOVILFCHINSLOG DESC
        """
        
        results = execute_query(query)
        
        response = {
            "success": True,
            "startDate": startDate,
            "count": len(results),
            "data": results,
            "cached": False
        }
        
        # 💾 GUARDAR EN CACHE (solo consultas generales)
        if not movilIds and not empresaIds:
            set_cached_data('latest_positions', response)
        
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error en /latest-positions: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Error obteniendo últimas posiciones: {str(e)}"
        )


@app.get("/all-coordinates")
async def get_all_coordinates(
    startDate: str = Query(..., description="Fecha inicial en formato YYYY-MM-DD"),
    movilIds: Optional[str] = Query(None, description="IDs de vehículos separados por comas (ej: 693,251,337)"),
    limit: int = Query(100, ge=1, le=1000, description="Límite de registros por vehículo")
):
    """
    Obtener coordenadas históricas de múltiples vehículos (MÚLTIPLES registros por móvil)
    
    Parámetros:
    - startDate: Fecha inicial en formato YYYY-MM-DD
    - movilIds: IDs de vehículos separados por comas (opcional, si no se especifica retorna todos)
    - limit: Cantidad máxima de registros por vehículo
    """
    
    try:
        # Validar formato de fecha
        try:
            datetime.strptime(startDate, '%Y-%m-%d')
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="Formato de fecha inválido. Use YYYY-MM-DD"
            )
        
        # Construir filtro de vehículos
        movil_filter = ""
        if movilIds:
            ids = [int(id.strip()) for id in movilIds.split(',')]
            movil_filter = f"AND LOGCOORDMOVILIDENTIFICADOR IN ({','.join(map(str, ids))})"
        
        # Construir query
        schema = AS400_CONFIG['schema']
        query = f"""
            SELECT 
                LOGCOORDMOVILIDENTIFICADOR as identificador,
                LOGCOORDMOVILORIGEN as origen,
                LOGCOORDMOVILCOORDX as coordX,
                LOGCOORDMOVILCOORDY as coordY,
                LOGCOORDMOVILFCHINSLOG as fechaInsLog,
                LOGCOORDMOVILAUXIN2 as auxIn2,
                LOGCOORDMOVILDISTRECORRIDA as distRecorrida,
                LOGCOORDMOVILOBS as obs,
                LOGCOORDMOVILpedid as pedidoId,
                logcoordmovilcoordclix as clienteX,
                logcoordmovilcoordcliy as clienteY
            FROM {schema}.LOGCOORDMOVIL
            WHERE LOGCOORDMOVILFCHINSLOG >= '{startDate}'
              AND LOGCOORDMOVILCOORDX BETWEEN -35 AND -30
              AND LOGCOORDMOVILCOORDY BETWEEN -58 AND -53
              {movil_filter}
            ORDER BY LOGCOORDMOVILIDENTIFICADOR, LOGCOORDMOVILFCHINSLOG DESC
            FETCH FIRST {limit * (len(movilIds.split(',')) if movilIds else 10)} ROWS ONLY
        """
        
        results = execute_query(query)
        
        return {
            "success": True,
            "startDate": startDate,
            "count": len(results),
            "data": results
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error en /all-coordinates: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Error obteniendo coordenadas: {str(e)}"
        )


@app.get("/pedidos-servicios/{movil_id}")
async def get_pedidos_servicios_movil(
    movil_id: int,
    fecha_desde: Optional[str] = Query(None, description="Fecha desde en formato YYYY-MM-DD HH:MM:SS")
):
    """
    Obtiene pedidos y servicios asignados a un móvil en una fecha específica.
    Retorna ambos tipos unificados con información del cliente.
    """
    try:
        logger.info(f"📦 Consultando pedidos/servicios del móvil {movil_id} desde {fecha_desde}")
        
        # Si no se proporciona fecha, usar fecha actual (solo el día, sin hora)
        if not fecha_desde:
            fecha_desde = datetime.now().strftime('%Y-%m-%d')
        
        # Extraer solo la fecha (sin hora) para comparar por día completo
        fecha_solo = fecha_desde.split(' ')[0] if ' ' in fecha_desde else fecha_desde
        fecha_inicio = f"{fecha_solo} 00:00:00"
        fecha_fin = f"{fecha_solo} 23:59:59"
        
        logger.info(f"📅 Filtrando pedidos/servicios entre {fecha_inicio} y {fecha_fin}")
        
        query = """
            SELECT *
            FROM (
              SELECT 
                CAST('PEDIDO' AS VARCHAR(10)) AS TIPO,
                p.PEDID AS ID,
                p.CLIID,
                c.CLINOM,
                p.PEDFCHPARA AS FECHA,
                p.PEDDIRCORX AS X,
                p.PEDDIRCORY AS Y,
                p.PEDESTCOD AS ESTADO,
                p.PEDSUBESTC AS SUBESTADO
              FROM GXCALDTA.PEDIDOS p
              JOIN GXCALDTA.CLIENTE c ON p.CLIID = c.CLIID 
              WHERE p.PEDFECHAPA >= ?
                AND p.PEDFECHAPA <= ?
                AND p.PEDMOVIL = ?

              UNION ALL

              SELECT 
                CAST('SERVICIO' AS VARCHAR(10)) AS TIPO,
                s.SERVTID AS ID,
                s.CLIID,
                c.CLINOM,
                s.SERVTFCHFI AS FECHA,
                s.SERVTDCORX AS X,
                s.SERVTDCORY AS Y,
                s.SERVTESTCO AS ESTADO,
                s.SERVTSESTC AS SUBESTADO
              FROM GXCALDTA.SERVICES s
              JOIN GXCALDTA.CLIENTE c ON s.CLIID = c.CLIID 
              WHERE s.SERVTFCHFI >= ?
                AND s.SERVTFCHFI <= ?
                AND s.SERVTMOVIL = ?
            ) t
            ORDER BY t.FECHA DESC
        """
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Ejecutar query con parámetros (fecha_inicio, fecha_fin para cada parte del UNION)
        cursor.execute(query, (fecha_inicio, fecha_fin, movil_id, fecha_inicio, fecha_fin, movil_id))
        
        columns = [desc[0] for desc in cursor.description]
        rows = cursor.fetchall()
        
        cursor.close()
        conn.close()
        
        # Convertir a lista de diccionarios
        data = []
        for row in rows:
            item = {}
            for i, col in enumerate(columns):
                value = row[i]
                # Convertir valores según tipo
                if isinstance(value, str):
                    value = value.strip()
                item[col.lower()] = value
            data.append(item)
        
        logger.info(f"✅ {len(data)} pedidos/servicios encontrados para móvil {movil_id}")
        
        return {
            "success": True,
            "movilId": movil_id,
            "fechaDesde": fecha_desde,
            "count": len(data),
            "data": data
        }
        
    except Exception as e:
        logger.error(f"❌ Error obteniendo pedidos/servicios: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Error obteniendo pedidos/servicios: {str(e)}"
        )


@app.get("/pedidos-servicios-pendientes/{movil_id}")
async def get_pedidos_servicios_pendientes(
    movil_id: int,
    fecha_desde: Optional[str] = Query(None, description="Fecha desde en formato YYYY-MM-DD HH:MM:SS")
):
    """
    Obtiene solo pedidos y servicios PENDIENTES (estado = 1) de un móvil.
    Incluye contadores separados por tipo.
    """
    try:
        logger.info(f"⏳ Consultando pendientes del móvil {movil_id}")
        
        if not fecha_desde:
            fecha_desde = datetime.now().strftime('%Y-%m-%d 00:00:00')
        
        # Calcular fecha_hasta (día siguiente a las 00:00:00)
        fecha_hasta = (datetime.strptime(fecha_desde, '%Y-%m-%d %H:%M:%S') + timedelta(days=1)).strftime('%Y-%m-%d 00:00:00')
        
        query = """
            SELECT *
            FROM (
              SELECT 
                CAST('PEDIDO' AS VARCHAR(10)) AS TIPO,
                p.PEDID AS ID,
                p.CLIID,
                c.CLINOM,
                p.PEDFCHPARA AS FECHA,
                p.PEDDIRCORX AS X,
                p.PEDDIRCORY AS Y,
                p.PEDESTCOD AS ESTADO,
                p.PEDSUBESTC AS SUBESTADO
              FROM GXCALDTA.PEDIDOS p
              JOIN GXCALDTA.CLIENTE c ON p.CLIID = c.CLIID 
              WHERE p.PEDFECHAPA >= ? AND p.PEDFECHAPA < ?
                AND p.PEDMOVIL = ?
                AND p.PEDESTCOD = 1

              UNION ALL

              SELECT 
                CAST('SERVICIO' AS VARCHAR(10)) AS TIPO,
                s.SERVTID AS ID,
                s.CLIID,
                c.CLINOM,
                s.SERVTFCHFI AS FECHA,
                s.SERVTDCORX AS X,
                s.SERVTDCORY AS Y,
                s.SERVTESTCO AS ESTADO,
                s.SERVTSESTC AS SUBESTADO
              FROM GXCALDTA.SERVICES s
              JOIN GXCALDTA.CLIENTE c ON s.CLIID = c.CLIID 
              WHERE s.SERVTFCHFI >= ? AND s.SERVTFCHFI < ?
                AND s.SERVTMOVIL = ?
                AND s.SERVTESTCO = 1
            ) t
            ORDER BY t.FECHA DESC
        """
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute(query, (fecha_desde, fecha_hasta, movil_id, fecha_desde, fecha_hasta, movil_id))
        
        columns = [desc[0] for desc in cursor.description]
        rows = cursor.fetchall()
        
        cursor.close()
        conn.close()
        
        # Convertir y contar por tipo
        data = []
        pedidos_count = 0
        servicios_count = 0
        
        for row in rows:
            item = {}
            for i, col in enumerate(columns):
                value = row[i]
                if isinstance(value, str):
                    value = value.strip()
                item[col.lower()] = value
            
            # Contar por tipo
            if item['tipo'] == 'PEDIDO':
                pedidos_count += 1
            else:
                servicios_count += 1
            
            data.append(item)
        
        logger.info(f"✅ Pendientes: {pedidos_count} pedidos, {servicios_count} servicios")
        
        return {
            "success": True,
            "movilId": movil_id,
            "fechaDesde": fecha_desde,
            "total": len(data),
            "pedidosPendientes": pedidos_count,
            "serviciosPendientes": servicios_count,
            "data": data
        }
        
    except Exception as e:
        logger.error(f"❌ Error obteniendo pendientes: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Error obteniendo pendientes: {str(e)}"
        )


@app.get("/pedido-detalle/{pedido_id}")
async def get_pedido_detalle(pedido_id: int):
    """
    Obtiene los detalles completos de un pedido por su ID.
    """
    try:
        logger.info(f"⏳ Consultando detalles del pedido {pedido_id}")
        
        query = """
            SELECT 
                p.PEDID as pedid,
                p.CLIID as cliid,
                c.CLINOM as clinom,
                p.PEDOBS as pedobs,
                p.PEDIMPORTE as pedimporte,
                p.PEDMOVIL as pedmovil,
                p.PEDFCHCUMP as pedfchcump,
                p.PEDDIR as peddir,
                p.PEDAUX17 as usuario,
                p.PEDESTCOD as estado,
                p.PEDSUBESTC as subestado,
                p.PEDDIRCORX as x,
                p.PEDDIRCORY as y
            FROM GXCALDTA.PEDIDOS p
            JOIN GXCALDTA.CLIENTE c ON p.CLIID = c.CLIID
            WHERE p.PEDID = ?
        """
        
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(query, (pedido_id,))
        
        columns = [desc[0] for desc in cursor.description]
        row = cursor.fetchone()
        
        cursor.close()
        conn.close()
        
        if not row:
            raise HTTPException(status_code=404, detail=f"Pedido {pedido_id} no encontrado")
        
        # Convertir a diccionario
        data = {}
        for i, col in enumerate(columns):
            value = row[i]
            if isinstance(value, str):
                value = value.strip()
            data[col.lower()] = value
        
        logger.info(f"✅ Detalles del pedido {pedido_id} obtenidos")
        
        return {
            "success": True,
            "tipo": "PEDIDO",
            "data": data
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error obteniendo detalles del pedido: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Error obteniendo detalles del pedido: {str(e)}"
        )


@app.get("/servicio-detalle/{servicio_id}")
async def get_servicio_detalle(servicio_id: int):
    """
    Obtiene los detalles completos de un servicio por su ID.
    """
    try:
        logger.info(f"⏳ Consultando detalles del servicio {servicio_id}")
        
        query = """
            SELECT 
                s.SERVTID as servtid,
                s.CLIID as cliid,
                c.CLINOM as clinom,
                s.SERVTFCHIN as servtfchin,
                c.TELFNRO as telfnro,
                s.SERVTOBS as servtobs,
                s.SERVTMOVIL as servtmovil,
                s.SERVTFCHCU as servtfchcu,
                s.SERVTDIR as servtdir,
                s.SERVTESTCO as estado,
                s.SERVTSESTC as subestado,
                s.SERVTDCORX as x,
                s.SERVTDCORY as y
            FROM GXCALDTA.SERVICES s
            JOIN GXCALDTA.CLIENTE c ON s.CLIID = c.CLIID
            WHERE s.SERVTID = ?
        """
        
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(query, (servicio_id,))
        
        columns = [desc[0] for desc in cursor.description]
        row = cursor.fetchone()
        
        cursor.close()
        conn.close()
        
        if not row:
            raise HTTPException(status_code=404, detail=f"Servicio {servicio_id} no encontrado")
        
        # Convertir a diccionario
        data = {}
        for i, col in enumerate(columns):
            value = row[i]
            if isinstance(value, str):
                value = value.strip()
            data[col.lower()] = value
        
        logger.info(f"✅ Detalles del servicio {servicio_id} obtenidos")
        
        return {
            "success": True,
            "tipo": "SERVICIO",
            "data": data
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error obteniendo detalles del servicio: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Error obteniendo detalles del servicio: {str(e)}"
        )


if __name__ == "__main__":
    import uvicorn
    
    # Verificar que existe el archivo jt400.jar
    if not os.path.exists(JT400_JAR):
        logger.error(f"❌ No se encontró el archivo jt400.jar en: {JT400_JAR}")
        logger.error("📥 Descarga jt400.jar desde:")
        logger.error("   https://repo1.maven.org/maven2/net/sf/jt400/jt400/20.0.7/jt400-20.0.7.jar")
        exit(1)
    
    logger.info("🚀 Iniciando TrackMovil AS400 API...")
    logger.info(f"📍 Host: {AS400_CONFIG['url']}")
    logger.info(f"👤 Usuario: {AS400_CONFIG['user']}")
    logger.info(f"📂 Schema: {AS400_CONFIG['schema']}")
    logger.info(f"🌐 Server: http://0.0.0.0:8000")
    logger.info(f"📚 Docs: http://localhost:8000/docs")
    logger.info(f"🏓 Ping: http://localhost:8000/ping")
    logger.info("="*50)
    
    uvicorn.run(
        "api_as400:app",
        host="0.0.0.0",
        port=8000,
        reload=False,       # DESHABILITADO - auto-reload interfiere con logs
        log_level="info",   # INFO es suficiente
        access_log=True     # Habilitar logs de acceso HTTP
    )
