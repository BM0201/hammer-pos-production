import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { parseInventoryImportPayload } from '../../src/modules/inventory/import-service';

test('parse CSV with alternate ERP headers', async () => {
  const csv = [
    'Grupo de productos,Producto,Qty.,Cost price,Base imponible,Total',
    'Ferreteria,Tornillo M8,5,12.5,62.5,75',
  ].join('\n');

  const result = await parseInventoryImportPayload({ fileContent: csv, fileName: 'import.csv' });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.name, 'Tornillo M8');
  assert.equal(result.rows[0]?.quantity, 5);
  assert.equal(result.rows[0]?.unitCost, 12.5);
  assert.equal(result.blocksExecution, false);
});

test('block catalog-like files with all zero quantities and costs', async () => {
  const csv = [
    'Producto,Qty.,Cost price',
    'A,0,0',
    'B,0,0',
  ].join('\n');

  const result = await parseInventoryImportPayload({ fileContent: csv, fileName: 'catalog.csv' });

  assert.equal(result.blocksExecution, true);
  assert.ok(result.globalWarnings.includes('100% de las cantidades vienen en 0.'));
  assert.ok(result.globalWarnings.includes('100% de los costos vienen en 0.'));
  assert.ok(result.globalWarnings.includes('El archivo parece catálogo, no inventario.'));
});

test('parse XLSX payload path', async () => {
  const script = String.raw`
import base64, io, zipfile
buf = io.BytesIO()
with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>')
    z.writestr('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
    z.writestr('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>')
    z.writestr('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>')
    strings = ['Producto','Qty.','Cost price','Arandela','2','5.40']
    z.writestr('xl/sharedStrings.xml', '<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="6" uniqueCount="6">' + ''.join(f'<si><t>{s}</t></si>' for s in strings) + '</sst>')
    z.writestr('xl/worksheets/sheet1.xml', '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row><row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="C2" t="s"><v>5</v></c></row></sheetData></worksheet>')
print(base64.b64encode(buf.getvalue()).decode())
`;

  const base64 = execFileSync('python3', ['-c', script], { encoding: 'utf8' }).trim();
  const result = await parseInventoryImportPayload({ fileBase64: base64, fileName: 'import.xlsx' });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.quantity, 2);
  assert.equal(result.rows[0]?.unitCost, 5.4);
});
