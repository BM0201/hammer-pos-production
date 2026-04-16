# 🔑 Credenciales de bootstrap — H.A.M.M.E.R.

> **Fuente real:** `prisma/seed.ts`
>
> **Contraseña bootstrap actual (testing):** `admin123`

---

## Diagnóstico del bug (resumen)

Se detectó que en `seed.ts` el `upsert` de usuarios **no actualizaba `passwordHash`** en registros existentes.

Eso provocaba que:
- El documento mostrara contraseñas nuevas
- Pero la base de datos conservara hashes viejos
- Resultado: login fallido con credenciales "correctas" en papel

✅ Ya quedó corregido en el seed y además se agregó script de reseteo.

---

## Contraseña simple y funcional (seed actual)

Todos los usuarios bootstrap usan esta contraseña:

- `admin123`

---

## Usuarios globales

| Username | Rol global | Contraseña |
|---|---|---|
| `propietario` | OWNER | `admin123` |
| `master` | MASTER | `admin123` |

---

## Usuarios por sucursal

### Sucursal Managua (MGA)

| Username | Rol | Contraseña |
|---|---|---|
| `supervisor.mga` | BRANCH_ADMIN | `admin123` |
| `vendedor.mga` | SALES | `admin123` |
| `caja.mga` | CASHIER | `admin123` |
| `bodega.mga` | WAREHOUSE | `admin123` |

### Sucursal Masaya (MSY)

| Username | Rol | Contraseña |
|---|---|---|
| `supervisor.msy` | BRANCH_ADMIN | `admin123` |
| `vendedor.msy` | SALES | `admin123` |
| `caja.msy` | CASHIER | `admin123` |
| `bodega.msy` | WAREHOUSE | `admin123` |

### Sucursal Rivas (RIV)

| Username | Rol | Contraseña |
|---|---|---|
| `supervisor.riv` | BRANCH_ADMIN | `admin123` |
| `vendedor.riv` | SALES | `admin123` |
| `caja.riv` | CASHIER | `admin123` |
| `bodega.riv` | WAREHOUSE | `admin123` |

---

## Cómo aplicar el fix en una BD existente

### Opción A (reseed completo)

```bash
npm run prisma:migrate:deploy
npm run seed
```

### Opción B (reset de passwords sin reseed)

```bash
npm run password:reset:bootstrap
```

También puedes pasar una contraseña custom:

```bash
npm run password:reset:bootstrap -- miPasswordTemporal123
```

---

## Total usuarios bootstrap: 14

- 2 globales (`propietario`, `master`)
- 12 de sucursal (4 por cada una de las 3 sucursales)
