'use client';

/**
 * Documentación VIVA de la pantalla de estadística de cumplimiento:
 * cómo se calcula todo, explicado para cualquiera — con esquemas,
 * ejemplos trabajados y la parametría VIGENTE leída de la base al abrir
 * (cambiar una perilla en Preferencias Globales actualiza esta página
 * sola; agregar una perilla nueva OBLIGA a documentarla vía test).
 *
 * El botón "Imprimir / Guardar PDF" usa el diálogo del navegador con CSS
 * de impresión: elegir "Guardar como PDF" genera el documento.
 */

import { useEffect, useMemo, useState } from 'react';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { useAuth } from '@/contexts/AuthContext';
import { canSeeAllEmpresas } from '@/lib/auth-scope';
import { EXPLICACION_MOTOR } from '@/components/metricas/demora-comparativa-logic';
import { EXPLICACION_ACIERTO } from '@/components/metricas/desfasaje-logic';
import {
  PERILLAS_DOC, GRUPOS_PERILLAS, VIAJE_PEDIDO, EJEMPLO_PREDICTIVO,
} from '@/components/metricas/documentacion-data';
import {
  PROMO_MARGEN_PTS, PROMO_MIN_DIAS_EVALUADOS, PROMO_MIN_DIAS_GANADOS,
} from '@/components/metricas/variantes-logic';

const COLOR_DESPACHO = '#D55E00';
const COLOR_MOTOR = '#2456A6';

interface ModeloVivo {
  modelo: Record<string, string | number | boolean | null> | null;
  historial: { version: number; cambiado_at: string; cambiado_por: string | null }[];
}

function valorHumano(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  return String(v);
}

