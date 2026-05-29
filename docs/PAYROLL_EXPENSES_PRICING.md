# Personal, Gastos y Precios

Este documento fija el criterio operativo para conectar Personal/Nomina, Gastos Operativos y Calculadora de Precios sin mezclar conceptos contables.

## Nomina y gastos operativos

- La nomina bruta/costo empresa alimenta gastos operativos de categoria `PAYROLL`.
- Cada gasto `PAYROLL` automatico corresponde a un empleado y a un mes especifico.
- La vigencia del gasto automatico inicia el primer dia del mes y termina el ultimo dia del mismo mes.
- Gastos `PAYROLL` manuales no deben registrarse desde Gastos Operativos porque pueden duplicar costos si tambien se sincroniza Personal/Nomina.

## PayrollRun

La nomina formal usa el flujo:

1. `DRAFT`: se calcula la nomina del periodo y se generan `PayrollLine` por empleado.
2. `POSTED`: se confirma la nomina, se aplican deducciones de prestamos y se sincroniza `OperatingExpense` de nomina.

Postear una nomina ya posteada no debe duplicar deducciones ni gastos automaticos. El modo correcto de sincronizar gastos es postear la nomina, no ejecutar seed ni build.

## Prestamos, adelantos y deducciones

- Prestamos y adelantos a empleados se registran como `EmployeeLoan`.
- Un prestamo a empleado representa una cuenta por cobrar o una deduccion futura, no un mayor costo operativo del mes.
- Las cuotas descontadas se registran como `EmployeeLoanInstallment` al postear nomina.
- Payroll neto = salario bruto - deducciones de prestamos - otras deducciones.
- El costo usado para precios debe basarse en salario bruto/costo patronal, no en el neto despues de prestamos.

## Precios

- La calculadora de precios debe usar `OperatingExpense` de nomina automatica posteada.
- Las deducciones por prestamos no reducen el costo de producto.
- Los prestamos no se suman ni se restan como gasto operativo.

## Reportes

Los reportes exportables incluyen:

- Nomina: bruto, deducciones, neto y costo empresa por periodo.
- Prestamos empleados: monto original, saldo pendiente, cuota, estado y notas.
