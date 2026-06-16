/**
 * Tipos de entidad compartidos — evita duplicación en componentes.
 */

/** Sucursal mínima (id, code, name). */
export type Branch = {
  id: string;
  code: string;
  name: string;
};

/** Categoría de producto. */
export type Category = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};
