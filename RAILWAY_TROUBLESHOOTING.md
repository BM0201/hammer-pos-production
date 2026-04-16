# RAILWAY_TROUBLESHOOTING.md

## 1) Error `P1012: Environment variable not found: DATABASE_URL`

Este error indica que Prisma no está recibiendo `DATABASE_URL` en el contexto de deploy.

### Solución rápida
1. En Railway, abre el **servicio web** (no el servicio PostgreSQL).
2. Ve a **Variables**.
3. Asegúrate de tener:
   - `DATABASE_URL` apuntando a la DB de Railway (referencia del servicio PostgreSQL).
   - `AUTH_SESSION_SECRET` con 32+ caracteres.
   - `NODE_ENV=production` y `APP_ENV=production`.
4. Guarda y ejecuta **Redeploy**.

> No uses `localhost` ni `127.0.0.1` en `DATABASE_URL` dentro de Railway.

---

## 2) Verificar que PostgreSQL esté conectado en Railway

Checklist:
- Existe un servicio **PostgreSQL** dentro del mismo proyecto Railway.
- El servicio PostgreSQL está en estado **Running**.
- El servicio web referencia variables del servicio PostgreSQL en `DATABASE_URL`.
- El `preDeployCommand` ejecuta `npm run railway:migrate` y ya no falla por variable ausente.

Si falla por conexión, revisa logs de pre-deploy y confirma que no haya timeouts de red o base apagada.

---

## 3) Verificar que las variables estén disponibles en deploy

1. En Railway > servicio web > Variables, confirma que existan las claves requeridas.
2. Si usas referencias entre servicios, vuelve a guardar las variables tras crear PostgreSQL.
3. Lanza un nuevo deploy y revisa el bloque **Pre-deploy command**.
4. Debes ver logs del script `scripts/railway-migrate.sh`:
   - validación de `DATABASE_URL`,
   - reintentos de conexión a DB,
   - `prisma migrate deploy` exitoso.

---

## 4) Si el deployment vuelve a fallar

Sigue este orden:

1. **Build falla por OpenSSL / Prisma**
   - Verifica que se esté usando `Dockerfile` (builder `DOCKERFILE` en `railway.json`).
   - El Dockerfile instala `openssl` y `libc6-compat`.

2. **Pre-deploy falla por DB**
   - Revisa `DATABASE_URL` en Variables del servicio web.
   - Asegura que PostgreSQL exista y esté `Running`.
   - Reintenta deploy (el script ya incorpora reintentos).

3. **Start/healthcheck falla**
   - Verifica logs de runtime (`npm run start:railway`).
   - Confirma respuesta `200` en `/health`.

4. **Último recurso**
   - Redeploy limpio desde el commit más reciente.
   - Si persiste, comparte logs completos de Build + Pre-deploy + Runtime para diagnóstico puntual.
