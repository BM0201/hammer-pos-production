# H.A.M.M.E.R. — Checklist de Pruebas V2 (15 tests mínimos)

Datos base: ejecutar `npm run seed` (sucursal **Masaya MSY** en modo **HYBRID**,
usuarios `vendedor`, `cajero`, `vendedor-cajero`, `admin-sucursal`, caja **Caja Principal Masaya**).

> Pruebas automatizadas existentes: `cd hammer-api && npm test` (75 pruebas, incluye
> `branch-workflow.test.ts`, `policies.test.ts`, `unit-conversion.test.ts`).

| # | Caso | Pasos | Resultado esperado | Estado |
|---|------|-------|--------------------|:------:|
| 1 | Vendedor crea venta y la envía a caja | Login `vendedor` → POS → agregar productos → **Enviar a caja** | Orden pasa DRAFT → PENDING_PAYMENT; **no** registra pago | ⬜ |
| 2 | Vendedor sin permiso no puede cobrar | Login `vendedor` → POS | Botón **"Cobrar aquí"** oculto/deshabilitado | ⬜ |
| 3 | Vendedor-cajero cobra directo con sesión asignada | Abrir caja, asignar `vendedor-cajero` como operador → POS → **Cobrar aquí** | Registra `Payment` + `PaymentTender`, descuenta inventario, estado PAID | ⬜ |
| 4 | Cajero cobra orden pendiente | Login `cajero` → Cola de cobros → seleccionar orden → cobrar | Orden pasa a PAID; pago ligado a la sesión | ⬜ |
| 5 | Dos vendedores envían a la misma caja | `vendedor` y otro SALES envían órdenes a MSY | Ambas órdenes aparecen en la cola de la misma caja | ⬜ |
| 6 | Dos operadores cobran en la misma sesión | Asignar 2 operadores a la sesión → ambos cobran | Ambos pagos registrados en la misma `CashSession`, cada uno con su `createdByUserId` | ⬜ |
| 7 | Usuario desactivado no cierra la caja | Desactivar un operador (User.isActive=false) | La `CashSession` sigue OPEN | ⬜ |
| 8 | Operador revocado no puede cobrar | Revocar `CashSessionOperator` (revokedAt/isActive=false) | Intento de cobro rechazado para ese usuario | ⬜ |
| 9 | Pago efectivo calcula vuelto | Cobrar efectivo con `receivedAmount` > total | `changeAmount` = recibido − total | ⬜ |
| 10 | Pago mixto crea PaymentTender por método | Cobrar parte efectivo + parte tarjeta | Un `Payment` con varios `PaymentTender` (CASH, CARD) | ⬜ |
| 11 | Cierre calcula esperado correcto | Cerrar caja tras pagos y movimientos | `expectedCash = opening + cash tenders + cashMovements(+/-) − change` | ⬜ |
| 12 | HYBRID permite ambas acciones | MSY (HYBRID), usuario con ambos permisos | POS muestra **Enviar a caja** y **Cobrar aquí** | ⬜ |
| 13 | QUEUE_ONLY bloquea cobro directo | Config MSY `paymentWorkflowMode=QUEUE_ONLY` | "Cobrar aquí" bloqueado; solo "Enviar a caja" | ⬜ |
| 14 | DIRECT_ONLY bloquea envío a caja | Config `paymentWorkflowMode=DIRECT_ONLY` | "Enviar a caja" bloqueado; solo "Cobrar aquí" | ⬜ |
| 15 | Hierro: venta de varilla descuenta del quintal | Vender `VARILLA HIERRO 3/8` | Stock se descuenta del grupo compartido `HIERRO_3_8` (base = varilla; 1 quintal = 14 varillas) | ⬜ |
| 16 | P0 Fusión: stock separado por sucursal | Crear fusión `KILO CLAVO ACERO 2"` + `CLAVO ACERO 2" UD.` con factor `1 KILO = 216 UNIDADES`; cargar MGA=0 kilo, MSY=6 kilo, RIV=0 kilo; revisar MSY/MGA/RIV; vender 1 unidad en MSY; intentar vender 1 unidad en MGA; transferir 1 kilo MSY→MGA; vender 1 unidad en MGA | MSY muestra 6 kilo cerrados, 0 unidad suelta y 1296 unidades equivalentes; MGA/RIV muestran 0; la venta en MSY abre solo stock de MSY y deja 5 kilo cerrados + 215 unidades sueltas; MGA bloquea venta sin stock; transferencia mueve cerrado entre sucursales; venta en MGA puede abrir solo stock de MGA; reportes Master agregan, POS usa solo sucursal activa | ⬜ |

## Cómo correr las pruebas automatizadas

```bash
cd hammer-api
export DATABASE_URL="postgresql://...:5432/db"
export DIRECT_URL="$DATABASE_URL"
npm test            # casos 12/13/14 cubiertos por branch-workflow.test.ts
                    # caso 15 (conversión) cubierto por unit-conversion.test.ts
                    # RBAC (casos 2,3,4) cubierto por policies.test.ts
```

## Verificación de datos del seed (SQL)

> **Nota (Corrección 3):** la categoría **Hierro** y los productos de hierro NO los crea el seed;
> se crean manualmente en producción. Las siguientes consultas de hierro solo aplican DESPUÉS de
> haber creado la categoría en `/app/master` y agrupado con `bootstrap-iron`.

```sql
-- Sembrado por el seed (siempre):
SELECT "paymentWorkflowMode" FROM "BranchModuleConfig" b
  JOIN "Branch" br ON b."branchId"=br.id WHERE br.code='MSY';        -- HYBRID

-- Solo tras la creación manual de Hierro (no lo crea el seed):
SELECT count(*) FROM "Category" WHERE code='HIERRO';                 -- 1 (manual)
SELECT count(*) FROM "ProductStockGroup" WHERE code LIKE 'HIERRO%';  -- 3 (tras bootstrap-iron)
```
