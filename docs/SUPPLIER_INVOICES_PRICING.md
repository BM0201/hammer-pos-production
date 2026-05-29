# IVA de compra, costos y precios

## Criterio operativo

Para cuota fija o negocios donde el IVA de compra no se acredita como credito fiscal recuperable, el IVA pagado al proveedor forma parte del costo real del producto.

Ejemplo:

- Costo sin IVA: C$22.69
- IVA 15%: C$3.40
- Total pagado: C$26.09
- Costo operativo del producto: C$26.09

## Tratamiento de IVA

El sistema usa por defecto:

```txt
purchaseTaxTreatment = "INCLUDE_IN_COST"
```

Valores disponibles:

- `INCLUDE_IN_COST`: el IVA de compra se suma al costo del producto. Es el modo default para cuota fija.
- `SEPARATE_CREDIT`: el IVA se mantiene separado y no se suma al costo. Solo debe usarse si la empresa decide manejar credito fiscal recuperable.

## Costo final unitario

Con `INCLUDE_IN_COST`:

```txt
finalUnitCost =
  unitCostBeforeTax
  + unitTaxAmount
  + allocatedFreightPerUnit
  + allocatedOtherChargesPerUnit
  - allocatedDiscountPerUnit
```

Con `SEPARATE_CREDIT`:

```txt
finalUnitCost =
  unitCostBeforeTax
  + allocatedFreightPerUnit
  + allocatedOtherChargesPerUnit
  - allocatedDiscountPerUnit
```

## Total pagado

El total pagado de la compra se calcula como:

```txt
subtotalBeforeTax
+ taxAmount
+ freightAmount
+ otherChargesAmount
- globalDiscountAmount
```

El sistema muestra el total pagado con IVA y conserva el desglose entre costo sin IVA, IVA, costo con IVA y costo final con flete/otros/descuento.

## Precios

La revision de precios y el margen deben usar `finalUnitCost`, no `unitCostBeforeTax`. En inventario, `unitCost` se mantiene como alias compatible del costo final usado para el movimiento.
