import { parse } from "csv-parse/sync";

export const MAX_CSV_BYTES = 64 * 1024;
export const MAX_CSV_NAMES = 100;

function folderName(first: string, last: string) {
  const forbidden = /[\x00-\x1f\x7f_/\\]/;
  if (forbidden.test(first) || forbidden.test(last)) return null;
  const firstName = first.trim().replace(/\s+/g, " ");
  const lastName = last.trim().replace(/\s+/g, " ");
  if (!firstName || !lastName) return null;

  const name = `${lastName}_${firstName}`.toUpperCase().normalize("NFC");
  return [...name].length <= 255 ? name : null;
}

export function manualStudentFolderName(fullName: string) {
  const name = fullName.trim();
  const separator = name.lastIndexOf(" ");
  return separator < 0
    ? null
    : folderName(name.slice(0, separator), name.slice(separator + 1));
}

export function csvStudentFolderNames(
  csv: string
): { names: string[] } | { error: string } {
  let rows: string[][];
  try {
    rows = parse(csv, {
      bom: true,
      trim: true,
      skip_empty_lines: true,
      relax_column_count: true,
    });
  } catch {
    return {
      error:
        "Upload a valid CSV with first names in column A and last names in column B.",
    };
  }

  const header = rows[0]?.map((value) => value.toLowerCase().replace(/[ _]/g, ""));
  const hasHeader =
    header?.length === 2 && header[0] === "firstname" && header[1] === "lastname";
  const studentRows = hasHeader ? rows.slice(1) : rows;
  if (!studentRows.length || studentRows.length > MAX_CSV_NAMES) {
    return { error: `The CSV must contain between 1 and ${MAX_CSV_NAMES} names.` };
  }

  const names = [];
  for (const [index, row] of studentRows.entries()) {
    const [first, last] = row;
    const name =
      row.length === 2 &&
      first !== undefined &&
      last !== undefined &&
      folderName(first, last);
    if (!name)
      return { error: `Invalid name or column count in student row ${index + 1}.` };
    names.push(name);
  }
  return { names };
}
