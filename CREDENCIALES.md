# 🔑 Credenciales de Usuarios de Prueba — H.A.M.M.E.R.

> **Fuente:** [`prisma/seed.ts`](prisma/seed.ts)  
> **Contraseña por defecto para TODOS los usuarios:** `ChangeMeNow!`  
> *(Definida en la línea 227 del seed)*

---

### Usuario Global (MASTER)

| Username | Contraseña | Rol Global | Sucursal | Email | Descripción |
|----------|------------|------------|----------|-------|-------------|
| `master` | `ChangeMeNow!` | **MASTER** | — (todas) | master@hammer.local | Administrador global del sistema |

---

### Usuarios por Sucursal

Cada sucursal tiene 4 usuarios con roles específicos. **Todos comparten la misma contraseña: `ChangeMeNow!`**

#### 🏢 Sucursal Managua (MGA)

| Username | Rol en Sucursal | Email | Descripción |
|----------|----------------|-------|-------------|
| `supervisor.mga` | BRANCH_ADMIN | supervisor.mga@hammer.local | Administrador de sucursal |
| `vendedor.mga` | SALES | vendedor.mga@hammer.local | Vendedor |
| `caja.mga` | CASHIER | caja.mga@hammer.local | Cajero |
| `bodega.mga` | WAREHOUSE | bodega.mga@hammer.local | Bodeguero |

#### 🏢 Sucursal Masaya (MSY)

| Username | Rol en Sucursal | Email | Descripción |
|----------|----------------|-------|-------------|
| `supervisor.msy` | BRANCH_ADMIN | supervisor.msy@hammer.local | Administrador de sucursal |
| `vendedor.msy` | SALES | vendedor.msy@hammer.local | Vendedor |
| `caja.msy` | CASHIER | caja.msy@hammer.local | Cajero |
| `bodega.msy` | WAREHOUSE | bodega.msy@hammer.local | Bodeguero |

#### 🏢 Sucursal Rivas (RIV)

| Username | Rol en Sucursal | Email | Descripción |
|----------|----------------|-------|-------------|
| `supervisor.riv` | BRANCH_ADMIN | supervisor.riv@hammer.local | Administrador de sucursal |
| `vendedor.riv` | SALES | vendedor.riv@hammer.local | Vendedor |
| `caja.riv` | CASHIER | caja.riv@hammer.local | Cajero |
| `bodega.riv` | WAREHOUSE | bodega.riv@hammer.local | Bodeguero |

---

### Resumen Rápido de Roles

| Rol | Código | Permisos principales |
|-----|--------|---------------------|
| **MASTER** | `MASTER` | Acceso total al sistema, gestión global, módulo de madera |
| **Branch Admin** | `BRANCH_ADMIN` | Administración de una sucursal específica |
| **Sales** | `SALES` | Ventas y gestión de pedidos |
| **Cashier** | `CASHIER` | Caja, cobros y pagos |
| **Warehouse** | `WAREHOUSE` | Gestión de inventario y bodega |

---

### Credenciales E2E (Playwright)

Definidas en `.env.example` para pruebas automatizadas:

| Variable | Valor |
|----------|-------|
| `E2E_ADMIN_USERNAME` | `supervisor.mga` |
| `E2E_ADMIN_PASSWORD` | `ChangeMeNow!123` |
| `E2E_CASHIER_USERNAME` | `caja.mga` |
| `E2E_CASHIER_PASSWORD` | `ChangeMeNow!123` |

> ⚠️ **Nota:** Las contraseñas E2E (`.env.example`) muestran `ChangeMeNow!123`, pero el seed real usa `ChangeMeNow!` (sin el "123"). Usa la contraseña del seed (`ChangeMeNow!`) para iniciar sesión en la aplicación.

---

### Cómo Cambiar Contraseñas

1. **Modificar el seed** — Editar la línea 227 en `prisma/seed.ts`:
   ```ts
   const defaultPasswordHash = hashPassword("TuNuevaContraseña");
   ```
2. **Re-ejecutar el seed** para actualizar los usuarios:
   ```bash
   npx prisma db seed
   ```
3. **Para cambio individual en producción**, usar la función `hashPassword()` del módulo `src/modules/auth/password.ts` y actualizar directamente en la base de datos.

---

### Total de Usuarios: **13**

- 1 usuario MASTER global
- 12 usuarios de sucursal (4 por cada una de las 3 sucursales)
