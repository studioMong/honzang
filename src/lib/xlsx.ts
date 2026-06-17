import { createZipBytes, type ZipFile } from "@/lib/zip";

export type XlsxSheet = {
  name: string;
  rows: Array<Record<string, string | number>>;
};

export function createXlsxBlob(sheets: XlsxSheet[]) {
  return new Blob([createXlsxBytes(sheets)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function createXlsxBytes(sheets: XlsxSheet[]) {
  return createZipBytes(buildXlsxFiles(sheets));
}

function buildXlsxFiles(sheets: XlsxSheet[]): ZipFile[] {
  const safeSheets = normalizeSheets(sheets);
  return [
    { path: "[Content_Types].xml", content: buildContentTypes(safeSheets.length) },
    { path: "_rels/.rels", content: buildRootRelationships() },
    { path: "docProps/app.xml", content: buildAppProperties(safeSheets) },
    { path: "docProps/core.xml", content: buildCoreProperties() },
    { path: "xl/workbook.xml", content: buildWorkbook(safeSheets) },
    { path: "xl/_rels/workbook.xml.rels", content: buildWorkbookRelationships(safeSheets.length) },
    ...safeSheets.map((sheet, index) => ({
      path: `xl/worksheets/sheet${index + 1}.xml`,
      content: buildWorksheet(sheet.rows)
    }))
  ];
}

function normalizeSheets(sheets: XlsxSheet[]) {
  const usedNames = new Set<string>();
  const normalized = sheets.length > 0 ? sheets : [{ name: "신고자료", rows: [] }];
  return normalized.map((sheet, index) => ({
    name: uniqueSheetName(cleanSheetName(sheet.name) || `Sheet${index + 1}`, usedNames),
    rows: sheet.rows
  }));
}

function buildContentTypes(sheetCount: number) {
  const sheetOverrides = Array.from({ length: sheetCount }, (_, index) => {
    const sheetNumber = index + 1;
    return `<Override PartName="/xl/worksheets/sheet${sheetNumber}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
  }).join("");

  return xml(
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
      `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      sheetOverrides +
      `</Types>`
  );
}

function buildRootRelationships() {
  return xml(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
      `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>` +
      `</Relationships>`
  );
}

function buildAppProperties(sheets: Array<{ name: string; rows: Array<Record<string, string | number>> }>) {
  const sheetNames = sheets.map((sheet) => `<vt:lpstr>${escapeXml(sheet.name)}</vt:lpstr>`).join("");
  return xml(
    `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">` +
      `<Application>혼자장부</Application>` +
      `<DocSecurity>0</DocSecurity>` +
      `<ScaleCrop>false</ScaleCrop>` +
      `<HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>${sheets.length}</vt:i4></vt:variant></vt:vector></HeadingPairs>` +
      `<TitlesOfParts><vt:vector size="${sheets.length}" baseType="lpstr">${sheetNames}</vt:vector></TitlesOfParts>` +
      `</Properties>`
  );
}

function buildCoreProperties() {
  const now = new Date().toISOString();
  return xml(
    `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
      `<dc:creator>혼자장부</dc:creator>` +
      `<cp:lastModifiedBy>혼자장부</cp:lastModifiedBy>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>` +
      `<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>` +
      `</cp:coreProperties>`
  );
}

function buildWorkbook(sheets: Array<{ name: string; rows: Array<Record<string, string | number>> }>) {
  const sheetXml = sheets
    .map((sheet, index) => `<sheet name="${escapeXmlAttribute(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join("");
  return xml(
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets>${sheetXml}</sheets>` +
      `</workbook>`
  );
}

function buildWorkbookRelationships(sheetCount: number) {
  const relationships = Array.from({ length: sheetCount }, (_, index) => {
    const sheetNumber = index + 1;
    return `<Relationship Id="rId${sheetNumber}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheetNumber}.xml"/>`;
  }).join("");
  return xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`);
}

function buildWorksheet(rows: Array<Record<string, string | number>>) {
  const normalizedRows = normalizeRows(rows);
  const rowXml = normalizedRows
    .map((row, rowIndex) => {
      const cells = row.map((value, columnIndex) => buildCell(value, rowIndex + 1, columnIndex + 1)).join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");

  return xml(
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<sheetData>${rowXml}</sheetData>` +
      `</worksheet>`
  );
}

function normalizeRows(rows: Array<Record<string, string | number>>) {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : ["내용"];
  const body = rows.length > 0 ? rows.map((row) => headers.map((header) => row[header] ?? "")) : [["데이터 없음"]];
  return [headers, ...body];
}

function buildCell(value: string | number, row: number, column: number) {
  const reference = `${columnName(column)}${row}`;
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${reference}"><v>${value}</v></c>`;
  }
  return `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(String(value ?? ""))}</t></is></c>`;
}

function columnName(column: number) {
  let value = column;
  let name = "";
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function cleanSheetName(name: string) {
  return name.replace(/[\[\]:*?/\\]/g, " ").trim().slice(0, 31);
}

function uniqueSheetName(name: string, usedNames: Set<string>) {
  let candidate = name.slice(0, 31);
  let index = 2;
  while (usedNames.has(candidate)) {
    const suffix = ` ${index}`;
    candidate = `${name.slice(0, 31 - suffix.length)}${suffix}`;
    index += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

function xml(content: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${content}`;
}

function escapeXml(value: string) {
  return value.replace(/[<>&'"]/g, (character) => {
    const escapes: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      "'": "&apos;",
      "\"": "&quot;"
    };
    return escapes[character];
  });
}

function escapeXmlAttribute(value: string) {
  return escapeXml(value);
}
