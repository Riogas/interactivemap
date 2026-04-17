# Funcionalidades Ocultas — Pendientes de Sistema de Permisos

> **Estado:** Ocultas temporalmente. Deben reactivarse cuando se implemente un sistema de roles/permisos para usuarios.

---

## Elementos ocultos

### 1. Botón "Zonas por Empresa Fletera" (FAB)
- **Archivo:** `app/dashboard/page.tsx`
- **ID:** `tour-fab-fleteras-zonas`
- **Acción:** Abre el modal `FleterasZonasModal` (`setIsFleterasZonasOpen(true)`)
- **Marcador en código:** `TODO: REQUIERE_PERMISO`

### 2. Botón "Ranking de Móviles" (FAB)
- **Archivo:** `app/dashboard/page.tsx`
- **ID:** `tour-fab-ranking`
- **Acción:** Abre el leaderboard (`setIsLeaderboardOpen(true)`)
- **Marcador en código:** `TODO: REQUIERE_PERMISO`

### 3. Botón "Estadísticas" (FAB)
- **Archivo:** `app/dashboard/page.tsx`
- **ID:** `tour-fab-estadisticas`
- **Acción:** Abre `/dashboard/stats?date=...` en nueva pestaña
- **Marcador en código:** `TODO: REQUIERE_PERMISO`

### 4. Sección "Actualizar Puntos de Venta" en Preferencias
- **Archivo:** `components/ui/PreferencesModal.tsx`
- **Acción:** Permite importar/actualizar puntos de venta desde archivo Excel (.xlsx)
- **Marcador en código:** `TODO: REQUIERE_PERMISO`

---

## Cómo reactivar

1. Buscar `TODO: REQUIERE_PERMISO` en el proyecto para localizar los bloques comentados.
2. Descomentar el JSX correspondiente.
3. (Opcional) Envolver con una condición de permiso, por ejemplo:
   ```tsx
   {user?.role === 'admin' && (
     <button ...>...</button>
   )}
   ```

---

## Notas para implementación de permisos

- Se recomienda agregar un campo `role` o `permissions[]` al usuario en Supabase/auth.
- Roles sugeridos: `admin`, `supervisor`, `operador`.
- Las funcionalidades 1–3 serían para `admin` o `supervisor`.
- La funcionalidad 4 ("Puntos de Venta") sería exclusivamente para `admin`.
