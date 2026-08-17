import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHash } from "node:crypto";
import {
  buildSecurityHeader,
  buildProbeMessage,
  buildGetDeviceInformationRequest,
  buildGetProfilesRequest,
  buildGetStreamUriRequest,
  escapeXml,
} from "./soap.ts";

const creds = { username: "admin", password: "admin123" };
const nonce = Buffer.from("0123456789abcdef", "utf8");
const created = "2026-01-01T00:00:00.000Z";

// Digest de la especificación WS-Security UsernameToken calculado de forma
// independiente acá (mismo algoritmo documentado, no una copia del código
// de producción): Base64(SHA1(nonce + created + password)).
function expectedDigest() {
  const hash = createHash("sha1");
  hash.update(Buffer.concat([nonce, Buffer.from(created, "utf8"), Buffer.from(creds.password, "utf8")]));
  return hash.digest("base64");
}

describe("buildSecurityHeader", () => {
  it("incluye el digest correcto según la especificación WS-Security", () => {
    const header = buildSecurityHeader(creds, nonce, created);
    assert.ok(header.includes(`>${expectedDigest()}<`), "el header debe contener el PasswordDigest esperado");
  });

  it("incluye el nonce en base64 y el username, sin la contraseña en texto plano", () => {
    const header = buildSecurityHeader(creds, nonce, created);
    assert.ok(header.includes(nonce.toString("base64")));
    assert.ok(header.includes("<Username>admin</Username>"));
    assert.ok(!header.includes("admin123"), "la contraseña en texto plano nunca debe viajar en el XML");
  });

  it("escapa caracteres especiales en el username", () => {
    const header = buildSecurityHeader({ username: "a<b>&\"'", password: "x" }, nonce, created);
    assert.ok(header.includes("a&lt;b&gt;&amp;&quot;&apos;"));
  });
});

describe("escapeXml", () => {
  it("escapa los cinco caracteres especiales de XML", () => {
    assert.equal(escapeXml(`<>&"'`), "&lt;&gt;&amp;&quot;&apos;");
  });
});

describe("buildProbeMessage", () => {
  it("es un WS-Discovery Probe válido con el MessageID inyectado", () => {
    const xml = buildProbeMessage("msg-123");
    assert.ok(xml.includes("uuid:msg-123"));
    assert.ok(xml.includes("<d:Probe>"));
    assert.ok(xml.includes("NetworkVideoTransmitter"));
  });
});

describe("requests autenticados", () => {
  it("GetDeviceInformation trae el header de seguridad y el body correcto", () => {
    const xml = buildGetDeviceInformationRequest(creds, nonce, created);
    assert.ok(xml.includes("<GetDeviceInformation"));
    assert.ok(xml.includes(`>${expectedDigest()}<`));
  });

  it("GetProfiles trae el header de seguridad y el body correcto", () => {
    const xml = buildGetProfilesRequest(creds, nonce, created);
    assert.ok(xml.includes("<GetProfiles"));
  });

  it("GetStreamUri incluye el ProfileToken pedido, escapado", () => {
    const xml = buildGetStreamUriRequest("Profile_1 <raro>", creds, nonce, created);
    assert.ok(xml.includes("<ProfileToken>Profile_1 &lt;raro&gt;</ProfileToken>"));
    assert.ok(xml.includes("RTP-Unicast"));
    assert.ok(xml.includes("<Protocol>RTSP</Protocol>"));
  });
});
