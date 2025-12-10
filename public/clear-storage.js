/**
 * 🧹 Script de Limpieza de LocalStorage
 * 
 * Ejecutar en la consola del navegador (F12) para limpiar datos corruptos
 */

// Limpiar datos de TrackMovil
console.log('🧹 Limpiando localStorage de TrackMovil...');

const userBefore = localStorage.getItem('trackmovil_user');
const tokenBefore = localStorage.getItem('trackmovil_token');

console.log('📊 Antes de limpiar:');
console.log('User:', userBefore);
console.log('Token:', tokenBefore);

localStorage.removeItem('trackmovil_user');
localStorage.removeItem('trackmovil_token');

console.log('✅ localStorage limpiado');
console.log('📊 Después de limpiar:');
console.log('User:', localStorage.getItem('trackmovil_user'));
console.log('Token:', localStorage.getItem('trackmovil_token'));

console.log('🔄 Recargando página...');
setTimeout(() => {
  location.reload();
}, 1000);
