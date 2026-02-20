    # 📖 TrackMovil — Manual Completo

    > **Sistema de Rastreo Vehicular en Tiempo Real de Riogas**  
    > Versión: 0.1.0 | Última actualización: Febrero 2026

    ---

    ## Tabla de Contenidos

    1. [¿Qué es TrackMovil?](#1-qué-es-trackmovil)
    2. [¿De dónde nace?](#2-de-dónde-nace)
    3. [Arquitectura del Sistema](#3-arquitectura-del-sistema)
    4. [Stack Tecnológico](#4-stack-tecnológico)
    5. [Flujo de Datos](#5-flujo-de-datos)
    6. [Modelo de Datos](#6-modelo-de-datos)
    7. [Estructura del Proyecto](#7-estructura-del-proyecto)
    8. [Manual de Usuario](#8-manual-de-usuario)
    - [8.1 Inicio de Sesión](#81-inicio-de-sesión)
    - [8.2 Dashboard Principal](#82-dashboard-principal)
    - [8.3 Barra de Navegación](#83-barra-de-navegación)
    - [8.4 Panel Lateral (Sidebar)](#84-panel-lateral-sidebar)
    - [8.5 Mapa Interactivo](#85-mapa-interactivo)
    - [8.6 Popup de Información del Móvil](#86-popup-de-información-del-móvil)
    - [8.7 Indicadores del Dashboard](#87-indicadores-del-dashboard)
    - [8.8 Tracking / Recorrido](#88-tracking--recorrido)
    - [8.9 Leaderboard / Ranking](#89-leaderboard--ranking)
    - [8.10 Preferencias de Usuario](#810-preferencias-de-usuario)
    - [8.11 Filtros y Búsqueda](#811-filtros-y-búsqueda)
    9. [Guía Visual de Colores e Iconos](#9-guía-visual-de-colores-e-iconos)
    10. [Configuración y Despliegue](#10-configuración-y-despliegue)
    11. [Glosario](#11-glosario)

    ---

    ## 1. ¿Qué es TrackMovil?

    **TrackMovil** es una aplicación web de rastreo vehicular en tiempo real desarrollada para **Riogas**, una empresa de distribución de gas en Uruguay. Permite a los operadores logísticos y supervisores:

    - **Visualizar en un mapa** la ubicación en tiempo real de todos los vehículos de reparto (móviles).
    - **Monitorear pedidos y servicios** asignados a cada móvil, sus estados y tiempos de entrega.
    - **Gestionar empresas fleteras** que operan como subcontratistas de transporte.
    - **Analizar rendimiento** con indicadores de cumplimiento, atrasos y ranking competitivo.
    - **Controlar el estado** de actividad de cada móvil (activo, no activo, baja momentánea).

    En resumen, es el **centro de control logístico** que permite a Riogas saber en todo momento dónde están sus vehículos, qué están entregando y cómo va el cumplimiento de la jornada.

    ---

    ## 2. ¿De dónde nace?

    ### Contexto empresarial

    Riogas opera una red de **distribución de gas licuado** (GLP) en Uruguay, con una flota de vehículos repartidores gestionados por **empresas fleteras**. Antes de TrackMovil, el seguimiento se hacía con sistemas legacy y no existía una visión unificada en tiempo real.

    ### Origen técnico

    TrackMovil nace como una **modernización** del sistema de tracking existente que estaba basado en:

    1. **AS400 (IBM iSeries) con DB2**: El sistema ERP principal de Riogas corre sobre AS400. Aquí se registraban históricamente las coordenadas GPS, los pedidos y la información logística. La tabla de coordenadas (`LOGCOORDMOVIL`) del AS400 era la fuente de verdad original.

    2. **GeneXus**: El backend de autenticación y gestión de usuarios se construyó con GeneXus, un generador de código muy usado en empresas uruguayas. La API de login (`/gestion/login`) sigue siendo provista por GeneXus.

    3. **Firestore (Firebase)**: Se usaba como capa intermedia para sincronizar datos entre la app móvil de los choferes y el sistema central.

    ### La transición

    TrackMovil reemplaza la interfaz legacy con una **aplicación web moderna** que:

    - Consume datos desde **Supabase** (PostgreSQL) como base de datos principal para la capa de presentación.
    - Mantiene la autenticación contra el **backend GeneXus** existente.
    - Conserva una **API puente Python** (`as400-api/`) que consulta el AS400/DB2 directamente para datos históricos o cuando Supabase no tiene la información.
    - Recibe actualizaciones GPS en **tiempo real** via Supabase Realtime (canales WebSocket) que escuchan inserts/updates en las tablas `gps_tracking_extended`, `pedidos`, `services` y `moviles`.

    ```
    ┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
    │  App Móvil       │────▶│  Supabase        │◀────│  AS400 / DB2     │
    │  (Choferes)      │     │  (PostgreSQL +   │     │  (ERP Legacy)    │
    │                  │     │   Realtime WS)   │     │                  │
    └──────────────────┘     └────────┬─────────┘     └──────────────────┘
                                    │                         ▲
                                    ▼                         │
                            ┌──────────────────┐     ┌──────────────────┐
                            │  TrackMovil      │     │  API Python      │
                            │  (Next.js Web)   │     │  (FastAPI+JT400) │
                            │  ← Tú estás aquí │     │  as400-api/      │
                            └──────────────────┘     └──────────────────┘
                                    │
                                    ▼
                            ┌──────────────────┐
                            │  GeneXus API     │
                            │  (Login/Auth)    │
                            └──────────────────┘
    ```

    ---

    ## 3. Arquitectura del Sistema

    ### Capas principales

    | Capa | Tecnología | Responsabilidad |
    |------|-----------|-----------------|
    | **Frontend** | Next.js 16 + React 19 + TypeScript | Interfaz de usuario, mapa interactivo, dashboard |
    | **Proxy/Middleware** | Next.js API Routes | CORS, rate limiting, proxy a APIs externas |
    | **Base de Datos** | Supabase (PostgreSQL) | Almacenamiento y tiempo real de moviles, pedidos, services, GPS |
    | **Realtime** | Supabase Realtime (WebSocket) | Push de actualizaciones GPS, pedidos y services |
    | **Auth** | GeneXus API | Autenticación de usuarios, roles y permisos |
    | **Legacy Bridge** | FastAPI + JT400 (Python) | Consultas directas al AS400/DB2 |

    ### Flujo de autenticación

    ```
    Usuario → Login Page → POST /api/proxy/gestion/login → GeneXus API
                                                                │
                                                ┌─────────────┘
                                                ▼
                                    Token + User Data
                                                │
                                                ▼
                                localStorage (trackmovil_token)
                                                │
                                                ▼
                                Si NO es root → GET /api/user-atributos
                                                │
                                                ▼
                                allowedEmpresas[] → Filtro de empresas
    ```

    ### Flujo de datos en tiempo real

    ```
    App Móvil → INSERT en gps_tracking_extended (Supabase)
                            │
                            ▼ (WebSocket push)
                RealtimeProvider (React Context)
                            │
                            ▼
                Dashboard (page.tsx)
                            │
                    ┌─────┼──────┐
                    ▼     ▼      ▼
                MapView  Sidebar  Indicators
    ```

    ---

    ## 4. Stack Tecnológico

    | Categoría | Herramienta | Versión |
    |-----------|------------|---------|
    | **Framework** | Next.js | 16.1.6 |
    | **UI Library** | React | 19.1.0 |
    | **Lenguaje** | TypeScript | 5.x |
    | **Estilos** | Tailwind CSS | 4.x |
    | **Animaciones** | Framer Motion | 12.x |
    | **Mapas** | Leaflet + React-Leaflet | 1.9.4 / 5.0.0 |
    | **Clustering** | leaflet.markercluster | 1.5.3 |
    | **Base de Datos** | Supabase (PostgreSQL) | — |
    | **Validación** | Zod | 4.x |
    | **HTTP Client** | Axios | 1.13.x |
    | **Fechas** | date-fns | 4.x |
    | **Virtualización** | react-window | 2.x |
    | **Toasts** | react-hot-toast | 2.x |
    | **Legacy API** | FastAPI + JayDeBeAPI (Python) | — |
    | **Containerización** | Docker + Docker Compose | — |
    | **Process Manager** | PM2 | — |

    ---

    ## 5. Flujo de Datos

    ### ¿Cómo llegan las coordenadas GPS?

    1. **La app móvil del chofer** (instalada en un terminal Android) reporta coordenadas GPS periódicamente.
    2. Los datos se insertan en la tabla `gps_tracking_extended` de **Supabase**.
    3. TrackMovil escucha esos cambios via **Supabase Realtime** (canales `postgres_changes`).
    4. El hook `useGPSTracking` recibe el nuevo registro y actualiza el `RealtimeProvider`.
    5. El `Dashboard` recibe `latestPosition` del contexto y actualiza la posición del móvil en el mapa.

    ### ¿Cómo se cargan los móviles?

    1. Al iniciar la app, se llama a `GET /api/all-positions` que consulta la API legacy (AS400) para obtener la **última posición conocida** de todos los móviles.
    2. Se enriquecen con datos de `GET /api/moviles-extended` (Supabase) que trae: `tamanoLote`, `pedidosAsignados`, `matricula`, `estadoDesc`, `estadoNro`.
    3. Los colores se calculan dinámicamente según la **capacidad de carga** (verde/amarillo/negro) y el **estado** (gris=no activo, violeta=baja momentánea).

    ### ¿Cómo se cargan pedidos y services?

    1. Carga inicial via `GET /api/pedidos?escenarioId=1000` y `GET /api/services?escenarioId=1000`.
    2. En tiempo real via los hooks `usePedidosRealtime` y `useServicesRealtime` que escuchan cambios en las tablas `pedidos` y `services` de Supabase.
    3. Los pedidos se clasifican por estado: `estado_nro=1` (pendiente), `estado_nro=2` (entregado/finalizado).

    ---

    ## 6. Modelo de Datos

    ### Tablas principales en Supabase

    #### `moviles`
    | Campo | Tipo | Descripción |
    |-------|------|-------------|
    | `id` | TEXT | Identificador único del móvil |
    | `nro` | INTEGER | Número del móvil (visible al usuario) |
    | `descripcion` | TEXT | Nombre/descripción del móvil |
    | `matricula` | TEXT | Matrícula del vehículo |
    | `empresa_fletera_id` | INTEGER | ID de la empresa fletera propietaria |
    | `estado_nro` | INTEGER | 0,1,2=ACTIVO \| 3=NO ACTIVO \| 4=BAJA MOMENTÁNEA |
    | `tamano_lote` | INTEGER | Capacidad máxima de pedidos que puede transportar |
    | `pedidos_pendientes` | INTEGER | Cantidad de pedidos asignados pendientes |
    | `mostrar_en_mapa` | BOOLEAN | Si debe mostrarse en el mapa |

    #### `pedidos`
    | Campo | Tipo | Descripción |
    |-------|------|-------------|
    | `id` | INTEGER | ID del pedido |
    | `escenario` | INTEGER | ID del escenario (siempre 1000 en producción) |
    | `movil` | INTEGER | ID del móvil asignado |
    | `estado_nro` | INTEGER | 1=Pendiente, 2=Entregado |
    | `cliente_nombre` | TEXT | Nombre del cliente |
    | `cliente_direccion` | TEXT | Dirección de entrega |
    | `latitud` / `longitud` | DECIMAL | Coordenadas de entrega |
    | `fch_hora_max_ent_comp` | TIMESTAMP | Hora máxima de entrega comprometida |
    | `fch_hora_mov` | TIMESTAMP | Hora real de entrega/movimiento del móvil |
    | `producto_nom` | TEXT | Nombre del producto |
    | `producto_cant` | DECIMAL | Cantidad de producto |
    | `imp_bruto` | DECIMAL | Importe bruto del pedido |
    | `prioridad` | INTEGER | Prioridad de entrega |

    #### `services`
    | Campo | Tipo | Descripción |
    |-------|------|-------------|
    | `id` | INTEGER | ID del service |
    | `escenario` | INTEGER | ID del escenario |
    | `movil` | INTEGER | ID del móvil asignado |
    | `estado_nro` | INTEGER | 1=Pendiente, 2=Realizado |
    | `cliente_nombre` | TEXT | Nombre del cliente |
    | `servicio_nombre` | TEXT | Tipo de servicio |
    | `fch_hora_max_ent_comp` | TIMESTAMP | Hora máxima comprometida |

    #### `gps_tracking_extended`
    | Campo | Tipo | Descripción |
    |-------|------|-------------|
    | `id` | SERIAL | ID auto-incremental |
    | `movil_id` | TEXT | ID del móvil |
    | `escenario_id` | INTEGER | ID del escenario |
    | `latitud` / `longitud` | DECIMAL | Coordenadas GPS |
    | `velocidad` | DECIMAL | Velocidad del vehículo |
    | `bearing` | DECIMAL | Dirección de movimiento |
    | `accuracy` | DECIMAL | Precisión del GPS |
    | `battery_level` | DECIMAL | Nivel de batería del terminal |

    #### `empresas_fleteras`
    | Campo | Tipo | Descripción |
    |-------|------|-------------|
    | `empresa_fletera_id` | INTEGER | ID de la empresa |
    | `nombre` | TEXT | Nombre de la empresa fletera |

    ---

    ## 7. Estructura del Proyecto

    ```
    trackmovil/
    ├── app/                          # Next.js App Router
    │   ├── layout.tsx                # Layout raíz (AuthProvider + RealtimeProvider)
    │   ├── page.tsx                  # Página raíz (redirect a /login o /dashboard)
    │   ├── login/page.tsx            # Página de login
    │   ├── dashboard/page.tsx        # 🎯 Dashboard principal (1500+ líneas)
    │   └── api/                      # API Routes (Backend for Frontend)
    │       ├── all-positions/        # Obtener todas las posiciones de móviles
    │       ├── auth/                 # Endpoints de autenticación
    │       ├── coordinates/          # Coordenadas históricas
    │       ├── empresas/             # CRUD empresas fleteras
    │       ├── import/               # Importación de datos
    │       ├── latest/               # Última posición de un móvil
    │       ├── movil/                # Info de un móvil específico
    │       ├── movil-session/        # Sesión actual (chofer, terminal)
    │       ├── moviles-extended/     # Datos extendidos de Supabase
    │       ├── pedidos/              # Listado de pedidos
    │       ├── pedido-detalle/       # Detalle HTML de un pedido
    │       ├── pedidos-pendientes/   # Pedidos pendientes por móvil
    │       ├── pedidos-servicios/    # Pedidos y servicios combinados
    │       ├── proxy/                # Proxy a API externa (GeneXus)
    │       ├── puntos-interes/       # CRUD de puntos de interés
    │       ├── services/             # Listado de services
    │       ├── servicio-detalle/     # Detalle HTML de un service
    │       └── user-atributos/       # Atributos del usuario (empresas permitidas)
    │
    ├── components/
    │   ├── auth/
    │   │   └── ProtectedRoute.tsx    # HOC de protección de rutas
    │   ├── dashboard/
    │   │   ├── DashboardIndicators.tsx  # Indicadores en la barra superior
    │   │   └── MovilesSinGPS.tsx     # Lista de móviles sin señal GPS
    │   ├── layout/
    │   │   ├── FloatingToolbar.tsx   # Botón flotante de configuración
    │   │   ├── Navbar.tsx            # Navbar con logo y indicadores
    │   │   └── NavbarSimple.tsx      # Navbar simplificada
    │   ├── map/
    │   │   ├── MapView.tsx           # 🗺️ Componente principal del mapa (2400+ líneas)
    │   │   ├── MovilInfoPopup.tsx    # Popup al hacer clic en un móvil
    │   │   ├── PedidoInfoPopup.tsx   # Popup al hacer clic en un pedido
    │   │   ├── ServiceInfoPopup.tsx  # Popup al hacer clic en un service
    │   │   ├── PedidoServicioPopup.tsx # Popup combinado pedido+servicio
    │   │   ├── LayersControl.tsx     # Control de capas del mapa
    │   │   ├── MarkerClusterGroup.tsx# Agrupación de marcadores
    │   │   ├── RouteAnimationControl.tsx # Animación de recorrido
    │   │   ├── ViewportCulling.tsx   # Optimización: solo renderizar lo visible
    │   │   └── TileCacheConfig.ts    # Configuración de cache de tiles
    │   ├── providers/
    │   │   ├── RealtimeProvider.tsx  # Context para datos en tiempo real
    │   │   └── ToastProvider.tsx     # Proveedor de notificaciones toast
    │   └── ui/
    │       ├── MovilSelector.tsx     # 🌲 Panel lateral con árbol de categorías
    │       ├── EmpresaSelector.tsx   # Dropdown de selección de empresas
    │       ├── FilterBar.tsx         # Barra de búsqueda y filtros
    │       ├── MovilInfoCard.tsx     # Tarjeta de info del móvil en sidebar
    │       ├── TrackingModal.tsx     # Modal para ver recorrido histórico
    │       ├── LeaderboardModal.tsx  # 🏆 Ranking competitivo de móviles
    │       ├── MapGuideModal.tsx     # Guía visual de iconos y colores
    │       ├── PreferencesModal.tsx  # Configuración de preferencias
    │       ├── InfoPanel.tsx         # Panel de información
    │       ├── LoadingSpinner.tsx    # Spinner de carga
    │       └── VirtualList.tsx       # Lista virtualizada (react-window)
    │
    ├── contexts/
    │   └── AuthContext.tsx           # Contexto de autenticación
    │
    ├── hooks/
    │   └── usePerformanceOptimizations.ts  # Hook de visibilidad de tab
    │
    ├── lib/
    │   ├── api/
    │   │   ├── auth.ts              # Servicio de autenticación (Axios)
    │   │   └── config.ts            # Configuración de URLs de API
    │   ├── hooks/
    │   │   └── useRealtimeSubscriptions.ts  # Hooks de Supabase Realtime
    │   ├── supabase.ts              # Cliente de Supabase
    │   ├── auth-middleware.ts        # Middleware de autenticación/seguridad
    │   ├── rate-limit.ts            # Sistema de rate limiting
    │   ├── fetch-with-timeout.ts    # Fetch con timeout configurable
    │   └── validation.ts            # Validaciones con Zod
    │
    ├── types/
    │   ├── index.ts                 # Tipos TypeScript del dominio
    │   └── supabase.ts              # Tipos auto-generados de Supabase
    │
    ├── utils/
    │   ├── pedidoDelay.ts           # Cálculo de atraso de pedidos
    │   └── estadoPedido.ts          # Descripciones de estados
    │
    ├── as400-api/                   # API puente Python → AS400/DB2
    │   ├── api_as400.py             # FastAPI con JayDeBeAPI + JT400
    │   ├── requirements.txt         # Dependencias Python
    │   ├── Dockerfile               # Container para la API Python
    │   └── jt400.jar                # Driver JDBC para AS400
    │
    ├── proxy.ts                     # Proxy/Middleware principal de Next.js
    ├── docker-compose.yml           # Orquestación Docker
    ├── Dockerfile                   # Imagen Docker de la app Next.js
    ├── pm2.config.js                # Configuración PM2 para producción
    ├── nginx-track-fixed.conf       # Configuración Nginx como reverse proxy
    └── package.json                 # Dependencias y scripts
    ```

    ---

    ## 8. Manual de Usuario

    ### 8.1 Inicio de Sesión

    Al abrir la aplicación (`https://tu-dominio.com`), se presenta la **pantalla de login**:

    1. **Ingresar usuario**: Tu nombre de usuario de GeneXus.
    2. **Ingresar contraseña**: Tu contraseña de GeneXus.
    3. Hacer clic en **"Iniciar Sesión"**.

    El sistema verifica las credenciales contra la API de GeneXus. Si el login es exitoso:
    - Se almacena el **token de sesión** localmente.
    - Si el usuario **NO es root**, se consultan las **empresas permitidas** automáticamente ('atributos'). Solo verás los datos de las empresas a las que tenés acceso.
    - Se redirige al **Dashboard**.

    > 💡 **Usuarios Root** tienen acceso a **todas** las empresas fleteras. Usuarios regulares solo ven las empresas que tienen asignadas.

    ---

    ### 8.2 Dashboard Principal

    El dashboard es la pantalla principal de la aplicación. Está dividido en:

    ```
    ┌──────────────────────────────────────────────────┐
    │ 🔵 Navbar (Logo + Empresa Selector + Indicadores + ⚙️ ) │
    ├────────────┬─────────────────────────────────────┤
    │            │                                     │
    │  Sidebar   │         Mapa Interactivo            │
    │  (Panel    │         (Leaflet/OSM)               │
    │  lateral)  │                                     │
    │            │                                     │
    │  - Móviles │                                🏆 Ranking │
    │  - Pedidos │                                📍 Marcador│
    │  - Services│                                🗺️ Tracking│
    │  - POIs    │                                     │
    │            │                                     │
    ├────────────┴─────────────────────────────────────┤
    ```

    **El dashboard se actualiza en tiempo real**. Cualquier cambio en posiciones GPS, pedidos o services se refleja automáticamente sin necesidad de recargar la página.

    ---

    ### 8.3 Barra de Navegación

    La barra superior contiene:

    | Elemento | Descripción |
    |----------|-------------|
    | **Logo TrackMovil** | Identificación visual de la app |
    | **Empresa Selector** | Dropdown para filtrar por empresa fletera. Seleccionar una o varias empresas filtra todos los datos (móviles, pedidos, services) |
    | **Indicadores** | Badges con estadísticas de: Móviles totales, Pedidos (pendientes/entregados/atrasados), Services (pendientes/realizados/atrasados) |
    | **Botón ⚙️** | Abre el panel flotante con: Selector de fecha, Preferencias, Cerrar sesión |

    **Selector de Empresas Fleteras**:
    - Por defecto se seleccionan **todas** las empresas.
    - Se puede seleccionar/deseleccionar empresas individualmente.
    - Solo se muestran las empresas a las que el usuario tiene acceso.

    ---

    ### 8.4 Panel Lateral (Sidebar)

    El panel lateral izquierdo tiene una **estructura de árbol** con las siguientes categorías expandibles:

    #### 🚗 Móviles
    Lista de todos los móviles disponibles. Cada tarjeta muestra:
    - **Número de móvil** (ej: "Móvil 123")
    - **Matrícula** del vehículo
    - **Estado**: ACTIVO / NO ACTIVO / BAJA MOMENTÁNEA
    - **Ocupación**: Barra de progreso indicando `pedidosAsignados / tamanoLote`
    - **Última posición**: Hora de la última coordenada GPS recibida
    - **Checkbox**: Para seleccionar/deseleccionar el móvil en el mapa

    **Acciones**:
    - **Clic en checkbox**: Selecciona/deselecciona el móvil para mostrarlo en el mapa.
    - **"Seleccionar todos"** / **"Limpiar selección"**: Acciones masivas.
    - **Buscador**: Filtrar por número, nombre o matrícula.
    - **Botón ❓**: Abre la guía visual de colores e iconos.

    #### 📦 Pedidos Pendientes
    Lista de pedidos con `estado_nro = 1`. Muestra:
    - ID del pedido
    - Cliente y dirección
    - Móvil asignado
    - Producto y cantidad
    - **Indicador de atraso**: En hora (verde), Límite cercana (amarillo), Atrasado (naranja), Muy atrasado (rojo)
    - Hora máxima de entrega comprometida

    **Clic en un pedido** → Centra el mapa en la ubicación del cliente.

    #### ✅ Pedidos Finalizados
    Lista de pedidos con `estado_nro = 2` (ya entregados).

    #### 🔧 Services Pendientes
    Lista de servicios técnicos pendientes con los mismos indicadores de atraso.

    #### ✅ Services Finalizados
    Lista de servicios ya realizados.

    #### 📍 Puntos de Interés
    Marcadores personalizados creados por el usuario en el mapa (almacenados en localStorage).

    ---

    ### 8.5 Mapa Interactivo

    El mapa es el componente central de TrackMovil. Está construido con **Leaflet** + **OpenStreetMap** y muestra:

    #### Capas base disponibles
    Se pueden cambiar desde el control de capas en la esquina superior derecha del mapa:

    | Capa | Descripción |
    |------|-------------|
    | 🗺️ **Calles** | Mapa estándar OpenStreetMap (por defecto) |
    | 🛰️ **Satélite** | Imágenes satelitales (Esri) |
    | 🗻 **Terreno** | Mapa topográfico |
    | 🌊 **CartoDB** | Estilo CartoDB Voyager |
    | 🌙 **Dark Mode** | Mapa oscuro |
    | 🌞 **Light Mode** | Mapa claro |

    #### Marcadores en el mapa

    - **Móviles**: Íconos de vehículo coloreado según capacidad (ver [Guía Visual](#9-guía-visual-de-colores-e-iconos)). Incluyen un badge con el número de pedidos asignados.
    - **Pedidos pendientes**: Marcadores con ícono de caja, coloreados según atraso.
    - **Pedidos entregados**: Marcadores verdes con check.
    - **Services pendientes**: Marcadores con ícono de herramienta.
    - **Services realizados**: Marcadores verdes con check.
    - **Puntos de interés**: Marcadores con emoji personalizado.

    #### Clustering
    Cuando hay muchos marcadores juntos, se agrupan automáticamente en **clusters** que muestran un número. Al hacer zoom se desagrupan.

    #### Interacción con el mapa
    - **Clic en un móvil** → Abre popup con información detallada.
    - **Clic en un pedido** → Abre popup con datos del pedido y cliente.
    - **Clic en un service** → Abre popup con datos del servicio.
    - **Zoom** → Scroll del mouse o botones +/-.
    - **Arrastrar** → Mover el mapa.

    ---

    ### 8.6 Popup de Información del Móvil

    Al hacer clic en un móvil del mapa, se abre un popup detallado con:

    | Sección | Información |
    |---------|-------------|
    | **Header** | Nombre del móvil, matrícula, estado (ACTIVO/NO ACTIVO/BAJA MOMENTÁNEA) |
    | **Capacidad** | Barra de ocupación: `pedidosAsignados / tamanoLote` |
    | **Coordenadas** | Última posición GPS y fecha/hora |
    | **Distancia** | Kilómetros recorridos |
    | **Chofer** | Nombre del chofer actual (si está en sesión) |
    | **Terminal** | ID del terminal Android |
    | **Histórico** | Últimos choferes que usaron el móvil |
    | **Pendientes** | Cantidad de pedidos y servicios pendientes |

    **Botones de acción**:
    - **🗺️ Ver Recorrido**: Abre el modal de tracking para ver la ruta histórica del móvil.
    - **📦 Ver Pendientes**: Muestra los marcadores de pedidos/services pendientes del móvil en el mapa.
    - **✉️ Enviar SMS**: Envía un mensaje al terminal del chofer (si está disponible).

    ---

    ### 8.7 Indicadores del Dashboard

    En la barra superior se muestran indicadores en tiempo real:

    #### Indicadores de Pedidos
    | Indicador | Significado |
    |-----------|-------------|
    | **📦 Pendientes** | Cantidad de pedidos aún no entregados |
    | **✅ Entregados** | Cantidad de pedidos ya entregados hoy |
    | **⚠️ Atrasados** | Pedidos que superaron la hora máxima de entrega |
    | **% Atrasados** | Porcentaje de pendientes que están atrasados |
    | **⏰ Mayor atraso** | Cantidad de minutos del pedido más atrasado |

    #### Indicadores de Services
    | Indicador | Significado |
    |-----------|-------------|
    | **🔧 Pendientes** | Cantidad de services aún no realizados |
    | **✅ Realizados** | Cantidad de services completados hoy |
    | **⚠️ Atrasados** | Services que superaron la hora comprometida |

    ---

    ### 8.8 Tracking / Recorrido

    El modal de **Tracking** permite ver el **recorrido histórico** de un móvil en una fecha específica:

    1. Acceder desde el botón **🗺️** en la barra lateral del mapa, o desde el popup del móvil.
    2. **Seleccionar un móvil** de la lista.
    3. **Seleccionar una fecha** (por defecto: la fecha del dashboard).
    4. Hacer clic en **"Ver Recorrido"**.

    El mapa dibuja la **ruta completa** que siguió el móvil ese día, con:
    - Línea animada mostrando el camino.
    - Marcadores en puntos donde se hicieron entregas o servicios.
    - Colores que indican velocidad o paradas.

    ---

    ### 8.9 Leaderboard / Ranking

    El modal de **Leaderboard** muestra un **ranking competitivo** de todos los móviles, accesible desde el botón **🏆** en la barra lateral del mapa.

    #### Tarjetas de resumen
    | Tarjeta | Valor |
    |---------|-------|
    | **Móviles** | Total de móviles activos |
    | **Entregas** | Total de pedidos + services entregados/realizados |
    | **En Hora** | Entregas dentro del horario comprometido |
    | **Cumplimiento** | Porcentaje general de entregas a tiempo |

    #### Tabla de ranking
    Cada fila muestra un móvil con:
    - **Posición** (#1, #2, #3 con medallas 🥇🥈🥉)
    - **Entregas**: Pedidos entregados + services realizados
    - **Cumplimiento %**: Barra de progreso con porcentaje de entregas a tiempo
    - **En Hora**: Cantidad absoluta de entregas a tiempo
    - **Pendientes**: Pedidos + services aún por completar
    - **Total**: Pedidos + services asignados totales

    **Funcionalidades**:
    - **Ordenar** por cualquier columna (entregas, cumplimiento, en hora, pendientes, total).
    - **Filtrar** solo móviles activos.
    - Las barras de progreso tienen **animación** y colores por rango (verde >80%, amarillo 50-80%, rojo <50%).

    ---

    ### 8.10 Preferencias de Usuario

    Accesibles desde ⚙️ → **Preferencias**:

    | Preferencia | Descripción | Default |
    |-------------|-------------|---------|
    | **Capa de mapa** | Capa base por defecto al cargar | Calles |
    | **Solo móviles activos** | Ocultar móviles sin señal GPS reciente | No |
    | **Retraso máximo GPS** | Minutos sin señal para considerar inactivo | 30 min |
    | **Tiempo real** | Activar/desactivar actualización en tiempo real | Sí |
    | **Animación de ruta** | Animar el recorrido de un móvil | Sí |
    | **Marcadores completados** | Mostrar entregas ya realizadas en el mapa | Sí |

    Las preferencias se guardan en **localStorage** del navegador (por equipo/usuario).

    ---

    ### 8.11 Filtros y Búsqueda

    #### Filtros de Móviles

    | Filtro | Opciones | Descripción |
    |--------|----------|-------------|
    | **Actividad** | Activo / No Activo / Baja Momentánea / Todos | Filtra por estado del móvil |
    | **Capacidad** | Todos / 1-3 / 4-6 / 7-10 / 10+ | Filtra por tamaño de lote |
    | **Estado** | Con capacidad / Sin capacidad / No reporta GPS / Baja momentánea | Filtros combinables |

    #### Filtros de Pedidos
    | Filtro | Opciones |
    |--------|----------|
    | **Atraso** | En hora / Límite cercana / Atrasado / Muy atrasado / Sin hora |
    | **Tipo servicio** | Todos / Urgente / Especial / Normal |

    #### Filtros de Services
    | Filtro | Opciones |
    |--------|----------|
    | **Atraso** | En hora / Límite cercana / Atrasado / Muy atrasado / Sin hora |

    Todos los filtros incluyen un **buscador de texto** que filtra por nombre, ID, matrícula, dirección, etc.

    ---

    ## 9. Guía Visual de Colores e Iconos

    ### Colores de Móviles (según capacidad de carga)

    | Color | Condición | Significado |
    |-------|-----------|-------------|
    | 🟢 **Verde** | Ocupación < 67% | Lote con buena disponibilidad |
    | 🟡 **Amarillo** | Ocupación 67-99% | Lote casi lleno |
    | ⚫ **Negro** | Ocupación ≥ 100% | Lote completamente lleno |
    | ⚪ **Gris** | `estado_nro = 3` | Móvil NO ACTIVO |
    | 🟣 **Violeta** | `estado_nro = 4` | Móvil en BAJA MOMENTÁNEA |

    ### Badge del Móvil
    Cada marcador de móvil tiene un **badge numérico** en la esquina inferior derecha que muestra la cantidad de **pedidos asignados**.

    ### Colores de Pedidos/Services (según atraso)

    | Color | Condición | Significado |
    |-------|-----------|-------------|
    | 🟢 **Verde** | Llegada estimada a tiempo | En hora |
    | 🟡 **Amarillo** | Cercano al límite | Límite cercana |
    | 🟠 **Naranja** | Ya pasó la hora máxima | Atrasado |
    | 🔴 **Rojo** | Muy pasada la hora límite | Muy atrasado |
    | ⚪ **Gris** | Sin hora comprometida | Sin hora definida |

    ### Cálculo del Atraso
    El atraso se calcula comparando la **hora actual** con la **hora máxima de entrega comprometida** (`fch_hora_max_ent_comp`):
    - Si la hora actual < hora comprometida → **En hora** (verde)
    - Si faltan pocos minutos → **Límite cercana** (amarillo)  
    - Si la hora actual > hora comprometida → **Atrasado** (naranja/rojo según gravedad)

    ---

    ## 10. Configuración y Despliegue

    ### Variables de Entorno Requeridas

    ```bash
    # Supabase
    NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
    NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxx...
    SUPABASE_SERVICE_ROLE_KEY=eyJxxx...

    # API Externa (GeneXus)
    EXTERNAL_API_URL=http://192.168.x.x:8082
    # O alternativamente:
    NEXT_PUBLIC_EXTERNAL_API_URL=http://192.168.x.x:8082

    # Seguridad
    INTERNAL_API_KEY=tu_api_key_32_chars
    NEXT_PUBLIC_APP_URL=https://tu-dominio.com

    # Opcional: Logging verboso
    ENABLE_MIDDLEWARE_LOGGING=true
    ```

    ### Ejecutar en Desarrollo

    ```bash
    pnpm install          # Instalar dependencias
    pnpm dev              # Iniciar en modo desarrollo (puerto 3000)
    ```

    ### Build para Producción

    ```bash
    pnpm build            # Compilar para producción
    pnpm start            # Iniciar servidor de producción
    ```

    ### Deploy con Docker

    ```bash
    docker-compose up -d  # Levantar con Docker Compose
    ```

    ### Deploy con PM2

    ```bash
    pm2 start pm2.config.js  # Iniciar con PM2
    pm2 logs trackmovil       # Ver logs
    pm2 restart trackmovil    # Reiniciar
    ```

    ---

    ## 11. Glosario

    | Término | Definición |
    |---------|-----------|
    | **Móvil** | Vehículo de reparto de gas. Identificado por un número único. |
    | **Empresa Fletera** | Empresa subcontratista que opera una flota de móviles para Riogas. |
    | **Pedido** | Orden de entrega de gas a un cliente. Tiene estado pendiente (1) o entregado (2). |
    | **Service** | Servicio técnico a realizar en la ubicación de un cliente (revisisón, instalación, etc.). |
    | **Escenario** | Agrupación lógica de datos (siempre `1000` en producción). |
    | **Lote / Tamaño de Lote** | Capacidad máxima de pedidos que un móvil puede transportar en un viaje. |
    | **Estado del Móvil** | 0,1,2 = ACTIVO \| 3 = NO ACTIVO \| 4 = BAJA MOMENTÁNEA |
    | **Pedidos Asignados** | Cantidad de pedidos actualmente cargados en el móvil. |
    | **Terminal** | Dispositivo Android que lleva el chofer, que reporta GPS y recibe pedidos. |
    | **GeneXus** | Plataforma de desarrollo low-code usada para el backend de autenticación de Riogas. |
    | **AS400** | Servidor IBM iSeries que ejecuta el ERP principal de Riogas (DB2). |
    | **Supabase** | Plataforma Backend-as-a-Service basada en PostgreSQL, usada como DB principal de TrackMovil. |
    | **Realtime** | Funcionalidad de Supabase que envía cambios de la base de datos en tiempo real via WebSocket. |
    | **POI (Punto de Interés)** | Marcador personalizado creado por el usuario en el mapa. |
    | **Cumplimiento** | Porcentaje de entregas realizadas dentro de la hora comprometida. |
    | **Rate Limiting** | Sistema de protección que limita la cantidad de requests por IP/minuto. |

    ---

    > **Desarrollado para Riogas** | Repositorio: `Riogas/interactivemap` | Rama principal: `main`
