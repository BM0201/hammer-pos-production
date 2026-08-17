/**
 * Construcción de mensajes SOAP para el subconjunto de ONVIF que este
 * agente necesita (adenda §1): WS-Discovery Probe, GetDeviceInformation,
 * GetProfiles, GetStreamUri. Todo texto — nada nativo, nada de dependencias
 * de compilación de XML.
 *
 * Autenticación: WS-Security UsernameToken con PasswordDigest (el esquema
 * que soporta prácticamente todo equipo ONVIF, incluidos los clones —
 * mismo criterio "universal por diseño" que el resto del módulo).
 */
import { createHash, randomBytes } from "node:crypto";

export type OnvifCredentials = { username: string; password: string };

function passwordDigest(nonceBytes: Buffer, created: string, password: string): string {
  const hash = createHash("sha1");
  hash.update(Buffer.concat([nonceBytes, Buffer.from(created, "utf8"), Buffer.from(password, "utf8")]));
  return hash.digest("base64");
}

/**
 * Encabezado WS-Security. `nowIso` y `nonceBytes` se reciben inyectados
 * (no `new Date()` / `randomBytes()` internos) para que el envelope
 * completo sea determinista y testeable — la aleatoriedad real se inyecta
 * desde el punto de entrada del agente, no desde acá.
 */
export function buildSecurityHeader(creds: OnvifCredentials, nonceBytes: Buffer, nowIso: string): string {
  const digest = passwordDigest(nonceBytes, nowIso, creds.password);
  const nonceB64 = nonceBytes.toString("base64");
  return `<Security xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" s:mustUnderstand="1">
  <UsernameToken>
    <Username>${escapeXml(creds.username)}</Username>
    <Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</Password>
    <Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonceB64}</Nonce>
    <Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">${nowIso}</Created>
  </UsernameToken>
</Security>`;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function envelope(body: string, securityHeader?: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">
${securityHeader ? `<s:Header>${securityHeader}</s:Header>` : ""}
<s:Body>${body}</s:Body>
</s:Envelope>`;
}

/** WS-Discovery Probe — UDP multicast, sin autenticación. */
export function buildProbeMessage(messageId: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery">
<e:Header>
  <w:MessageID>uuid:${messageId}</w:MessageID>
  <w:To e:mustUnderstand="1">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>
  <w:Action e:mustUnderstand="1">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>
</e:Header>
<e:Body>
  <d:Probe>
    <d:Types>dn:NetworkVideoTransmitter</d:Types>
  </d:Probe>
</e:Body>
</e:Envelope>`;
}

export function buildGetDeviceInformationRequest(creds: OnvifCredentials, nonceBytes: Buffer, nowIso: string): string {
  return envelope(
    `<GetDeviceInformation xmlns="http://www.onvif.org/ver10/device/wsdl"/>`,
    buildSecurityHeader(creds, nonceBytes, nowIso),
  );
}

export function buildGetProfilesRequest(creds: OnvifCredentials, nonceBytes: Buffer, nowIso: string): string {
  return envelope(
    `<GetProfiles xmlns="http://www.onvif.org/ver10/media/wsdl"/>`,
    buildSecurityHeader(creds, nonceBytes, nowIso),
  );
}

export function buildGetStreamUriRequest(profileToken: string, creds: OnvifCredentials, nonceBytes: Buffer, nowIso: string): string {
  return envelope(
    `<GetStreamUri xmlns="http://www.onvif.org/ver10/media/wsdl">
  <StreamSetup>
    <Stream xmlns="http://www.onvif.org/ver10/schema">RTP-Unicast</Stream>
    <Transport xmlns="http://www.onvif.org/ver10/schema"><Protocol>RTSP</Protocol></Transport>
  </StreamSetup>
  <ProfileToken>${escapeXml(profileToken)}</ProfileToken>
</GetStreamUri>`,
    buildSecurityHeader(creds, nonceBytes, nowIso),
  );
}
