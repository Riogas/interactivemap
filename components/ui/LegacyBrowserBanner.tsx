'use client';

import { useEffect, useState } from 'react';
import { detectLegacyBrowser, MIN_CHROME_VERSION } from '@/lib/browser-compat';

const DISMISS_KEY = 'trackmovil_legacy_banner_dismissed';

/**
 * Aviso amigable para navegadores / SO viejos (Chrome < 111, Windows < 10).
 *
 * Estos entornos no soportan oklch() (Tailwind v4) y la app se ve rota
 * (botones invisibles, etc.). globals.css ya aplica fallbacks de color via
 * `@supports not (color: oklch(...))`; este banner ADEMAS le explica al usuario
 * que su navegador es muy viejo y le recomienda actualizar.
 *
 * Estilos inline con hex (no Tailwind oklch) para que el propio banner se vea
 * bien justamente en los navegadores que no soportan oklch.
 */
export default function LegacyBrowserBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === '1') return;
    } catch {
      /* sessionStorage no disponible → mostrar igual */
    }
    if (detectLegacyBrowser().isLegacy) setShow(true);
  }, []);

  if (!show) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* noop */
    }
    setShow(false);
  };

  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100000,
        background: '#b45309',
        color: '#ffffff',
        borderBottom: '2px solid #78350f',
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: '13px',
        lineHeight: 1.4,
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
      }}
    >
      <span style={{ fontSize: '20px', flexShrink: 0 }} aria-hidden>⚠️</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>Tu navegador o sistema operativo es muy antiguo.</strong>{' '}
        Es posible que la aplicación no se vea ni funcione correctamente (botones e
        íconos pueden no mostrarse bien). Te recomendamos actualizar a{' '}
        <strong>Google Chrome {MIN_CHROME_VERSION} o superior</strong> y, de ser
        posible, a <strong>Windows 10 o superior</strong>.
      </div>
      <button
        type="button"
        onClick={dismiss}
        style={{
          flexShrink: 0,
          background: '#ffffff',
          color: '#b45309',
          border: '1px solid #78350f',
          borderRadius: '6px',
          padding: '5px 12px',
          fontWeight: 700,
          fontSize: '12px',
          cursor: 'pointer',
        }}
      >
        Entendido
      </button>
    </div>
  );
}
