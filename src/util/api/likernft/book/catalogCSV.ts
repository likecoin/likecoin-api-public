// Shared CSV serialization for product-catalog feeds (Meta, OpenAI file-upload).
// Centralizes the security-sensitive escaping so it can't drift between feeds.

// Defang spreadsheet formula injection (CWE-1236): publisher-supplied fields
// (title/description/brand) could start with a formula trigger. The platform
// ingests the value as-is, but an admin opening the downloaded feed in
// Excel/Sheets would otherwise evaluate it. Prefix a single quote per OWASP,
// before the RFC 4180 quoting below so quoted cells are defanged too. Allow for
// leading whitespace before the trigger, since spreadsheet apps trim it before
// evaluating (so " =1+1" is still treated as a formula).
// RFC 4180: wrap a field in double quotes when it contains a comma, quote, or
// line break, and escape embedded quotes by doubling them. Book descriptions
// routinely contain all three, so this keeps columns from shifting.
export function escapeCSVField(value: string | undefined): string {
  if (!value) return '';
  const defanged = /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(defanged) ? `"${defanged.replace(/"/g, '""')}"` : defanged;
}

// Emit a header row in column order followed by one row per item. Items are
// expected to hold string (or undefined) values; absent columns render empty.
export function buildCatalogCSV<T>(columns: Array<keyof T>, items: T[]): string {
  const header = columns.join(',');
  const rows = items.map((item) => columns
    .map((col) => escapeCSVField(item[col] as unknown as string | undefined))
    .join(','));
  return `${header}\n${rows.join('\n')}`;
}
