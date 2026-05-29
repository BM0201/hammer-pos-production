# Flujo operativo diario H.A.M.M.E.R. V3

## 1. Abrir dia operativo

Un administrador abre el `OperationalDay` de la sucursal desde Operaciones.

Sin dia operativo abierto:

- No se debe abrir caja.
- No se debe cobrar.
- POS/pagos deben mostrar error operativo claro.

## 2. Abrir caja

El cajero selecciona la caja fisica y abre `CashSession` con monto inicial.

Estados esperados:

- `OPEN`: caja lista para cobrar.
- Sin caja abierta: pagos bloqueados.

## 3. Vender y cobrar

El vendedor/cajero usa POS:

1. Busca producto.
2. Agrega producto al ticket.
3. Envia orden a caja.
4. Caja cobra con una `CashSession OPEN`.

Si la caja esta cerrada o no existe, el pago debe bloquearse.

## 4. Auto-cierre por horario

El cron revisa cada 5 minutos si corresponde cerrar cajas abiertas.

Horarios:

- Lunes a viernes despues de 17:20 America/Managua.
- Sabado despues de 16:00 America/Managua.
- Domingo no auto-cierra.

Cuando aplica:

- `CashSession` pasa a `AUTO_CLOSED_PENDING_REVIEW`.
- No se asigna conteo fisico automatico.
- No se permite cobrar con esa sesion.
- Brain crea alerta de revision.

## 5. Revisar caja auto-cerrada

Admin/cajero autorizado registra:

- Monto contado real.
- Nota obligatoria.

El sistema calcula diferencia, marca revision y cierra la sesion.

## 6. Cerrar caja manual

Si no hubo auto-cierre:

1. Cajero solicita cierre.
2. Sistema pasa a conciliacion.
3. Cajero registra monto contado.
4. Si diferencia excede umbral, se crea aprobacion.
5. Si cuadra o esta dentro de umbral, caja queda `CLOSED`.

## 7. Cerrar dia operativo

Admin cierra `OperationalDay` cuando:

- No hay cajas abiertas.
- No hay cajas auto-cerradas pendientes.
- No hay bloqueantes operativos.

Si hay advertencias, cerrar con nota. Si hay bloqueantes, solo MASTER puede forzar cierre con responsabilidad explicita.

## 8. Revisar Brain

Antes de finalizar jornada:

- Revisar decisiones `OPEN` y `MANUAL_REVIEW`.
- Confirmar alertas de caja auto-cerrada.
- Marcar decisiones ejecutadas o descartadas segun corresponda.

## Resumen de estados criticos

- Dia abierto: `OperationalDay OPEN`.
- Dia cerrado: `OperationalDay CLOSED`.
- Caja abierta: `CashSession OPEN`.
- Caja cerrada: `CashSession CLOSED`.
- Caja auto-cerrada: `AUTO_CLOSED_PENDING_REVIEW`.
- Brain en revision: `MANUAL_REVIEW`.
- Brain ejecutado: `EXECUTED`.
