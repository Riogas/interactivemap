/**
 * El contenido de la documentación viva de la pantalla de estadística de
 * cumplimiento. Vive como DATOS (no como JSX) para que los tests puedan
 * fijarlo: hay un test que falla si una perilla de CAMPOS_MODELO_LISTA no
 * está documentada acá — así, cada ajuste al cálculo OBLIGA a actualizar
 * esta documentación (ese es el mecanismo de "se actualiza sola").
 *
 * Los valores VIGENTES de cada perilla no viven acá: la página los lee de
 * /api/demoras/modelo al abrirse, así la doc siempre muestra la
 * parametría real del momento (y la versión que la firma).
 */

export interface PerillaDoc {
  /** Nombre humano de la perilla. */
  label: string;
  /** Qué hace, dicho para cualquiera. */
  explica: string;
  /** Grupo de render (título de sección en la tabla de parametría). */
  grupo: string;
}

export const PERILLAS_DOC: Record<string, PerillaDoc> = {
  modelo: {
    grupo: 'Modelo',
    label: 'Modelo de cálculo',
    explica: 'CONSUMO_TRAMOS simula la cola consumiéndose a velocidad creciente a medida que los móviles se liberan (el vigente). CAPACIDAD_PROMEDIO es el modelo viejo, conservado para comparar.',
  },
  min_minutos: {
    grupo: 'Salida publicada',
    label: 'Mínimo publicable',
    explica: 'La demora informada nunca baja de este piso, aunque el cálculo dé menos.',
  },
  max_minutos: {
    grupo: 'Salida publicada',
    label: 'Máximo publicable (techo)',
    explica: 'La demora informada nunca supera este techo; también es lo que se informa cuando no hay forma de calcular (zona sin nadie).',
  },
  escalon_minutos: {
    grupo: 'Salida publicada',
    label: 'Escalón de redondeo',
    explica: 'Lo publicado se redondea a múltiplos de este valor, siempre HACIA ARRIBA: la promesa no se achica por redondeo (65 → 75, no 60).',
  },
  subida_max: {
    grupo: 'Suavizado',
    label: 'Suba máxima por corrida',
    explica: 'Entre una corrida y la siguiente (10 min), el publicado puede subir a lo sumo esto: los saltos bruscos se reparten en pasos.',
  },
  bajada_max: {
    grupo: 'Suavizado',
    label: 'Baja máxima por corrida',
    explica: 'Ídem hacia abajo: cuánto puede bajar el publicado por corrida.',
  },
  suavizado_bypass_cambio_capacidad: {
    grupo: 'Suavizado',
    label: 'Saltar el suavizado si cambian los móviles',
    explica: 'Cuando entra o sale un móvil de la zona el cambio es real, no ruido: con esto prendido el publicado salta directo al valor nuevo en vez de moverse de a pasos.',
  },
  arranque_sin_movil_modo: {
    grupo: 'Arranque sin móvil',
    label: 'Modo del arranque',
    explica: 'Qué informar cuando la zona no tiene móvil de prioridad. PREDICTIVO (vigente): estima a qué hora aparece el primero con el histórico de la zona y promete esa espera más la cola. Los otros modos (TECHO, DESPACHO, DESPACHO_MAS_COLA) son las etapas anteriores, conservadas para comparar.',
  },
  activacion_percentil: {
    grupo: 'Arranque sin móvil',
    label: 'Percentil del histórico de activación',
    explica: '0.5 = la mediana de las horas a las que históricamente apareció el primer móvil (elegida por retro-backtest); 0.75 sería más conservador (hora más tardía).',
  },
  activacion_margen_minutos: {
    grupo: 'Arranque sin móvil',
    label: 'Colchón sobre la estimación',
    explica: 'Minutos que se suman a la hora estimada de activación, por las dudas.',
  },
  activacion_min_muestras: {
    grupo: 'Arranque sin móvil',
    label: 'Días mínimos de muestra',
    explica: 'Cuántos días con activación registrada hacen confiable la estimación. Sin muestra suficiente cae al histórico general de la zona, y en última instancia a la apertura de la ventana.',
  },
  activacion_gracia_minutos: {
    grupo: 'Arranque sin móvil',
    label: 'Gracia si el móvil no aparece',
    explica: 'Pasada la hora estimada más esta gracia sin que el móvil aparezca, la demora sube hacia el techo (no sabemos qué le pasó) hasta la hora máxima de espera.',
  },
  asignados_modo: {
    grupo: 'La cola',
    label: 'Cómo pesan los pedidos ya asignados',
    explica: 'PROGRESO (vigente): cada pedido arriba de un móvil cuenta solo lo que le falta, descontando el tiempo que ya lleva en curso contra el ritmo de la zona. COMPLETO: cuentan enteros (histórico). PESO: un factor fijo.',
  },
  peso_asignados: {
    grupo: 'La cola',
    label: 'Peso fijo de los asignados',
    explica: 'Solo aplica en modo PESO: cuánto cuenta cada pedido asignado (0,5 = medio pedido).',
  },
  atrapados_modo: {
    grupo: 'La cola',
    label: 'Pedidos atrapados',
    explica: 'Qué hacer con pedidos asignados a un móvil que no salió: excluirlos, contarlos como sin asignar, o dejarlos en la cola.',
  },
  estadistico: {
    grupo: 'El ritmo',
    label: 'Estadístico del ritmo',
    explica: 'Con qué resumen de la historia se calcula el ritmo: MEDIANA (vigente — un caso raro no arrastra el número), MEDIA, P75 o P90.',
  },
  ritmo_dias_ventana: {
    grupo: 'El ritmo',
    label: 'Ventana de historia (días)',
    explica: 'Cuántos días para atrás se miran las entregas para calcular el ritmo.',
  },
  ritmo_min_muestras: {
    grupo: 'El ritmo',
    label: 'Muestras mínimas del ritmo',
    explica: 'Cuántas entregas hacen falta en un nivel de la cascada (chofer → móvil → zona → global) para confiar en su ritmo; si no llega, se baja al siguiente nivel.',
  },
  ritmo_hueco_max_minutos: {
    grupo: 'El ritmo',
    label: 'Hueco máximo entre entregas',
    explica: 'Un intervalo más largo que esto entre dos entregas es almuerzo, recarga o inactividad — no ritmo de trabajo — y se descarta de la estadística.',
  },
  ritmo_hueco_min_minutos: {
    grupo: 'El ritmo',
    label: 'Piso del intervalo',
    explica: 'Intervalos más cortos que esto son marcaciones en lote (varios cierres juntos), no entregas reales: también se descartan.',
  },
  ritmo_default_minutos: {
    grupo: 'El ritmo',
    label: 'Ritmo por defecto',
    explica: 'Minutos por pedido cuando no hay NINGUNA estadística disponible (ni del chofer, ni del móvil, ni de la zona, ni global).',
  },
  ritmo_solo_con_cola: {
    grupo: 'El ritmo',
    label: 'Solo intervalos con cola',
    explica: 'Contar únicamente los intervalos en los que el móvil ya tenía el próximo pedido esperando (si no lo tenía, ese tiempo es ocio, no ritmo).',
  },
  dedicacion_transito: {
    grupo: 'Capacidad y traslados',
    label: 'Dedicación de un móvil de tránsito',
    explica: 'Un móvil que pasa por la zona pero no es de ella aporta solo esta fracción de su capacidad (0,2 = un quinto).',
  },
  transito_dedicacion_max_total: {
    grupo: 'Capacidad y traslados',
    label: 'Tope total de tránsitos',
    explica: 'Por muchos tránsitos que haya, entre todos no pueden aportar más que esto: la prioridad de la zona nunca queda diluida.',
  },
  traslado_fuera_zona_minutos: {
    grupo: 'Capacidad y traslados',
    label: 'Traslado de vuelta a la zona',
    explica: 'Minutos que tarda un móvil en volver a la zona cuando termina lo que tenía afuera. Se suma una sola vez, no por pedido.',
  },
  incluir_entrega_propia: {
    grupo: 'Capacidad y traslados',
    label: 'Contar la entrega propia',
    explica: 'Si la demora prometida llega hasta la ENTREGA del pedido (vigente) o solo hasta que el móvil sale.',
  },
  vecinas_modo: {
    grupo: 'Modelo',
    label: 'Zonas vecinas',
    explica: 'Si la cola de las zonas vecinas se considera en el cálculo (hoy se ignora).',
  },
  factor_calibracion: {
    grupo: 'Modelo',
    label: 'Factor de calibración global',
    explica: 'Multiplica el resultado crudo del modelo. 1 = sin ajuste; sirve para corregir un sesgo sistemático si se detectara.',
  },
};

