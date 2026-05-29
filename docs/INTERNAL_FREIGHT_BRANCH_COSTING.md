# Flete interno por sucursal

## Conceptos

- Flete de proveedor: costo escondido o incluido en el precio de compra del proveedor. No se registra aparte si el proveedor no lo cobra separado.
- Flete interno: costo propio de trasladar mercaderia entre sucursales, por ejemplo Managua Principal -> Rivas.
- Flete al cliente: transporte cobrado o gestionado en la venta. No debe mezclarse con el costo de abastecimiento interno.

## Formula de combustible

```txt
fuelCost = route.roundTripKm / truck.fuelEfficiencyKmPerGallon * fuelPricePerGallon
```

Si el viaje no tiene camion o no tiene rendimiento configurado, el costo de combustible se puede ingresar manualmente.

## Formula de mantenimiento

```txt
maintenanceCost = route.roundTripKm * truck.maintenanceCostPerKm
```

## Costo total del viaje

```txt
totalTripCost =
  fuelCost
  + maintenanceCost
  + driverCost
  + helperCost
  + otherCost
```

## Metodos de reparto

### BY_VALUE

Reparte el costo del viaje proporcionalmente al valor de cada linea:

```txt
lineShare = lineValue / totalValue
allocatedFreight = totalTripCost * lineShare
allocatedFreightPerUnit = allocatedFreight / quantity
```

### BY_QUANTITY

Reparte por cantidad:

```txt
allocatedFreightPerUnit = totalTripCost / totalQuantity
allocatedFreight = allocatedFreightPerUnit * quantity
```

### MANUAL

Permite asignar flete manual por linea. La suma debe cuadrar con `totalTripCost`.

## Ejemplo Managua -> Rivas

- Ruta ida/vuelta: 230 km
- Camion: 25 km/galon
- Combustible: C$160/galon
- Mantenimiento: C$4/km

```txt
fuelCost = 230 / 25 * 160 = C$1,472
maintenanceCost = 230 * 4 = C$920
totalTripCost = C$2,392 + conductor/ayudante/otros
```

Ese total se reparte entre los productos trasladados y se suma al costo por unidad de la sucursal destino.

## Efecto en costo por sucursal

Al aplicar un viaje:

```txt
newBranchCost = baseCost + allocatedFreightPerUnit
```

El valor se guarda en `BranchProductSetting.branchCost` para la sucursal destino. El viaje no mueve inventario; la transferencia ya controla salida y entrada de stock.

## Precios

El sistema crea historial de `ProductPricing` con el costo resultante para revision. No aplica precio automaticamente. MASTER debe revisar/aprobar cambios comerciales.

## Excepciones

No se aplica flete interno automatico a madera (`isTimber`). Servicios, manufacturados y materias primas deben tratarse segun configuracion futura si se agregan tipos de producto dedicados.
