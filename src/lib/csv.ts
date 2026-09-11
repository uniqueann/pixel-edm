export function csvCell(value: unknown) {
  let text = Array.isArray(value) ? value.join("|") : String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function csvRow(values: unknown[]) {
  return `${values.map(csvCell).join(",")}\r\n`;
}
