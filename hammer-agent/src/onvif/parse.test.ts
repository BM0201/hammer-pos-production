import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseProbeMatches,
  parseGetDeviceInformationResponse,
  parseGetProfilesResponse,
  parseGetStreamUriResponse,
  isSoapFault,
} from "./parse.ts";

describe("parseProbeMatches", () => {
  it("parsea dos ProbeMatch de marcas distintas de la misma respuesta multicast", () => {
    const xml = `<?xml version="1.0"?>
<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery">
<e:Body><d:ProbeMatches>
  <d:ProbeMatch>
    <d:Types>dn:NetworkVideoTransmitter</d:Types>
    <d:Scopes>onvif://www.onvif.org/hardware/DS-2CD2 onvif://www.onvif.org/location/branch-msy</d:Scopes>
    <d:XAddrs>http://192.168.1.10/onvif/device_service</d:XAddrs>
  </d:ProbeMatch>
  <d:ProbeMatch>
    <d:Types>dn:NetworkVideoTransmitter</d:Types>
    <d:Scopes>onvif://www.onvif.org/hardware/IPC-HDW</d:Scopes>
    <d:XAddrs>http://192.168.1.11:8080/onvif/device_service</d:XAddrs>
  </d:ProbeMatch>
</d:ProbeMatches></e:Body>
</e:Envelope>`;
    const matches = parseProbeMatches(xml);
    assert.equal(matches.length, 2);
    assert.equal(matches[0].xAddrs[0], "http://192.168.1.10/onvif/device_service");
    assert.ok(matches[0].scopes.some((s) => s.includes("DS-2CD2")));
    assert.equal(matches[1].xAddrs[0], "http://192.168.1.11:8080/onvif/device_service");
  });

  it("sin ProbeMatch (red sin equipos que contesten) -> lista vacía, no error", () => {
    const xml = `<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope"><e:Body><d:ProbeMatches xmlns:d="x"/></e:Body></e:Envelope>`;
    assert.deepEqual(parseProbeMatches(xml), []);
  });
});

describe("parseGetDeviceInformationResponse", () => {
  it("parsea marca, modelo y firmware con prefijo de namespace tds:", () => {
    const xml = `<?xml version="1.0"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl">
<SOAP-ENV:Body>
  <tds:GetDeviceInformationResponse>
    <tds:Manufacturer>Hikvision</tds:Manufacturer>
    <tds:Model>DS-2CD2143G0-I</tds:Model>
    <tds:FirmwareVersion>V5.7.3</tds:FirmwareVersion>
    <tds:SerialNumber>DS-2CD2-000001</tds:SerialNumber>
    <tds:HardwareId>88</tds:HardwareId>
  </tds:GetDeviceInformationResponse>
</SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;
    const info = parseGetDeviceInformationResponse(xml);
    assert.deepEqual(info, {
      manufacturer: "Hikvision",
      model: "DS-2CD2143G0-I",
      firmwareVersion: "V5.7.3",
      serialNumber: "DS-2CD2-000001",
      hardwareId: "88",
    });
  });

  it("un clon sin namespace también se parsea (tolerante a prefijo)", () => {
    const xml = `<Envelope><Body><GetDeviceInformationResponse>
      <Manufacturer>GenericCam</Manufacturer><Model>X1</Model>
      <FirmwareVersion>1.0</FirmwareVersion><SerialNumber>SN1</SerialNumber><HardwareId>HW1</HardwareId>
    </GetDeviceInformationResponse></Body></Envelope>`;
    const info = parseGetDeviceInformationResponse(xml);
    assert.equal(info.manufacturer, "GenericCam");
  });

  it("respuesta incompleta -> error claro, no un objeto a medias", () => {
    const xml = `<Body><GetDeviceInformationResponse><Manufacturer>X</Manufacturer></GetDeviceInformationResponse></Body>`;
    assert.throws(() => parseGetDeviceInformationResponse(xml), /ONVIF_PARSE_ERROR.*Model/);
  });
});

describe("parseGetProfilesResponse", () => {
  it("parsea múltiples perfiles con su token y nombre", () => {
    const xml = `<Body><trt:GetProfilesResponse xmlns:trt="http://www.onvif.org/ver10/media/wsdl">
      <trt:Profiles token="Profile_1" fixed="true">
        <tt:Name xmlns:tt="x">MainStream</tt:Name>
      </trt:Profiles>
      <trt:Profiles token="Profile_2">
        <tt:Name xmlns:tt="x">SubStream</tt:Name>
      </trt:Profiles>
    </trt:GetProfilesResponse></Body>`;
    const profiles = parseGetProfilesResponse(xml);
    assert.deepEqual(profiles, [
      { token: "Profile_1", name: "MainStream" },
      { token: "Profile_2", name: "SubStream" },
    ]);
  });

  it("sin perfiles -> error (un equipo ONVIF sin perfiles es un caso anómalo, no silencioso)", () => {
    const xml = `<Body><GetProfilesResponse/></Body>`;
    assert.throws(() => parseGetProfilesResponse(xml), /ONVIF_PARSE_ERROR/);
  });
});

describe("parseGetStreamUriResponse", () => {
  it("parsea la URI RTSP", () => {
    const xml = `<Body><trt:GetStreamUriResponse xmlns:trt="x"><trt:MediaUri><tt:Uri xmlns:tt="y">rtsp://192.168.1.10:554/Streaming/Channels/102</tt:Uri></trt:MediaUri></trt:GetStreamUriResponse></Body>`;
    assert.deepEqual(parseGetStreamUriResponse(xml), { uri: "rtsp://192.168.1.10:554/Streaming/Channels/102" });
  });
});

describe("isSoapFault", () => {
  it("detecta un s:Fault (ej. credenciales rechazadas)", () => {
    const xml = `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><s:Fault><s:Code><s:Value>s:Sender</s:Value></s:Code></s:Fault></s:Body></s:Envelope>`;
    assert.equal(isSoapFault(xml), true);
  });

  it("una respuesta normal no es un fault", () => {
    assert.equal(isSoapFault(`<Body><GetProfilesResponse/></Body>`), false);
  });
});
