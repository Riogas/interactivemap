'use client';

import { useMemo, useState } from 'react';
import { badgePrincipal, resumenAuth } from './docs-logic';
import { IconoAlerta, IconoArchivo, IconoEscudoAlerta, IconoInfo, IconoLlave } from './Iconos';
import { Badge, ChipMetodo, Kpi, Seccion } from './Piezas';
import { TextoRico } from './texto-rico';
import type { Endpoint, SpecDocs } from './tipos';

/**
 * "Estado de la autenticación": el apartado que justifica que este portal sea solo-root.
 *
 * No es un resumen amable: es el conteo real de cuántos endpoints no validan nada, con
 * el listado completo y clickeable. Esconderlo detrás de un acordeón o mostrarlo como
 * un porcentaje sin nombres sería peor que no tenerlo — el punto es que un root pueda
 * ver, de una, cuál es la superficie expuesta hoy.
 */
export function EstadoAuth({
  endpoints,
  spec,
  onSeleccionar,
}: {
  endpoints: Endpoint[];
  spec: SpecDocs | null;
  onSeleccionar: (id: string) => void;
}) {
  const resumen = useMemo(() => resumenAuth(endpoints), [endpoints]);
  const [verSpoofeables, setVerSpoofeables] = useState(false);
  const anotaciones = spec?.['x-anotaciones'];

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-5 sm:px-6">
      <header className="rounded-xl border border-stats-destructive/30 bg-stats-surface p-4 shadow-sm">
        <h2 className="flex items-center gap-2 text-[1.05rem] font-bold text-stats-foreground">
          <span className="text-stats-destructive">
            <IconoEscudoAlerta size={20} />
          </span>
          Estado de la autenticación
        </h2>
        <p className="mt-1.5 text-[0.82rem] leading-relaxed text-stats-muted-fg">
          Este catálogo publica qué endpoints de TrackMovil no validan nada y cuáles se apoyan en un gate que se
          puede forjar desde el navegador. Es información sensible y es exactamente por eso que{' '}
          <code className="font-stats-mono">/docs</code> tiene un gate server-side contra SecuritySuite, fail-closed.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi valor={resumen.total} etiqueta="Endpoints en el catálogo" detalle="Generados desde app/api/**/route.ts" />
        <Kpi
          valor={resumen.sinAuth.length}
          etiqueta="Sin ningún gate"
          detalle={`${resumen.porcentajeSinAuth}% del total — alcanzables por cualquiera que llegue al puerto`}
          tono="peligro"
        />
        <Kpi
          valor={resumen.spoofeables.length}
          etiqueta="Gate por header forjable"
          detalle="x-track-isroot lo pone el front: como control de acceso no alcanza"
          tono="aviso"
        />
        <Kpi
          valor={resumen.porApiKey.length}
          etiqueta="Por API key"
          detalle="x-api-key / INTERNAL_API_KEY, comparación timing-safe"
          tono="ok"
        />
      </div>

      {/* ── Los que no validan nada ──────────────────────────────────────── */}
      <Seccion
        titulo={`Endpoints sin ningún gate (${resumen.sinAuth.length})`}
        icono={<IconoAlerta size={15} />}
        hint="El handler no invoca requireAuth, requireApiKey, requireFuncionalidad ni ningún otro control."
      >
        {resumen.sinAuth.length === 0 ? (
          <p className="text-[0.82rem] text-stats-success">Ninguno. Todos los endpoints invocan algún gate.</p>
        ) : (
          <ul className="divide-y divide-stats-border overflow-hidden rounded-lg border border-stats-border">
            {resumen.sinAuth.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => onSeleccionar(e.id)}
                  className="flex w-full items-center gap-2 bg-stats-surface px-3 py-2 text-left transition-colors hover:bg-stats-destructive-soft"
                >
                  <ChipMetodo metodo={e.metodo} />
                  <code className="min-w-0 flex-1 truncate font-stats-mono text-[0.8rem] text-stats-foreground">
                    {e.ruta}
                  </code>
                  <span className="hidden shrink-0 font-stats-mono text-[0.7rem] uppercase text-stats-muted-fg sm:inline">
                    {e.modulo}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Seccion>

      {/* ── Los que dependen de un header forjable ───────────────────────── */}
      <Seccion
        titulo={`Gate por header forjable (${resumen.spoofeables.length})`}
        icono={<IconoLlave size={15} />}
        hint="Sí validan algo, pero parte de la decisión la toma un header que escribe el cliente."
        acciones={
          <button
            type="button"
            onClick={() => setVerSpoofeables((v) => !v)}
            className="rounded-md border border-stats-border px-2 py-0.5 text-[0.72rem] text-stats-muted-fg transition-colors hover:border-stats-primary hover:text-stats-primary"
          >
            {verSpoofeables ? 'Ocultar' : 'Ver los ' + resumen.spoofeables.length}
          </button>
        }
      >
        <p className="text-[0.82rem] leading-relaxed text-stats-muted-fg">
          <code className="font-stats-mono">x-track-isroot</code> y{' '}
          <code className="font-stats-mono">x-track-funcs</code> los pone el front al llamar a la API. Un cliente
          que los escriba a mano se presenta como root. Para el scope de datos alcanza (el peor caso es ver de más
          dentro de la propia app); para autorizar el catálogo de APIs, no — por eso{' '}
          <code className="font-stats-mono">/docs</code> usa otro gate.
        </p>
        {verSpoofeables && resumen.spoofeables.length > 0 && (
          <ul className="mt-3 divide-y divide-stats-border overflow-hidden rounded-lg border border-stats-border">
            {resumen.spoofeables.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => onSeleccionar(e.id)}
                  className="flex w-full items-center gap-2 bg-stats-surface px-3 py-2 text-left transition-colors hover:bg-stats-warning-soft"
                >
                  <ChipMetodo metodo={e.metodo} />
                  <code className="min-w-0 flex-1 truncate font-stats-mono text-[0.8rem] text-stats-foreground">
                    {e.ruta}
                  </code>
                  <Badge tono={badgePrincipal(e.op).tono} className="hidden sm:inline-flex">
                    {badgePrincipal(e.op).etiqueta}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Seccion>

      {/* ── Lo que hay que saber sí o sí ─────────────────────────────────── */}
      <Seccion titulo="Tres cosas que no se ven en la tabla" icono={<IconoInfo size={15} />}>
        <ol className="space-y-3 text-[0.82rem] leading-relaxed text-stats-muted-fg">
          <li>
            <strong className="text-stats-foreground">Los gates por API key tienen un interruptor global.</strong>{' '}
            <code className="font-stats-mono">requireApiKey</code> y{' '}
            <code className="font-stats-mono">requireAuth</code> (lib/auth-middleware.ts) devuelven OK sin mirar nada
            si <code className="font-stats-mono">ENABLE_SECURITY_CHECKS=&apos;false&apos;</code>. En producción esa
            variable tiene que estar sin setear o en <code className="font-stats-mono">true</code>.{' '}
            <code className="font-stats-mono">/api/import/gps</code> es la excepción: compara con{' '}
            <code className="font-stats-mono">safeCompare</code> directo, sin ese bypass.
          </li>
          <li>
            <strong className="text-stats-foreground">El JWT de SecuritySuite no dice si sos root.</strong> Su
            payload es <code className="font-stats-mono">{'{iss, username, userId, sistema}'}</code>: ninguna app
            puede decidirlo leyendo el token, hay que preguntarle a secapi. Eso es lo que hace el gate de este
            portal en cada request.
          </li>
          <li>
            <strong className="text-stats-foreground">Un 403 en HTML no lo devuelve la app.</strong> Delante de
            TrackMovil hay un WAF de nginx que rechaza los requests con sintaxis de shell en el cuerpo o en la
            query. Por eso el &quot;Probar&quot; de este portal manda el request en base64.
          </li>
        </ol>
      </Seccion>

      {/* ── Salud del catálogo ───────────────────────────────────────────── */}
      <Seccion titulo="Salud del catálogo" icono={<IconoArchivo size={15} />}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Kpi valor={resumen.anotados} etiqueta="Anotados a mano" detalle="Con entrada en anotaciones.yaml" />
          <Kpi
            valor={resumen.total - resumen.anotados}
            etiqueta="Solo generados"
            detalle="Sin consumidores ni ejemplos anotados"
            tono={resumen.total - resumen.anotados > 0 ? 'aviso' : 'ok'}
          />
          <Kpi
            valor={anotaciones?.huerfanas?.length ?? 0}
            etiqueta="Anotaciones huérfanas"
            detalle="Apuntan a un endpoint que ya no existe"
            tono={(anotaciones?.huerfanas?.length ?? 0) > 0 ? 'peligro' : 'ok'}
          />
        </div>

        {(anotaciones?.huerfanas?.length ?? 0) > 0 && (
          <ul className="mt-3 space-y-1">
            {anotaciones?.huerfanas?.map((h) => (
              <li key={h} className="font-stats-mono text-[0.76rem] text-stats-destructive">
                {h}
              </li>
            ))}
          </ul>
        )}

        {anotaciones?.error && (
          <p className="mt-3 rounded-lg border border-stats-destructive/40 bg-stats-destructive-soft px-3 py-2 text-[0.78rem] text-stats-destructive">
            anotaciones.yaml no se pudo parsear: {anotaciones.error}. Se está sirviendo solo lo generado.
          </p>
        )}
      </Seccion>
    </div>
  );
}

/** Lo que quedó fuera del catálogo endpoint por endpoint, con su motivo. */
export function FueraDelCatalogo({ spec }: { spec: SpecDocs | null }) {
  const excluidos = spec?.['x-excluidos'] ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-5 sm:px-6">
      <header className="rounded-xl border border-stats-border bg-stats-surface p-4 shadow-sm">
        <h2 className="text-[1.05rem] font-bold text-stats-foreground">Fuera del catálogo</h2>
        <p className="mt-1.5 text-[0.82rem] leading-relaxed text-stats-muted-fg">
          Existen, se sirven, y no están documentados endpoint por endpoint. Que estén afuera del detalle no
          significa que no estén: se listan acá con el motivo.
        </p>
      </header>

      {excluidos.length === 0 ? (
        <Seccion titulo="Nada excluido" icono={<IconoInfo size={15} />}>
          <TextoRico texto="Todos los `route.ts` del repo están en el catálogo." />
        </Seccion>
      ) : (
        <ul className="space-y-3">
          {excluidos.map((e) => (
            <li key={e.archivo} className="rounded-xl border border-stats-border bg-stats-surface p-4 shadow-sm">
              <code className="flex items-center gap-2 font-stats-mono text-[0.82rem] font-semibold text-stats-foreground">
                <IconoArchivo size={14} />
                {e.archivo}
              </code>
              <p className="mt-1.5 text-[0.8rem] leading-relaxed text-stats-muted-fg">{e.motivo}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
