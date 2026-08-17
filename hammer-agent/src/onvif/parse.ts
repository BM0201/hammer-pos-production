/**
 * Parseo de las respuestas ONVIF que este agente necesita. Extractor de
 * XML chico y a mano (regex por tag, tolerante a prefijo de namespace) en
 * vez de una librería de XML completa — el subconjunto de tags que hace
 * falta leer es fijo y conocido (adenda §1: "chico y estable"), y evita
 * sumar una dependencia solo para esto.
 */

function extractTag(xml: string, tagName: string): string | null {
  const re = new RegExp(`<(?:[\\w-]+:)?${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tagName}>`);
  const match = xml.match(re);
  return match ? match[1].trim() : null;
}

function extractAllBlocks(xml: string, tagName: string): string[] {
  const re = new RegExp(`<(?:[\\w-]+:)?${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tagName}>`, "g");
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) blocks.push(match[1]);
  return blocks;
}

function requireTag(xml: string, tagName: string, context: string): string {
  const value = extractTag(xml, tagName);
  if (value === null) throw new Error(`ONVIF_PARSE_ERROR: falta <${tagName}> en ${context}`);
  return value;
}

export type OnvifProbeMatch = {
  xAddrs: string[];
  types: string[];
  scopes: string[];
};

/** Respuesta WS-Discovery a la sonda Probe — uno por equipo que contestó. */
export function parseProbeMatches(xml: string): OnvifProbeMatch[] {
  return extractAllBlocks(xml, "ProbeMatch").map((block) => {
    const xAddrsRaw = extractTag(block, "XAddrs") ?? "";
    const typesRaw = extractTag(block, "Types") ?? "";
    const scopesRaw = extractTag(block, "Scopes") ?? "";
    return {
      xAddrs: xAddrsRaw.split(/\s+/).filter(Boolean),
      types: typesRaw.split(/\s+/).filter(Boolean),
      scopes: scopesRaw.split(/\s+/).filter(Boolean),
    };
  });
}

export type OnvifDeviceInfo = {
  manufacturer: string;
  model: string;
  firmwareVersion: string;
  serialNumber: string;
  hardwareId: string;
};

export function parseGetDeviceInformationResponse(xml: string): OnvifDeviceInfo {
  const context = "GetDeviceInformationResponse";
  return {
    manufacturer: requireTag(xml, "Manufacturer", context),
    model: requireTag(xml, "Model", context),
    firmwareVersion: requireTag(xml, "FirmwareVersion", context),
    serialNumber: requireTag(xml, "SerialNumber", context),
    hardwareId: requireTag(xml, "HardwareId", context),
  };
}

export type OnvifProfile = { token: string; name: string };

export function parseGetProfilesResponse(xml: string): OnvifProfile[] {
  const re = /<(?:[\w-]+:)?Profiles?\b[^>]*token="([^"]+)"[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?Profiles?>/g;
  const profiles: OnvifProfile[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    const [, token, block] = match;
    const name = extractTag(block, "Name") ?? token;
    profiles.push({ token, name });
  }
  if (profiles.length === 0) throw new Error("ONVIF_PARSE_ERROR: GetProfilesResponse sin ningún <Profile>");
  return profiles;
}

export type OnvifStreamUri = { uri: string };

export function parseGetStreamUriResponse(xml: string): OnvifStreamUri {
  const uri = requireTag(xml, "Uri", "GetStreamUriResponse");
  return { uri };
}

/** true si el sobre SOAP es un s:Fault — para diferenciar credenciales malas de equipo caído. */
export function isSoapFault(xml: string): boolean {
  return /<(?:[\w-]+:)?Fault\b/.test(xml);
}
