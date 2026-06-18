type DatabaseSchemaReader = {
  $queryRaw: <T = unknown>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T>;
};

export const REQUIRED_DATABASE_TABLES = [
  "Company",
  "Account",
  "CsvTemplate",
  "ImportBatch",
  "Transaction",
  "Evidence",
  "JournalEntry",
  "JournalLine",
  "Vendor",
  "ClassificationRule",
  "ReviewItem",
  "TaxReport",
  "AuditEvent",
  "ClosingPeriod"
];

export async function inspectDatabaseSchema(db: DatabaseSchemaReader) {
  const rows = await db.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `;
  const existingTables = new Set(rows.map((row) => row.table_name));
  const missingTables = REQUIRED_DATABASE_TABLES.filter((tableName) => !existingTables.has(tableName));

  return {
    ok: missingTables.length === 0,
    requiredTables: REQUIRED_DATABASE_TABLES,
    existingTables: [...existingTables].sort(),
    missingTables
  };
}