export function DocContent() {
  const { user, escenarioId } = useAuth();
  const funcionalidades = useMemo(
    () => (user?.roles ?? []).flatMap((r) => (r.funcionalidades ?? []).map((f) => f.nombre)),
    [user],
  );
  const isRootHeader = canSeeAllEmpresas(user) ? 'S' : 'N';
  const escenario = escenarioId ?? 1000;

  const [vivo, setVivo] = useState<ModeloVivo | null>(null);
  const [sinAcceso, setSinAcceso] = useState(false);

  useEffect(() => {
    fetch(`/api/demoras/modelo?escenario=${escenario}`, {
      headers: {
        'x-track-isroot': isRootHeader,
        'x-track-funcs': funcionalidades.join(','),
      },
    })
      .then((r) => {
        if (r.status === 403) {
          setSinAcceso(true);
          return null;
        }
        return r.json();
      })
      .then((j: { success: boolean; data?: ModeloVivo } | null) => {
        if (j?.success && j.data) setVivo(j.data);
      })
      .catch(() => setSinAcceso(true));
  }, [escenario, isRootHeader, funcionalidades]);

  const version = vivo?.modelo?.version ?? null;
  const ultimoCambio = vivo?.historial?.[0] ?? null;

  return (
    <div className="min-h-screen bg-white text-gray-800">
      <style>{`
        @keyframes docFadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        .doc-step { animation: docFadeUp .5s ease-out both; }
        @media (prefers-reduced-motion: reduce) { .doc-step { animation: none; } }
        @media print {
          .no-print { display: none !important; }
          .doc-section { break-inside: avoid-page; }
          body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        }
      `}</style>

      <div className="mx-auto max-w-4xl px-6 py-8">
        {/* ── Barra de acciones (no se imprime) ── */}
        <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
          <a href="/dashboard/metricas-cumplimiento" className="text-sm text-gray-600 hover:text-gray-900">
            ← Volver a la pantalla
          </a>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Imprimir / Guardar PDF
          </button>
        </div>

        {/* ── Portada ── */}
        <header className="doc-section mb-10">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">
            Cómo se calcula la demora y cómo se mide el acierto
          </h1>
          <p className="mt-2 text-[0.95rem] leading-relaxed text-gray-600">
            Esta es la documentación de la pantalla de estadística de cumplimiento, escrita para que cualquiera
            la pueda entender — sin conocer tablas ni fórmulas. Compara dos formas de prometerle una demora al
            cliente: la del <strong style={{ color: COLOR_DESPACHO }}>Despacho</strong> (cargada a mano por la
            operativa en el AS400) y la del <strong style={{ color: COLOR_MOTOR }}>motor</strong> (calculada cada
            10 minutos con datos reales). Y mide, pedido por pedido entregado, cuál de las dos le pegó más a la
            realidad.
          </p>
          <p className="mt-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-[0.82rem] text-gray-500">
            Documento vivo: la parametría de la sección 4 se lee de la configuración vigente al abrir esta página
            {version != null && <> (hoy: versión <strong>{String(version)}</strong>
    {ultimoCambio && <>, último cambio {new Date(ultimoCambio.cambiado_at).toLocaleString('es-UY', { timeZone: 'America/Montevideo' })}{ultimoCambio.cambiado_por ? ` por ${ultimoCambio.cambiado_por}` : ''}</>})</>}.
            Y cada ajuste al cálculo obliga a actualizar este texto: un control automático impide agregar una
            perilla sin documentarla.
          </p>
        </header>

        {/* ── 1. El viaje de un pedido ── */}
        <section className="doc-section mb-10">
          <h2 className="mb-3 text-xl font-bold text-gray-900">1 · El viaje de un pedido</h2>
          <ol className="space-y-2">
            {VIAJE_PEDIDO.map((p, i) => (
              <li key={p.titulo} className="doc-step flex gap-3 rounded-lg border border-gray-200 p-3" style={{ animationDelay: `${i * 120}ms` }}>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-900 text-sm font-bold text-white">{i + 1}</span>
                <div>
                  <p className="font-semibold text-gray-900">{p.titulo}</p>
                  <p className="text-[0.88rem] leading-relaxed text-gray-600">{p.detalle}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-[0.85rem] text-gray-600">
            <strong>Ejemplo:</strong> pedido tomado a las 10:00 con promesa de 45 minutos, entregado a las 11:02.
            Tardó 62; el desfasaje es 62 − 45 = <strong>+17</strong> → cae en la franja "20" y cuenta como acierto
            (≤ 25). Si hubiera llegado a las 11:20 (80 min, desfasaje +35), ya no.
          </div>
        </section>

        {/* ── 2. Cómo calcula el motor ── */}
        <section className="doc-section mb-10">
          <h2 className="mb-3 text-xl font-bold text-gray-900">2 · Cómo calcula el motor</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {EXPLICACION_MOTOR.map((s) => (
              <div key={s.titulo} className="rounded-lg border border-gray-200 p-3">
                <p className="text-[0.78rem] font-bold uppercase tracking-wide text-gray-500">{s.titulo}</p>
                <p className="mt-1 text-[0.88rem] leading-relaxed text-gray-700">{s.texto}</p>
              </div>
            ))}
          </div>

          <h3 className="mb-2 mt-6 font-semibold text-gray-900">La cascada del ritmo, en un esquema</h3>
          <div className="flex flex-wrap items-center gap-2 text-[0.85rem]">
            {['Historia del CHOFER', 'Historia del MÓVIL', 'Historia de la ZONA', 'Promedio GLOBAL', 'Valor por defecto'].map((n, i, arr) => (
              <span key={n} className="flex items-center gap-2">
                <span className={`rounded-md border px-2.5 py-1.5 ${i === 0 ? 'border-blue-300 bg-blue-50 font-semibold text-blue-900' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>{n}</span>
                {i < arr.length - 1 && <span aria-hidden className="text-gray-400">→</span>}
              </span>
            ))}
          </div>
          <p className="mt-1 text-[0.82rem] text-gray-500">
            Se usa el primer nivel que tenga muestras suficientes; cada flecha es "si no alcanza, bajo al siguiente".
          </p>

          <h3 className="mb-2 mt-6 font-semibold text-gray-900">La cola equivalente, con números</h3>
          <p className="text-[0.88rem] leading-relaxed text-gray-700">
            Tres pedidos esperan en la zona. Dos todavía no salieron (cuentan 1 cada uno). El tercero ya está
            arriba de un móvil hace 15 minutos, y el ritmo de la zona es 30 por pedido: le falta la mitad → cuenta
            0,5. Cola equivalente = 1 + 1 + 0,5 = <strong>2,5 pedidos</strong>. Por eso las colas pueden tener coma.
          </p>

          <h3 className="mb-2 mt-6 font-semibold text-gray-900">El redondeo y la escalera, con números</h3>
          <p className="text-[0.88rem] leading-relaxed text-gray-700">
            El modelo da 65: se publica <strong>75</strong> (el escalón de 15 redondea la promesa siempre hacia
            arriba, nunca a menos). Y si la corrida anterior publicó 120 y el modelo ahora pide 70, no se salta de
            golpe: baja de a pasos (120 → 105 → 90 → 75) — salvo que haya entrado o salido un móvil, que es un
            cambio real y el número salta directo.
          </p>
        </section>

        {/* ── 3. El arranque predictivo ── */}
        <section className="doc-section mb-10">
          <h2 className="mb-3 text-xl font-bold text-gray-900">3 · El arranque del día: la demora predictiva</h2>
          <p className="text-[0.88rem] leading-relaxed text-gray-700">
            A la mañana casi ninguna zona tiene móvil todavía. En vez de un número cargado a mano, el motor mira
            el histórico de la zona: <em>¿a qué hora suele activarse el primer móvil de prioridad este tipo de día
            (hábil, sábado o domingo)?</em> Y promete esa espera, más la cola, más tu entrega. Ejemplo real de una
            zona cuyo primer móvil suele aparecer a las 08:40 (ritmo 30, sin cola):
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-[0.86rem]">
              <thead>
                <tr className="border-b border-gray-300 text-left text-[0.72rem] font-bold uppercase tracking-wide text-gray-500">
                  <th className="px-2 py-1.5">Corrida</th><th className="px-2 py-1.5">La cuenta</th>
                  <th className="px-2 py-1.5">Publica</th><th className="px-2 py-1.5">Fase</th>
                </tr>
              </thead>
              <tbody>
                {EJEMPLO_PREDICTIVO.map((f) => (
                  <tr key={f.hora} className="border-b border-gray-100">
                    <td className="px-2 py-1.5 font-mono">{f.hora}</td>
                    <td className="px-2 py-1.5 text-gray-600">{f.cuenta}</td>
                    <td className="px-2 py-1.5 font-mono font-bold" style={{ color: COLOR_MOTOR }}>{f.publica}′</td>
                    <td className="px-2 py-1.5 text-gray-500">{f.fase}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 grid gap-2 text-[0.85rem] md:grid-cols-3">
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
              <p className="font-semibold text-blue-900">Esperando al 1er móvil</p>
              <p className="text-blue-800">Se promete la espera estimada + la cola. Los móviles de tránsito no cuentan.</p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="font-semibold text-amber-900">Gracia vencida</p>
              <p className="text-amber-800">Pasó la hora estimada + la gracia y no apareció: la demora sube hacia el techo.</p>
            </div>
            <div className="rounded-lg border border-purple-200 bg-purple-50 p-3">
              <p className="font-semibold text-purple-900">Con tránsito</p>
              <p className="text-purple-800">Pasó la hora máxima de espera: se calcula con lo que hay (tránsito a dedicación parcial, o el valor del Despacho como respaldo).</p>
            </div>
          </div>
        </section>

        {/* ── 4. La parametría vigente (VIVA) ── */}
        <section className="doc-section mb-10">
          <h2 className="mb-1 text-xl font-bold text-gray-900">4 · La parametría vigente</h2>
          <p className="mb-3 text-[0.82rem] text-gray-500">
            Leída de la configuración real al abrir esta página{version != null ? ` — versión ${String(version)}` : ''}.
            Se edita en Preferencias Globales → Motor de demora informada; cada guardado queda versionado.
          </p>
          {sinAcceso && (
            <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[0.82rem] text-amber-800">
              Tu usuario no tiene acceso a leer los valores vigentes (hace falta la funcionalidad Preferencias
              Globales): se muestra qué hace cada perilla, sin su valor actual.
            </p>
          )}
          {GRUPOS_PERILLAS.map((grupo) => (
            <div key={grupo} className="mb-4">
              <h3 className="mb-1 text-[0.78rem] font-bold uppercase tracking-wide text-gray-500">{grupo}</h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] border-collapse text-[0.85rem]">
                  <tbody>
                    {Object.entries(PERILLAS_DOC)
                      .filter(([, d]) => d.grupo === grupo)
                      .map(([key, d]) => (
                        <tr key={key} className="border-b border-gray-100 align-top">
                          <td className="w-56 px-2 py-1.5 font-medium text-gray-900">{d.label}</td>
                          <td className="w-24 px-2 py-1.5 font-mono font-semibold" style={{ color: COLOR_MOTOR }}>
                            {vivo?.modelo ? valorHumano(vivo.modelo[key]) : '—'}
                          </td>
                          <td className="px-2 py-1.5 leading-relaxed text-gray-600">{d.explica}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </section>

        {/* ── 5. Cómo se mide el acierto ── */}
        <section className="doc-section mb-10">
          <h2 className="mb-3 text-xl font-bold text-gray-900">5 · Cómo se mide el acierto</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {EXPLICACION_ACIERTO.map((s) => (
              <div key={s.titulo} className="rounded-lg border border-gray-200 p-3">
                <p className="text-[0.78rem] font-bold uppercase tracking-wide text-gray-500">{s.titulo}</p>
                <p className="mt-1 text-[0.88rem] leading-relaxed text-gray-700">{s.texto}</p>
              </div>
            ))}
          </div>
          <h3 className="mb-2 mt-6 font-semibold text-gray-900">Las franjas, visualmente</h3>
          <div className="flex overflow-hidden rounded-md border border-gray-200 text-center font-mono text-[0.72rem]">
            {['5', '10', '15', '20', '25', '30', '45', '60', '90+'].map((f, i) => (
              <span
                key={f}
                className={`flex-1 border-r border-white py-2 ${i < 5 ? 'font-bold text-white' : 'bg-gray-100 text-gray-500'}`}
                style={i < 5 ? { background: COLOR_MOTOR, opacity: 0.55 + i * 0.09 } : undefined}
              >
                {f}
              </span>
            ))}
          </div>
          <p className="mt-1 text-[0.82rem] text-gray-500">
            Cada pedido cae en su franja de 5 minutos según el desfasaje absoluto. Las azules (hasta 25) son el
            KPI: llegar "en tiempo y forma". Sobreprometer también es errar: un pedido que llega 40 minutos ANTES
            cae en la franja 45.
          </p>
        </section>

        {/* ── 6. Qué muestra cada card ── */}
        <section className="doc-section mb-10">
          <h2 className="mb-3 text-xl font-bold text-gray-900">6 · Qué muestra cada card de la pantalla</h2>
          <ul className="space-y-2 text-[0.88rem] leading-relaxed text-gray-700">
            <li><strong>Evolución del día (EN VIVO):</strong> la sala de control de hoy — corrida por corrida, qué se publica, las fases del arranque y el % ≤25′ acumulado, refrescado solo cada 60 segundos.</li>
            <li><strong>Demora calculada vs. informada:</strong> las dos líneas del día, zona por zona, con el "porqué" de cada número en el desglose.</li>
            <li><strong>Acierto de la demora:</strong> las franjas de desfasaje por pedido entregado, con el KPI ≤25′ y el modo Comparar sobre la población común.</li>
            <li><strong>Análisis del acierto:</strong> dónde y cuándo falla cada promesa — por día (con veredicto), por hora de la toma, peores zonas y peores casos, filtrable por día.</li>
            <li><strong>Laboratorio de variantes:</strong> el ranking de configuraciones alternativas del motor (ver sección 7): cuál viene acertando más, por día y acumulado.</li>
            <li><strong>Los KPI de arriba:</strong> el cumplimiento operativo clásico (tiempo asignado → cumplido) por chofer, móvil y zona.</li>
          </ul>
        </section>

        {/* ── 7. El laboratorio de variantes ── */}
        <section className="doc-section mb-10">
          <h2 className="mb-3 text-xl font-bold text-gray-900">7 · El laboratorio de variantes</h2>
          <p className="mb-3 text-[0.88rem] leading-relaxed text-gray-700">
            Cada vez que el motor corre, además de lo que publica, graba lo que <strong>hubiera publicado</strong> cada
            configuración alternativa de un catálogo: el promedio en vez de la mediana, el ritmo de la zona en vez del
            del chofer, la calibración ×1,00 / ×0,80 / ×0,75, el escalón de 10′ en vez de 15′, sin escalera de
            suavizado, la escalera más ágil (de a 30′), el piso de 20′, y combinaciones. Cada variante arrastra{' '}
            <strong>su propia escalera</strong> contra su corrida anterior — por eso esto no se puede reconstruir
            después con cuentas para atrás: hay que grabarlo en el momento.
          </p>
          <p className="mb-3 text-[0.88rem] leading-relaxed text-gray-700">
            La card <strong>Laboratorio de variantes</strong> cruza esas promesas alternativas contra las entregas
            reales (la misma vara que todo el resto: promesa vigente a la toma, agendados excluidos, mismo conjunto de
            pedidos para todas) y muestra la mejor combinación sola, sin que nadie tenga que correr un análisis a mano.
          </p>
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-[0.86rem] leading-relaxed text-gray-700">
            <strong>La regla de promoción (anti-ruido).</strong> Con más de diez variantes compitiendo, «la mejor del día»
            suele ganar por suerte. Una variante solo se declara <strong>PROMOVIBLE</strong> al motor si: (a) tiene al
            menos {PROMO_MIN_DIAS_EVALUADOS} días evaluables con volumen suficiente, (b) le ganó al motor real en al
            menos {PROMO_MIN_DIAS_GANADOS} de esos días, y (c) el acumulado le saca al menos {PROMO_MARGEN_PTS} puntos
            de acierto. Un día suelto no promociona a nadie.
          </div>
          <p className="mb-3 text-[0.86rem] leading-relaxed text-gray-700">
            La variante <strong>Campeón (control)</strong> replica exactamente al motor: si su porcentaje no coincide
            con el del motor real, el que está fallando es el laboratorio (la card lo vigila con el chip «espejo»).
            Probar una idea nueva es un alta en el catálogo — no toca el motor ni requiere programar nada.
          </p>
          <p className="text-[0.86rem] leading-relaxed text-gray-700">
            <strong>Por qué se graba en el momento y no se calcula después.</strong> El laboratorio corre aparte del
            motor, sobre las corridas que éste ya publicó, dentro del minuto siguiente. No puede reconstruir corridas
            viejas: las variantes que recalculan el ritmo necesitan el estado del mundo de ese instante (qué móviles
            estaban activos, qué pedidos había en cola) y ese estado ya no existe unas horas más tarde. Se comprobó al
            armarlo: al rellenar hacia atrás las corridas del día anterior, esas variantes prometían 105 minutos contra
            84 del campeón, casi todas contra el techo. Por eso una corrida que quedó afuera de la ventana no se
            rellena — preferimos no tener el dato antes que tenerlo mal.
          </p>
        </section>

        {/* ── 8. Glosario ── */}
        <section className="doc-section mb-8">
          <h2 className="mb-3 text-xl font-bold text-gray-900">8 · Glosario</h2>
          <dl className="grid gap-x-6 gap-y-2 text-[0.86rem] md:grid-cols-2">
            <div><dt className="font-semibold text-gray-900">Despacho</dt><dd className="text-gray-600">El sistema AS400 donde la operativa carga las demoras a mano. Naranja en todos los gráficos.</dd></div>
            <div><dt className="font-semibold text-gray-900">Motor</dt><dd className="text-gray-600">El cálculo automático de demora, cada 10 minutos por zona. Azul en todos los gráficos.</dd></div>
            <div><dt className="font-semibold text-gray-900">Corrida</dt><dd className="text-gray-600">Cada ejecución del motor (una foto cada 10 minutos).</dd></div>
            <div><dt className="font-semibold text-gray-900">Desfasaje</dt><dd className="text-gray-600">Real menos prometido, con signo: negativo = llegó antes.</dd></div>
            <div><dt className="font-semibold text-gray-900">Población común</dt><dd className="text-gray-600">Pedidos que tienen LAS DOS promesas: la única base justa para comparar.</dd></div>
            <div><dt className="font-semibold text-gray-900">p80</dt><dd className="text-gray-600">El 80% de los pedidos tuvo un desfasaje menor o igual a ese valor.</dd></div>
            <div><dt className="font-semibold text-gray-900">Sesgo</dt><dd className="text-gray-600">La mediana del desfasaje con signo: dice si una promesa sistemáticamente se queda corta o larga.</dd></div>
            <div><dt className="font-semibold text-gray-900">Móvil de prioridad / de tránsito</dt><dd className="text-gray-600">El de la zona a pleno / el que pasa por ella y aporta solo una dedicación parcial.</dd></div>
          </dl>
        </section>

        <footer className="border-t border-gray-200 pt-4 text-[0.78rem] text-gray-400">
          Generada desde el mismo código que ejecuta el cálculo. La parametría se lee en vivo; los textos se
          actualizan junto con cada ajuste del motor (controlado por tests). TrackMovil · RioGas.
        </footer>
      </div>
    </div>
  );
}

export default function DocumentacionPage() {
  return (
    <ProtectedRoute>
      <DocContent />
    </ProtectedRoute>
  );
}
