# Modo Kiosko

Un usuario marcado con el atributo de rol `ModoKiosko` deja la pantalla de
`/dashboard/stats` corriendo indefinidamente en una PC de pared, **sin instalar
nada** aparte de Edge en modo kiosko:

- La sesión **nunca expira por inactividad** (no hace falta jiggle de mouse).
- La sesión **sobrevive reinicios de navegador/PC** (persiste en `localStorage`
  SOLO para este usuario — ver "Nota de seguridad" abajo).
- Poco después de **medianoche** (America/Montevideo) la vista rueda sola a la
  fecha de hoy y refresca datos, sin intervención humana.

Esto reemplaza, para el caso de uso de pantalla de pared, al script externo
`Documents/Projects/trackmovil-kiosk` (Node + Playwright) — ya no hace falta
instalarlo para una PC nueva. El script sigue existiendo y sigue siendo válido,
pero no es necesario si la PC solo necesita mostrar `/dashboard/stats`.

## Armado de la PC de pared

### 1. Asignar el atributo `ModoKiosko` al usuario

En el SecuritySuite, agregar el atributo `ModoKiosko` con valor `true` (o `S` /
`1`) al usuario (o a un rol) que va a operar la PC de pared. Mismo circuito que
`TiempoInactividadMin`: override por usuario > por rol > default `false`.

> Recomendado: crear un usuario dedicado de **solo lectura de estadísticas**
> (sin acceso al mapa ni a operaciones), y asignarle `ModoKiosko` a ESE usuario
> puntual — no a un rol amplio que otras personas también usan para trabajar
> desde su PC normal.

Si además se le asigna el atributo `PantallaLogin=stats`, un login humano de
ese usuario también aterriza directo en estadísticas (opcional, no requerido:
el acceso directo del paso 2 ya apunta a la URL exacta).

### 2. Acceso directo de Edge en modo kiosko

Crear un acceso directo a Edge con destino:

```
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --kiosk "https://track.glp.riogas.com.uy/login" --edge-kiosk-type=fullscreen --no-first-run
```

(ajustar la URL al dominio real del entorno). Copiar ese acceso directo a la
carpeta de Inicio de Windows para el usuario de la PC:

```
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
```

Así, al iniciar sesión en Windows, Edge se abre solo en pantalla completa
apuntando al login. El primer login es manual (una única vez, con el usuario
`ModoKiosko`); a partir de ahí, la sesión persiste sola.

### 3. Auto-login de Windows (`netplwiz`)

Para que la PC vuelva a mostrar estadísticas sola después de un apagón o
reinicio, sin que nadie tenga que loguearse en Windows:

1. `Win + R` → `netplwiz` → Enter.
2. Seleccionar el usuario de Windows de esa PC, destildar *"Los usuarios deben
   escribir su nombre y contraseña..."*, Aplicar, y poner la contraseña.
3. Al encender, Windows entra solo → el acceso directo de Inicio abre Edge →
   Edge rehidrata la sesión persistida (`localStorage`) y muestra estadísticas
   sin login.

### 4. BIOS: encender solo al volver la luz

Para que la PC se prenda sola después de un corte de energía (sin que alguien
tenga que apretar el botón de power):

1. Entrar a la BIOS/UEFI al bootear (tecla de acceso según el fabricante —
   `Del`, `F2`, `F10`, etc.).
2. Buscar la opción de encendido tras pérdida de AC — nombres típicos:
   **"Restore on AC Power Loss"**, **"AC Power Recovery"**, **"After Power
   Loss"**. Setearla en **"Power On"** (o "Last State", si "Power On" no está
   disponible).
3. Guardar y salir.

Con los 4 pasos combinados, el ciclo completo (corte de luz → vuelve la luz →
PC enciende sola → Windows entra solo → Edge abre solo → estadísticas
logueadas solas → rollover de medianoche solo) corre sin intervención humana.

## Nota de seguridad

`ModoKiosko` hace que la sesión de ESE usuario persista en `localStorage` del
navegador de esa PC — sobrevive cerrar el navegador y reiniciar la PC. Para
todo usuario SIN `ModoKiosko`, el comportamiento sigue siendo el de hoy
(`sessionStorage`, se borra al cerrar la pestaña/navegador): esto no cambia.

Por eso:

- **Asignar `ModoKiosko` SOLO a cuentas de solo lectura de estadísticas**
  (sin acceso al mapa, sin permisos de escritura/operación).
- **Usar `ModoKiosko` SOLO en PCs internas de pared, sin acceso público** al
  teclado ni al sistema de archivos. Cualquiera con acceso físico a esa PC
  puede abrir el navegador y ver la sesión persistida — el atributo NO es una
  medida de aislamiento del navegador, es una comodidad operativa para una
  pantalla dedicada.
- **Si a un usuario le sacan `ModoKiosko` (revocación), la limpieza de la
  sesión persistida en `localStorage` ocurre recién en el siguiente LOGIN o
  LOGOUT real de ese usuario — NO en un simple reinicio de navegador/PC.**
  Un reinicio solo rehidrata la sesión ya guardada (con los atributos que
  tenía cacheados desde el último login), sin volver a consultar al servidor;
  por eso no detecta por sí solo que el atributo cambió del lado del
  SecuritySuite. Si hace falta cortar el acceso de inmediato (ej. la PC se
  robó o se comprometió), invalidar la sesión del lado del servidor o hacer
  **logout manual** en esa PC — reiniciarla sola no alcanza.

## Offset de rollover de medianoche

El offset (30 segundos por defecto tras la medianoche de Montevideo) es una
constante en código (`ROLLOVER_OFFSET_MS` en `lib/kiosk.ts`), no un setting de
base de datos ni de `/api/realtime-config`. Cambiarlo requiere un deploy.
