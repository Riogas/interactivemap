/**
 * Iconografía del portal `/docs`: SVG inline, trazo de 2, `currentColor`.
 *
 * Nada de emojis como iconos — igual que en el resto de la app (ver CardShell,
 * FiltersBar, etc.). Al heredar el color del texto, funcionan igual en tema claro y
 * oscuro sin ninguna regla extra.
 */

interface PropsIcono {
  className?: string;
  /** Lado del cuadrado, en píxeles. */
  size?: number;
}

function Svg({ className = '', size = 16, children }: PropsIcono & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconoBuscar = (p: PropsIcono) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Svg>
);

export const IconoCerrar = (p: PropsIcono) => (
  <Svg {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);

export const IconoMenu = (p: PropsIcono) => (
  <Svg {...p}>
    <path d="M3 6h18M3 12h18M3 18h18" />
  </Svg>
);

export const IconoLibro = (p: PropsIcono) => (
  <Svg {...p}>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </Svg>
);

export const IconoEscudo = (p: PropsIcono) => (
  <Svg {...p}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </Svg>
);

export const IconoEscudoAlerta = (p: PropsIcono) => (
  <Svg {...p}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="M12 8v4" />
    <path d="M12 16h.01" />
  </Svg>
);

export const IconoAlerta = (p: PropsIcono) => (
  <Svg {...p}>
    <path d="M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </Svg>
);

export const IconoLlave = (p: PropsIcono) => (
  <Svg {...p}>
    <circle cx="7.5" cy="15.5" r="4.5" />
    <path d="m10.7 12.3 8.3-8.3 3 3-3 3-2-2" />
  </Svg>
);

export const IconoCandado = (p: PropsIcono) => (
  <Svg {...p}>
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </Svg>
);

export const IconoCopiar = (p: PropsIcono) => (
  <Svg {...p}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </Svg>
);

export const IconoCheck = (p: PropsIcono) => (
  <Svg {...p}>
    <path d="m20 6-11 11-5-5" />
  </Svg>
);

export const IconoPlay = (p: PropsIcono) => (
  <Svg {...p}>
    <path d="M6 4.5v15l13-7.5-13-7.5z" />
  </Svg>
);

export const IconoChevron = ({ abierto = false, ...p }: PropsIcono & { abierto?: boolean }) => (
  <Svg {...p} className={`${p.className ?? ''} transition-transform ${abierto ? 'rotate-90' : ''}`}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);

export const IconoSol = (p: PropsIcono) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
);

export const IconoLuna = (p: PropsIcono) => (
  <Svg {...p}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </Svg>
);

export const IconoArchivo = (p: PropsIcono) => (
  <Svg {...p}>
    <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
    <path d="M14 2v5h5" />
    <path d="M9 13h6M9 17h4" />
  </Svg>
);

export const IconoEnchufe = (p: PropsIcono) => (
  <Svg {...p}>
    <path d="M9 2v6M15 2v6" />
    <path d="M5 8h14v3a7 7 0 0 1-7 7 7 7 0 0 1-7-7z" />
    <path d="M12 18v4" />
  </Svg>
);

export const IconoReloj = (p: PropsIcono) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);

export const IconoInfo = (p: PropsIcono) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" />
    <path d="M12 8h.01" />
  </Svg>
);

export const IconoCodigo = (p: PropsIcono) => (
  <Svg {...p}>
    <path d="m8 6-6 6 6 6" />
    <path d="m16 6 6 6-6 6" />
  </Svg>
);

export const IconoUsuarios = (p: PropsIcono) => (
  <Svg {...p}>
    <path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 20v-2a4 4 0 0 0-3-3.9" />
  </Svg>
);

export const IconoCapas = (p: PropsIcono) => (
  <Svg {...p}>
    <path d="m12 2 9 5-9 5-9-5 9-5z" />
    <path d="m3 12 9 5 9-5" />
    <path d="m3 17 9 5 9-5" />
  </Svg>
);
