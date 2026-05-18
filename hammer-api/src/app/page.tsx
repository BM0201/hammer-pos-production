/**
 * Root page for the backend. Returns a minimal JSON-like payload identifying
 * the service. The real entry points are the `/api/*` routes and `/health`.
 */
export default function ApiRootPage() {
  return (
    <main style={{ fontFamily: "ui-monospace, monospace", padding: 24 }}>
      <h1>H.A.M.M.E.R. API</h1>
      <p>
        Backend service. See{" "}
        <a href="/health">/health</a> and <a href="/api/auth/csrf">/api/auth/csrf</a>.
      </p>
    </main>
  );
}
