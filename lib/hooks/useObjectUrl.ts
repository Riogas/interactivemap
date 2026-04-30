import { useEffect, useState } from 'react';

/**
 * Crea un object URL para un Blob/File y lo revoca automáticamente
 * cuando el blob cambia o el componente se desmonta. Evita memory leaks
 * que ocurren al hacer `URL.createObjectURL(blob)` inline en JSX (cada
 * re-render genera un Blob URL nuevo y los anteriores nunca se liberan).
 *
 * @param blob - Blob o File. Si es null/undefined, devuelve null y no
 *               crea ningún object URL.
 * @returns string con la URL del blob o null si no hay blob.
 */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => {
      URL.revokeObjectURL(u);
    };
  }, [blob]);

  return url;
}
