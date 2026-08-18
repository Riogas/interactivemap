'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  agruparPorModulo,
  ambienteDeHost,
  badgePrincipal,
  esSinAuth,
  filtrarEndpoints,
  listarEndpoints,
  resumenAuth,
  type FiltroEndpoints,
} from './docs-logic';
import { EndpointDetalle } from './EndpointDetalle';
import { EstadoAuth, FueraDelCatalogo } from './EstadoAuth';
import {
  IconoAlerta,
  IconoBuscar,
  IconoCapas,
  IconoCerrar,
  IconoChevron,
  IconoEscudoAlerta,
  IconoLibro,
  IconoLuna,
  IconoMenu,
  IconoSol,
} from './Iconos';
import { Badge, ChipMetodo } from './Piezas';
import type { Endpoint, SpecDocs } from './tipos';

/**
 * Visor del portal de documentación de APIs.
 *
 * Estructura: barra superior fija con el resumen y el ambiente, navegación lateral por
 * módulo con buscador, y el detalle del endpoint seleccionado a la derecha. En pantalla
 * chica la navegación pasa a ser un panel deslizable — la página nunca scrollea de
 * costado.
 *
 * Todo el contenido llega de `GET /api/docs/spec` (gate root server-side): este
 * componente no tiene catálogo propio ni lo puede inventar.
 */

type Vista = { tipo: 'estado' } | { tipo: 'excluidos' } | { tipo: 'endpoint'; id: string };

const CLAVE_TEMA = 'docs-theme';

