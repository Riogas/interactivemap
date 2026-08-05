/**
 * La lista de perillas editables de demoras_modelo — fuente ÚNICA,
 * compartida por el endpoint (whitelist del PUT), la pantalla de
 * Preferencias Globales y la documentación viva.
 *
 * REGLA: agregar una perilla acá obliga a documentarla en
 * components/metricas/documentacion-data.ts — hay un test que falla si
 * falta (así la documentación no puede quedarse vieja cuando se ajusta
 * el cálculo).
 */
export const CAMPOS_MODELO_LISTA = [
  'modelo',
  'min_minutos', 'max_minutos', 'escalon_minutos',
  'subida_max', 'bajada_max', 'suavizado_bypass_cambio_capacidad',
  'arranque_sin_movil_modo',
  'activacion_percentil', 'activacion_margen_minutos',
  'activacion_min_muestras', 'activacion_gracia_minutos',
  'asignados_modo', 'peso_asignados', 'atrapados_modo',
  'estadistico', 'ritmo_dias_ventana', 'ritmo_min_muestras',
  'ritmo_hueco_max_minutos', 'ritmo_hueco_min_minutos',
  'ritmo_default_minutos', 'ritmo_solo_con_cola',
  'dedicacion_transito', 'transito_dedicacion_max_total',
  'traslado_fuera_zona_minutos',
  'incluir_entrega_propia', 'vecinas_modo', 'factor_calibracion',
] as const;

export type CampoModelo = (typeof CAMPOS_MODELO_LISTA)[number];
