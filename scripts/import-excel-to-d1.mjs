import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";

const workbookPath = path.resolve("data/spiel-templates.xlsx");
const outputPath = path.resolve("migrations/0002_import_existing_templates.sql");

if (!fs.existsSync(workbookPath)) {
  throw new Error(`Workbook not found: ${workbookPath}`);
}

const workbook = XLSX.readFile(workbookPath);
const sheet = workbook.Sheets.SpielTemplates;
if (!sheet) throw new Error('Worksheet "SpielTemplates" was not found.');

const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
const templates = rows.map((row, index) => {
  const item = row;
  const id = String(item.ID || index + 1);
  const name = String(item.TemplateName || "").trim();
  const spiel = String(item.Spiel || "");
  const rawActive = item.Active;
  const active = !(rawActive === false || String(rawActive).toLowerCase() === "false");
  if (!name || !spiel) return null;
  return { id, name, spiel, active };
}).filter(Boolean);

if (!templates.length) throw new Error("No valid templates found in workbook.");

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const statements = templates.map((t) =>
  `INSERT INTO spiel_templates (id, name, spiel, active) VALUES (${quote(t.id)}, ${quote(t.name)}, ${quote(t.spiel)}, ${t.active ? 1 : 0}) ON CONFLICT(id) DO UPDATE SET name=excluded.name, spiel=excluded.spiel, active=excluded.active;`
);

fs.writeFileSync(outputPath, `-- Imported from data/spiel-templates.xlsx; generated ${new Date().toISOString()}\n${statements.join("\n")}\n`);
console.log(`Prepared ${templates.length} templates in ${outputPath}`);
console.log("Review this SQL before applying it to production.");
