# Guía de Gestión de Personal y Nómina

## Descripción General

El módulo de gestión de personal permite administrar empleados, calcular nóminas con prorrateo automático y sincronizar los costos de nómina con los gastos operativos para un cálculo de precios más preciso.

## Cómo Agregar Empleados

1. Navegar a **Master → Gobernanza → Personal & Nómina**
2. Click en **"Agregar Empleado"**
3. Llenar los campos:
   - **Nombre completo**: Nombre legal del empleado
   - **Puesto**: Supervisor, Vendedor, Cajero, Bodeguero, Administrador, Auxiliar
   - **Sucursal**: Seleccionar la sucursal asignada
   - **Salario mensual**: Monto en Córdobas
   - **Fecha de inicio**: Primer día laboral
4. Click en **"Crear empleado"**

## Cómo Calcular Nómina

1. Ir al tab **"Calcular Nómina"**
2. Seleccionar el mes (formato YYYY-MM)
3. Opcionalmente filtrar por sucursal
4. Click en **"Calcular y Sincronizar"**

El sistema calculará automáticamente:
- Días trabajados por cada empleado en el mes
- Salario prorrateado proporcional a los días
- Total de nómina por sucursal

## Fórmula de Prorrateo

```
Salario Prorrateado = (Salario Mensual ÷ Días del Mes) × Días Trabajados
```

### Ejemplo
- Empleado entra el día 15 de un mes de 31 días
- Salario mensual: C$10,000
- Días trabajados: 31 - 15 + 1 = 17 días
- Prorrateo: (10,000 ÷ 31) × 17 = **C$5,483.87**

## Impacto en Precios

Al sincronizar la nómina con gastos operativos:
1. Se crean registros de gasto con categoría **PAYROLL** automáticamente
2. Estos gastos se incluyen en el cálculo de precios sugeridos
3. Los gastos de nómina auto-calculados aparecen como **read-only** en el módulo de gastos

## Desactivar Empleados

Cuando un empleado deja la empresa:
1. Click en el botón de **desactivar** (icono de usuario con X)
2. Se registra automáticamente la fecha de finalización
3. El empleado queda marcado como "Inactivo"
4. En futuros cálculos de nómina, se prorratea hasta la fecha de finalización

## Historial

El tab **"Historial"** muestra todos los registros de nómina generados, incluyendo:
- Mes de cálculo
- Días trabajados vs días totales
- Salario completo vs prorrateado

## API Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/employees` | Listar empleados |
| POST | `/api/employees` | Crear empleado |
| GET | `/api/employees/:id` | Detalle de empleado |
| PUT | `/api/employees/:id` | Actualizar empleado |
| DELETE | `/api/employees/:id` | Desactivar empleado |
| POST | `/api/payroll/calculate` | Calcular nómina |
| GET | `/api/payroll/history` | Historial de nómina |
