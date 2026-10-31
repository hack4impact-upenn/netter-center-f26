// Checks uploaded file names against a format like "{lastname}_{firstname}_{document}.pdf".
// Each {placeholder} matches letters, numbers, and hyphens. Everything else must match
// exactly (ignoring case).

export function formatToRegex(format: string): RegExp {
  const parts = format.split(/(\{[^}]+\})/);
  const pattern = parts
    .map((part) =>
      /^\{[^}]+\}$/.test(part)
        ? "[A-Za-z0-9-]+"
        : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    )
    .join("");
  return new RegExp(`^${pattern}$`, "i");
}

export function isValidFileName(fileName: string, format: string): boolean {
  return formatToRegex(format).test(fileName.trim());
}