export function DocsViewer({ spec }: { spec: SpecDocs }) {
  const [tema, setTema] = useState<'light' | 'dark'>('light');
  const [texto, setTexto] = useState('');
  const [filtro, setFiltro] = useState<FiltroEndpoints>('todos');
  const [vista, setVista] = useState<Vista>({ tipo: 'estado' });
  const [navAbierta, setNavAbierta] = useState(false);
  const [origen, setOrigen] = useState('');
  const [host, setHost] = useState('');
  const buscador = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const guardado = window.localStorage.getItem(CLAVE_TEMA);
    if (guardado === 'dark' || guardado === 'light') setTema(guardado);
    // El host real del ambiente: los ejemplos y el "Try it" salen de acá, nunca de
    // una IP escrita a mano.
    setOrigen(window.location.origin);
    setHost(window.location.host);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(CLAVE_TEMA, tema);
  }, [tema]);

  // "/" enfoca el buscador, como en cualquier visor de documentación.
  useEffect(() => {
    function alTeclear(e: KeyboardEvent) {
      const destino = e.target as HTMLElement | null;
      const escribiendo =
        destino?.tagName === 'INPUT' || destino?.tagName === 'TEXTAREA' || destino?.isContentEditable;
      if (e.key === '/' && !escribiendo) {
        e.preventDefault();
        buscador.current?.focus();
      }
    }
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, []);

  const endpoints = useMemo(() => listarEndpoints(spec), [spec]);
  const visibles = useMemo(() => filtrarEndpoints(endpoints, texto, filtro), [endpoints, texto, filtro]);
  const modulos = useMemo(() => agruparPorModulo(visibles, spec), [visibles, spec]);
  const resumen = useMemo(() => resumenAuth(endpoints), [endpoints]);
  const ambiente = useMemo(() => ambienteDeHost(host), [host]);

  const seleccionado: Endpoint | null =
    vista.tipo === 'endpoint' ? (endpoints.find((e) => e.id === vista.id) ?? null) : null;

  function seleccionar(id: string) {
    setVista({ tipo: 'endpoint', id });
    setNavAbierta(false);
  }

  const nav = (
    <NavLateral
      modulos={modulos}
      total={endpoints.length}
      visibles={visibles.length}
      texto={texto}
      onTexto={setTexto}
      filtro={filtro}
      onFiltro={setFiltro}
      vista={vista}
      onVista={(v) => {
        setVista(v);
        setNavAbierta(false);
      }}
      sinAuth={resumen.sinAuth.length}
      anotados={resumen.anotados}
      refBuscador={buscador}
    />
  );

  return (
    <div
      data-theme={tema}
      className="flex h-full flex-col overflow-hidden bg-stats-background font-stats-sans text-stats-foreground"
    >
      {/* ── Barra superior ───────────────────────────────────────────────── */}
      <header className="z-20 shrink-0 border-b border-stats-border bg-stats-surface">
        <div className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
          <button
            type="button"
            onClick={() => setNavAbierta(true)}
            aria-label="Abrir navegación"
            className="rounded-lg border border-stats-border p-1.5 text-stats-muted-fg transition-colors hover:text-stats-foreground lg:hidden"
          >
            <IconoMenu size={16} />
          </button>

          <span className="hidden shrink-0 text-stats-primary sm:block">
            <IconoLibro size={20} />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-[0.95rem] font-bold leading-tight text-stats-foreground">
              {spec.info?.title ?? 'TrackMovil — API'}
            </h1>
            <p className="truncate text-[0.7rem] text-stats-muted-fg">
              Catálogo de APIs · solo-root
              {spec.info?.version ? ` · v${spec.info.version}` : ''}
            </p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <div className="hidden items-center gap-1.5 xl:flex">
              <Badge tono="neutro">{resumen.total} endpoints</Badge>
              <Badge tono={resumen.sinAuth.length > 0 ? 'peligro' : 'ok'} title="Sin ningún gate de autenticación">
                <IconoAlerta size={12} />
                {resumen.sinAuth.length} sin auth
              </Badge>
              <Badge tono="neutro">{resumen.anotados} anotados</Badge>
            </div>

            <Badge tono={ambiente.esProduccion ? 'peligro' : 'aviso'} title={ambiente.detalle}>
              {ambiente.etiqueta}
            </Badge>

            <button
              type="button"
              onClick={() => setTema((t) => (t === 'dark' ? 'light' : 'dark'))}
              aria-label={tema === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
              title={tema === 'dark' ? 'Tema claro' : 'Tema oscuro'}
              className="rounded-lg border border-stats-border p-1.5 text-stats-muted-fg transition-colors hover:border-stats-primary hover:text-stats-primary"
            >
              {tema === 'dark' ? <IconoSol size={15} /> : <IconoLuna size={15} />}
            </button>
          </div>
        </div>
      </header>

      {/* ── Cuerpo ───────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[19rem] shrink-0 flex-col overflow-hidden border-r border-stats-border bg-stats-surface lg:flex">
          {nav}
        </aside>

        {navAbierta && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              type="button"
              aria-label="Cerrar navegación"
              onClick={() => setNavAbierta(false)}
              className="absolute inset-0 h-full w-full bg-black/50"
            />
            <div className="metricas-modal-content absolute inset-y-0 left-0 flex w-[85%] max-w-sm flex-col overflow-hidden border-r border-stats-border bg-stats-surface">
              <div className="flex items-center justify-between border-b border-stats-border px-3 py-2">
                <span className="text-[0.82rem] font-semibold text-stats-foreground">Endpoints</span>
                <button
                  type="button"
                  onClick={() => setNavAbierta(false)}
                  aria-label="Cerrar"
                  className="rounded-lg border border-stats-border p-1 text-stats-muted-fg"
                >
                  <IconoCerrar size={14} />
                </button>
              </div>
              {nav}
            </div>
          </div>
        )}

        <main className="min-w-0 flex-1 overflow-y-auto">
          {vista.tipo === 'estado' && (
            <EstadoAuth endpoints={endpoints} spec={spec} onSeleccionar={seleccionar} />
          )}
          {vista.tipo === 'excluidos' && <FueraDelCatalogo spec={spec} />}
          {vista.tipo === 'endpoint' &&
            (seleccionado ? (
              <EndpointDetalle key={seleccionado.id} endpoint={seleccionado} origen={origen} ambiente={ambiente} />
            ) : (
              <div className="p-8 text-[0.85rem] text-stats-muted-fg">
                Ese endpoint ya no está en el catálogo. Regenerá con{' '}
                <code className="font-stats-mono">pnpm docs:api</code>.
              </div>
            ))}
        </main>
      </div>
    </div>
  );
}

/** Buscador + filtros + árbol de módulos. Se usa igual en el aside y en el panel móvil. */
function NavLateral({
  modulos,
  total,
  visibles,
  texto,
  onTexto,
  filtro,
  onFiltro,
  vista,
  onVista,
  sinAuth,
  anotados,
  refBuscador,
}: {
  modulos: ReturnType<typeof agruparPorModulo>;
  total: number;
  visibles: number;
  texto: string;
  onTexto: (v: string) => void;
  filtro: FiltroEndpoints;
  onFiltro: (f: FiltroEndpoints) => void;
  vista: Vista;
  onVista: (v: Vista) => void;
  sinAuth: number;
  anotados: number;
  refBuscador: React.RefObject<HTMLInputElement | null>;
}) {
  // Módulos abiertos a mano. Arrancan TODOS cerrados: son 40 y la lista completa
  // desplegada esconde el índice de módulos, que es lo que sirve para orientarse.
  // Se abren solos al buscar y al entrar a un endpoint desde otro lado del portal.
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const buscando = texto.trim() !== '';

  function alternar(nombre: string) {
    setAbiertos((prev) => {
      const copia = new Set(prev);
      if (copia.has(nombre)) copia.delete(nombre);
      else copia.add(nombre);
      return copia;
    });
  }

  const filtros: Array<{ clave: FiltroEndpoints; etiqueta: string; cantidad?: number }> = [
    { clave: 'todos', etiqueta: 'Todos', cantidad: total },
    { clave: 'sin-auth', etiqueta: 'Sin auth', cantidad: sinAuth },
    { clave: 'anotados', etiqueta: 'Anotados', cantidad: anotados },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-2 border-b border-stats-border p-3">
        <div className="relative">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-stats-muted-fg">
            <IconoBuscar size={14} />
          </span>
          <input
            ref={refBuscador}
            value={texto}
            onChange={(e) => onTexto(e.target.value)}
            placeholder="Buscar path, método, módulo…"
            aria-label="Buscar endpoints"
            className="w-full rounded-lg border border-stats-border bg-stats-surface-2 py-1.5 pl-8 pr-7 text-[0.8rem] text-stats-foreground outline-none transition-colors placeholder:text-stats-muted-fg focus:border-stats-primary"
          />
          {buscando && (
            <button
              type="button"
              onClick={() => onTexto('')}
              aria-label="Limpiar búsqueda"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-stats-muted-fg hover:text-stats-foreground"
            >
              <IconoCerrar size={13} />
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-1">
          {filtros.map((f) => (
            <button
              key={f.clave}
              type="button"
              onClick={() => onFiltro(f.clave)}
              className={`rounded-md px-2 py-0.5 text-[0.7rem] font-medium transition-colors ${
                filtro === f.clave
                  ? 'bg-stats-primary text-stats-primary-fg'
                  : 'border border-stats-border text-stats-muted-fg hover:border-stats-primary hover:text-stats-primary'
              }`}
            >
              {f.etiqueta}
              {f.cantidad !== undefined && <span className="ml-1 opacity-70">{f.cantidad}</span>}
            </button>
          ))}
        </div>

        {buscando && (
          <p className="text-[0.7rem] text-stats-muted-fg">
            {visibles} resultado{visibles === 1 ? '' : 's'}
          </p>
        )}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto p-2">
        <ul className="mb-2 space-y-0.5">
          <li>
            <ItemNav
              activo={vista.tipo === 'estado'}
              onClick={() => onVista({ tipo: 'estado' })}
              icono={<IconoEscudoAlerta size={14} />}
              tono={sinAuth > 0 ? 'peligro' : 'neutro'}
            >
              Estado de la autenticación
            </ItemNav>
          </li>
          <li>
            <ItemNav
              activo={vista.tipo === 'excluidos'}
              onClick={() => onVista({ tipo: 'excluidos' })}
              icono={<IconoCapas size={14} />}
            >
              Fuera del catálogo
            </ItemNav>
          </li>
        </ul>

        {modulos.length === 0 && (
          <p className="px-2 py-4 text-[0.78rem] text-stats-muted-fg">Ningún endpoint coincide con la búsqueda.</p>
        )}

        {modulos.map((m) => {
          const tieneElSeleccionado =
            vista.tipo === 'endpoint' && m.endpoints.some((e) => e.id === vista.id);
          const abierto = buscando || abiertos.has(m.nombre) || tieneElSeleccionado;
          return (
            <div key={m.nombre} className="mb-0.5">
              <button
                type="button"
                onClick={() => alternar(m.nombre)}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-stats-surface-2"
              >
                <span className="text-stats-muted-fg">
                  <IconoChevron size={13} abierto={abierto} />
                </span>
                <span className="min-w-0 flex-1 truncate font-stats-mono text-[0.74rem] font-semibold uppercase tracking-wide text-stats-primary">
                  {m.nombre}
                </span>
                {m.sinAuth > 0 && (
                  <span
                    title={`${m.sinAuth} sin ningún gate`}
                    className="rounded bg-stats-destructive-soft px-1 font-stats-mono text-[0.65rem] font-bold text-stats-destructive"
                  >
                    {m.sinAuth}
                  </span>
                )}
                <span className="font-stats-mono text-[0.65rem] text-stats-muted-fg">{m.endpoints.length}</span>
              </button>

              {abierto && (
                <ul className="ml-2 border-l border-stats-border pl-1">
                  {m.endpoints.map((e) => {
                    const activo = vista.tipo === 'endpoint' && vista.id === e.id;
                    const peligro = esSinAuth(e.op);
                    return (
                      <li key={e.id}>
                        <button
                          type="button"
                          onClick={() => onVista({ tipo: 'endpoint', id: e.id })}
                          title={`${e.metodo.toUpperCase()} ${e.ruta}`}
                          className={`flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors ${
                            activo ? 'bg-stats-info-soft' : 'hover:bg-stats-surface-2'
                          }`}
                        >
                          <ChipMetodo metodo={e.metodo} />
                          <span
                            className={`min-w-0 flex-1 truncate font-stats-mono text-[0.72rem] ${
                              activo ? 'font-semibold text-stats-primary' : 'text-stats-foreground'
                            }`}
                          >
                            {e.ruta.replace(/^\/api\//, '')}
                          </span>
                          {peligro && (
                            <span className="shrink-0 text-stats-destructive" title={badgePrincipal(e.op).detalle}>
                              <IconoAlerta size={12} />
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </div>
  );
}

function ItemNav({
  activo,
  onClick,
  icono,
  tono = 'neutro',
  children,
}: {
  activo: boolean;
  onClick: () => void;
  icono: React.ReactNode;
  tono?: 'peligro' | 'neutro';
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[0.78rem] font-medium transition-colors ${
        activo ? 'bg-stats-info-soft text-stats-primary' : 'text-stats-foreground hover:bg-stats-surface-2'
      }`}
    >
      <span className={tono === 'peligro' ? 'text-stats-destructive' : 'text-stats-muted-fg'}>{icono}</span>
      {children}
    </button>
  );
}
