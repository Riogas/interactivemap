/**
 * Script de prueba para verificar la conexión con la API
 * 
 * Ejecutar en consola del navegador (F12):
 * 
 * 1. Copia todo este código
 * 2. Pégalo en la consola
 * 3. Verifica los logs
 */

async function testApiConnection() {
  console.log('🧪 Iniciando pruebas de conexión API...\n');

  // Test 1: Verificar que el proxy está activo
  console.log('📋 Test 1: Verificar proxy local');
  try {
    const proxyTest = await fetch('/api/proxy/puestos/gestion/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        UserName: 'test',
        Password: 'test',
      }),
    });
    
    console.log('✅ Proxy está activo');
    console.log('   Status:', proxyTest.status);
    console.log('   Headers:', Object.fromEntries(proxyTest.headers.entries()));
    
    const proxyData = await proxyTest.json();
    console.log('   Response:', proxyData);
  } catch (error) {
    console.error('❌ Error en proxy:', error);
  }

  console.log('\n' + '='.repeat(50) + '\n');

  // Test 2: Login con credenciales reales
  console.log('📋 Test 2: Login con credenciales');
  try {
    const loginResponse = await fetch('/api/proxy/puestos/gestion/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        UserName: 'jgomez',
        Password: 'VeintiunoDeOctubre!',
      }),
    });
    
    console.log('Status:', loginResponse.status);
    console.log('Status Text:', loginResponse.statusText);
    console.log('Headers:', Object.fromEntries(loginResponse.headers.entries()));
    
    const loginData = await loginResponse.json();
    console.log('Response:', loginData);
    
    if (loginResponse.ok) {
      console.log('✅ Login exitoso');
      
      // Intentar parsear RespuestaLogin si existe
      if (loginData.RespuestaLogin) {
        try {
          const parsed = JSON.parse(loginData.RespuestaLogin);
          console.log('\n📊 Datos parseados:');
          console.log('   Success:', parsed.success);
          console.log('   Token:', parsed.token);
          console.log('   User:', parsed.user);
          console.log('   Roles:', parsed.user?.roles);
        } catch (e) {
          console.error('⚠️ No se pudo parsear RespuestaLogin:', e);
        }
      }
    } else {
      console.error('❌ Login falló');
    }
  } catch (error) {
    console.error('❌ Error en login:', error);
    console.error('   Message:', error.message);
    console.error('   Stack:', error.stack);
  }

  console.log('\n' + '='.repeat(50) + '\n');

  // Test 3: Verificar authService
  console.log('📋 Test 3: Verificar authService');
  try {
    const { authService } = await import('/lib/api/auth.ts');
    console.log('✅ authService cargado');
    
    const result = await authService.login('jgomez', 'VeintiunoDeOctubre!');
    console.log('Response:', result);
    
    if (result.success) {
      console.log('✅ authService.login() funciona correctamente');
      console.log('   Token:', result.token);
      console.log('   Usuario:', result.user.username);
      console.log('   Roles:', result.user.roles);
    } else {
      console.error('❌ authService.login() falló');
      console.error('   Message:', result.message);
    }
  } catch (error) {
    console.error('❌ Error con authService:', error);
    console.error('   Message:', error.message);
  }

  console.log('\n🏁 Pruebas completadas\n');
}

// Ejecutar pruebas
testApiConnection();
