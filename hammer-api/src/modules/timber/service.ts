/**
 * Módulo de Madera — índice. Cada archivo es una tarea del flujo:
 *   catalog-link      → a qué producto va cada medida y cómo se le escribe costo/precio
 *   pricing-config    → configuración (global/sucursal) y recálculo por precio por pulgada
 *   branch-cost       → costo por pie fijado por sucursal y existencias en pies
 *   products          → medidas en el catálogo (CRUD + lista)
 *   trips             → viajes: numeración, borrador, cancelar, ver, listar
 *   cubication-import → carga de la cubicación desde Excel (vista previa)
 *   injection         → ingresar el viaje al inventario (vista previa + confirmar)
 *   correction        → corregir un viaje ya ingresado (24 h, por diferencia)
 */
export * from "./catalog-link";
export * from "./pricing-config";
export * from "./branch-cost";
export * from "./products";
export * from "./trips";
export * from "./cubication-import";
export * from "./injection";
export * from "./correction";
