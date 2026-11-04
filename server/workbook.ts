
import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
import type { SpielTemplate } from "./types.js";

const DATA_DIR = path.resolve(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "spiel-templates.xlsx");
const SHEET = "SpielTemplates";

function ensure(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (fs.existsSync(FILE)) return;

  const wb = XLSX.utils.book_new();

  const ws = XLSX.utils.aoa_to_sheet([
    ["ID", "TemplateName", "Spiel", "Active"],
    [
      "1",
      "Coffeehouse - No Shot",
      "Called the coffeehouse at {{TIME}} to verify the request class, description, and photo. The machine has power but freezes and is unable to do anything, causing no shots to be pulled.",
      true
    ],
    [
      "2",
      "Espresso Machine - No Shot",
      "Called the store at {{TIME}} to verify the espresso machine issue. The machine is powered on but frozen and unable to pull shots.",
      true
    ],
    [
      "3",
      "General Store Follow-up",
      "Called the store at {{TIME}} to verify the reported issue and confirm the next steps.",
      true
    ]
  ]);

  XLSX.utils.book_append_sheet(wb, ws, SHEET);

  XLSX.writeFile(wb, FILE, {
    bookType: "xlsx"
  });
}

function read(): SpielTemplate[] {
  ensure();

  const wb = XLSX.readFile(FILE);
  const ws = wb.Sheets[SHEET];

  if (!ws) {
    throw new Error(`Missing worksheet ${SHEET}`);
  }

  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: ""
  }).map((r, i) => ({
    id: String(r.ID || i + 1),
    name: String(r.TemplateName || "").trim(),
    spiel: String(r.Spiel || ""),
    active: !(
      r.Active === false ||
      String(r.Active).toLowerCase() === "false"
    )
  })).filter(x => x.name && x.spiel);
}

/**
 * Safely writes the workbook.
 *
 * SheetJS requires an explicit bookType when the temporary
 * filename does not end in .xlsx.
 */
function write(items: SpielTemplate[]): void {
  ensure();

  const wb = XLSX.utils.book_new();

  const rows = items.map(x => ({
    ID: x.id,
    TemplateName: x.name,
    Spiel: x.spiel,
    Active: x.active
  }));

  const ws = XLSX.utils.json_to_sheet(rows, {
    header: ["ID", "TemplateName", "Spiel", "Active"]
  });

  ws["!cols"] = [
    { wch: 12 },
    { wch: 34 },
    { wch: 110 },
    { wch: 12 }
  ];

  XLSX.utils.book_append_sheet(wb, ws, SHEET);

  const tmp = `${FILE}.tmp`;

  try {
    XLSX.writeFile(wb, tmp, {
      bookType: "xlsx"
    });

    // Verify that the temporary workbook was created.
    if (!fs.existsSync(tmp) || fs.statSync(tmp).size === 0) {
      throw new Error("Temporary Excel workbook was not created.");
    }

    // Replace the original workbook only after successful writing.
    fs.renameSync(tmp, FILE);
  } catch (error) {
    // Remove temporary file if the operation fails.
    if (fs.existsSync(tmp)) {
      fs.unlinkSync(tmp);
    }

    throw error;
  }
}

export const workbookStore = {
  listPublic() {
    return read()
      .filter(x => x.active)
      .map(({ id, name }) => ({ id, name }));
  },

  getPublic(id: string) {
    return read().find(x => x.id === id && x.active) || null;
  },

  listAdmin() {
    return read();
  },

  save(input: {
    id?: string;
    name: string;
    spiel: string;
    active: boolean;
  }) {
    const items = read();

    if (input.id) {
      const i = items.findIndex(x => x.id === input.id);

      if (i < 0) return null;

      items[i] = {
        id: input.id,
        name: input.name,
        spiel: input.spiel,
        active: input.active
      };

      write(items);

      return items[i];
    }

    const id = String(
      Math.max(0, ...items.map(x => Number(x.id) || 0)) + 1
    );

    const item: SpielTemplate = {
      id,
      name: input.name,
      spiel: input.spiel,
      active: input.active
    };

    items.push(item);

    write(items);

    return item;
  },

  delete(id: string) {
    const items = read();

    const next = items.filter(x => x.id !== id);

    if (next.length === items.length) {
      return false;
    }

    write(next);

    return true;
  }
};
