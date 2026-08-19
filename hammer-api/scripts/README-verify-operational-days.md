# verify-operational-days — re-verificación de días cerrados (dry-run)

```bash
npx tsx scripts/verify-operational-days.ts        # últimos 30 días
npx tsx scripts/verify-operational-days.ts 60     # últimos 60 días
```

Recorre los `OperationalDay` **CLOSED** de los últimos N días y recalcula sus
totales con la lógica **corregida** en `fix/dia-operativo-calculos`:

| Métrica | Bug histórico que la afectaba |
|---|---|
| `salesTotal` | La ventana de ventas se derivaba con `businessDateYmd` (zona Managua) sobre un `businessDate` guardado a las 00:00 UTC → todo el resumen usaba la ventana del **día anterior**. |
| `expectedCash` | El vuelto (`changeAmount`) se restaba del esperado **además** de que `tender.amount` ya era el monto aplicado → esperado corto por cada venta con vuelto. |
| `diferencia de caja` | Derivada de las dos anteriores; además `expectedCashTotal` incluía sesiones sin revisar mientras `counted` no. |

Imprime, por día: `businessDate | sucursal | salesTotal guardado → recalculado |
expectedCash guardado → recalculado | diferencia guardada → recalculada | Δ`, y
al final el total de días con discrepancia.

## Qué NO hace

- **No modifica datos, nunca** (dry-run siempre, no hay flag para escribir).
- `closeSummaryJson`, `summaryJson` y las columnas del día son el **snapshot
  inmutable** de lo que se vio y firmó al cierre: se respetan tal cual.

## Para qué sirve

Para **explicar** descuadres históricos ("¿por qué el 05/07 la diferencia fue
−150?" → era el vuelto restado dos veces), no para reescribirlos. Si un cierre
histórico requiere corrección contable, esta se hace como ajuste explícito y
auditado hacia adelante, jamás editando el snapshot del pasado.
