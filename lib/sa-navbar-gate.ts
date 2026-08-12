/**
 * Gate del click del indicador "Ped. sin Asig." del navbar.
 *
 * El indicador se MUESTRA con la funcionalidad 'Ped s/asignar acumulados'
 * (el conteo), pero abrir la vista extendida de pedidos SA requiere además
 * 'Ped s/asignar unitarios' — sin ella, el modal se abría vacío (el gate de
 * unitarios filtra todo su contenido). Si el usuario no puede ver el
 * contenido, el click no debe abrir nada: devolver undefined deja el
 * Indicator inerte (sin handler y con cursor-default).
 */
export function gateNavbarSinAsignarClick(
  canVerSinAsignarUnitario: boolean,
  onClick: (() => void) | undefined,
): (() => void) | undefined {
  return canVerSinAsignarUnitario ? onClick : undefined;
}