/** Orden de los grupos en la tabla de parametría. */
export const GRUPOS_PERILLAS = [
  'Salida publicada', 'Suavizado', 'Arranque sin móvil', 'La cola',
  'El ritmo', 'Capacidad y traslados', 'Modelo',
];

/** El viaje de un pedido, paso a paso (esquema animado de la doc). */
export const VIAJE_PEDIDO = [
  { titulo: 'Se toma el pedido', detalle: 'El cliente pide. En ese instante hay DOS promesas sobre la mesa: la del Despacho (cargada por la operativa en el AS400) y la del motor (la corrida vigente de esa zona).' },
  { titulo: 'La promesa viaja congelada', detalle: 'La demora informada queda grabada en el pedido: no se recalcula después. Lo que se prometió, se prometió.' },
  { titulo: 'Se asigna y se entrega', detalle: 'Un móvil lo toma y lo entrega. La hora de cierre real queda registrada.' },
  { titulo: 'Se mide el desfasaje', detalle: 'Real menos prometido, CON signo: −10 = llegó 10 minutos antes; +17 = llegó 17 tarde. Se mide contra las dos promesas por separado.' },
  { titulo: 'Entra a las estadísticas', detalle: 'El pedido cae en su franja de 5 minutos y suma (o no) al KPI: % con desfasaje de 25 minutos o menos — "en tiempo y forma".' },
];

/**
 * Ejemplo trabajado del arranque predictivo (los números del harness:
 * zona con histórico 08:40, ritmo 30, sin cola).
 */
export const EJEMPLO_PREDICTIVO = [
  { hora: '08:00', cuenta: '40 min de espera + 1 entrega × 30', publica: 75, fase: 'Esperando al 1er móvil' },
  { hora: '08:10', cuenta: '30 + 30 = 60', publica: 60, fase: 'Esperando al 1er móvil' },
  { hora: '08:20', cuenta: '20 + 30 = 50', publica: 45, fase: 'Esperando al 1er móvil' },
  { hora: '08:30', cuenta: '10 + 30 = 40', publica: 45, fase: 'Esperando al 1er móvil' },
  { hora: '08:40', cuenta: 'el móvil se activó → motor normal', publica: 30, fase: 'Motor normal' },
];
