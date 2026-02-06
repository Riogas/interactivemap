/**
 * 🔍 UTILIDADES DE DEBUGGING PARA RENDIMIENTO DEL MAPA
 * 
 * Usa estas funciones en la consola del navegador para monitorear
 * el rendimiento del mapa y validar las optimizaciones.
 */

// ===== MONITOREO DE FPS =====

/**
 * Inicia el monitor de FPS
 * Muestra los FPS en tiempo real en la esquina superior derecha
 */
window.startFpsMonitor = function() {
  if (window.fpsMonitor) {
    console.warn('⚠️ FPS Monitor ya está activo');
    return;
  }

  const div = document.createElement('div');
  div.id = 'fps-monitor';
  div.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    background: rgba(0,0,0,0.8);
    color: #0f0;
    padding: 10px;
    font-family: monospace;
    font-size: 14px;
    z-index: 999999;
    border-radius: 5px;
  `;
  document.body.appendChild(div);

  let lastTime = performance.now();
  let frames = 0;
  let fps = 0;

  function tick() {
    frames++;
    const now = performance.now();
    
    if (now >= lastTime + 1000) {
      fps = Math.round(frames * 1000 / (now - lastTime));
      frames = 0;
      lastTime = now;
    }
    
    const color = fps >= 50 ? '#0f0' : fps >= 30 ? '#ff0' : '#f00';
    div.innerHTML = `
      <div style="font-weight: bold; color: ${color};">FPS: ${fps}</div>
      <div style="font-size: 10px; color: #888;">
        ${fps >= 50 ? '✅ Excelente' : fps >= 30 ? '⚠️ Aceptable' : '❌ Lento'}
      </div>
    `;
    
    window.fpsMonitor = requestAnimationFrame(tick);
  }
  
  tick();
  console.log('✅ FPS Monitor activado');
};

/**
 * Detiene el monitor de FPS
 */
window.stopFpsMonitor = function() {
  if (window.fpsMonitor) {
    cancelAnimationFrame(window.fpsMonitor);
    window.fpsMonitor = null;
    const div = document.getElementById('fps-monitor');
    if (div) div.remove();
    console.log('🛑 FPS Monitor detenido');
  }
};

// ===== ESTADÍSTICAS DEL MAPA =====

/**
 * Obtiene estadísticas actuales del mapa
 */
window.getMapStats = function() {
  const markers = document.querySelectorAll('.leaflet-marker-icon');
  const polylines = document.querySelectorAll('.leaflet-interactive[stroke]');
  const popups = document.querySelectorAll('.leaflet-popup');
  
  const stats = {
    marcadores: markers.length,
    polylines: polylines.length,
    popups_activos: popups.length,
    elementos_dom_mapa: document.querySelectorAll('.leaflet-pane *').length,
  };
  
  console.table(stats);
  return stats;
};

// ===== BENCHMARK DE NAVEGACIÓN =====

/**
 * Ejecuta un benchmark de navegación del mapa
 * Mide el tiempo de render al hacer zoom y pan
 */
window.benchmarkMapNavigation = async function() {
  console.log('🧪 Iniciando benchmark de navegación...');
  
  const results = {
    zoom_in: [],
    zoom_out: [],
    pan: [],
  };
  
  const map = window.L?.map;
  if (!map) {
    console.error('❌ No se encontró el mapa de Leaflet');
    return;
  }
  
  // Test Zoom In
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    await new Promise(resolve => {
      map.once('zoomend', resolve);
      map.zoomIn();
    });
    results.zoom_in.push(performance.now() - start);
    await new Promise(r => setTimeout(r, 500));
  }
  
  // Test Zoom Out
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    await new Promise(resolve => {
      map.once('zoomend', resolve);
      map.zoomOut();
    });
    results.zoom_out.push(performance.now() - start);
    await new Promise(r => setTimeout(r, 500));
  }
  
  // Test Pan
  const center = map.getCenter();
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    await new Promise(resolve => {
      map.once('moveend', resolve);
      map.panBy([100, 100]);
    });
    results.pan.push(performance.now() - start);
    await new Promise(r => setTimeout(r, 500));
    map.setView(center);
  }
  
  // Calcular promedios
  const avg = arr => arr.reduce((a, b) => a + b) / arr.length;
  
  const summary = {
    'Zoom In (promedio)': `${avg(results.zoom_in).toFixed(2)}ms`,
    'Zoom Out (promedio)': `${avg(results.zoom_out).toFixed(2)}ms`,
    'Pan (promedio)': `${avg(results.pan).toFixed(2)}ms`,
  };
  
  console.log('📊 Resultados del Benchmark:');
  console.table(summary);
  
  // Evaluación
  const avgAll = (avg(results.zoom_in) + avg(results.zoom_out) + avg(results.pan)) / 3;
  if (avgAll < 50) {
    console.log('✅ Rendimiento EXCELENTE (<50ms)');
  } else if (avgAll < 100) {
    console.log('⚠️ Rendimiento BUENO (50-100ms)');
  } else {
    console.log('❌ Rendimiento MEJORABLE (>100ms)');
  }
  
  return summary;
};

// ===== ANÁLISIS DE RE-RENDERS =====

/**
 * Activa el highlight de re-renders de React
 */
window.enableReactRenderHighlight = function() {
  console.log('💡 Para ver re-renders:');
  console.log('1. Abre React DevTools');
  console.log('2. Settings ⚙️');
  console.log('3. Profiler');
  console.log('4. Activa "Highlight updates when components render"');
};

// ===== COMPARACIÓN ANTES/DESPUÉS =====

/**
 * Genera un reporte comparativo del rendimiento
 */
window.generatePerformanceReport = function() {
  const stats = window.getMapStats();
  
  const report = {
    '📊 Estadísticas Actuales': '',
    'Marcadores en pantalla': stats.marcadores,
    'Polylines activas': stats.polylines,
    'Total elementos DOM': stats.elementos_dom_mapa,
    '': '',
    '🎯 Benchmarks Esperados': '',
    'FPS objetivo': '> 50 FPS',
    'Zoom/Pan objetivo': '< 50ms',
    'Re-renders': 'Minimizados con React.memo',
    '  ': '',
    '✅ Optimizaciones Activas': '',
    'React.memo': 'Marcadores y Polylines',
    'Path simplification': 'Douglas-Peucker',
    'Icon caching': 'Todos los iconos',
    'Smart filtering': 'Marcadores de historial',
  };
  
  console.log('📋 REPORTE DE RENDIMIENTO');
  console.table(report);
  
  console.log('');
  console.log('🚀 Comandos disponibles:');
  console.log('  startFpsMonitor()           - Monitor de FPS en tiempo real');
  console.log('  getMapStats()               - Estadísticas del mapa');
  console.log('  benchmarkMapNavigation()    - Test de rendimiento');
};

// ===== AUTORUN =====

console.log('🔧 Utilidades de debugging cargadas');
console.log('Ejecuta: generatePerformanceReport()');
