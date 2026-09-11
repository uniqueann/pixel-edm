import { writeFile } from "node:fs/promises";
import { createDatabase } from "../tests/database-helper.mjs";

const db = await createDatabase();
try {
  const { rows } = await db.query(
    "select table_name,column_name,data_type,is_nullable,column_default from information_schema.columns where table_schema='edm' order by table_name,ordinal_position",
  );
  const tables = Object.groupBy(rows, (row) => row.table_name);
  const type = (row) =>
    (row.data_type === "jsonb"
      ? "Json"
      : row.data_type === "boolean"
        ? "boolean"
        : ["integer", "numeric"].includes(row.data_type)
          ? "number"
          : "string") + (row.is_nullable === "YES" ? " | null" : "");
  const definitions = Object.entries(tables)
    .map(
      ([name, columns]) =>
        `${name}: { Row: {${columns.map((row) => `${row.column_name}: ${type(row)}`).join(";")}}; Insert: {${columns.map((row) => `${row.column_name}${row.column_default || row.is_nullable === "YES" ? "?" : ""}: ${type(row)}`).join(";")}}; Update: {${columns.map((row) => `${row.column_name}?: ${type(row)}`).join(";")}}; Relationships: [] }`,
    )
    .join(";\n");
  const functions = [
    "initialize_member: { Args: Record<string,never>; Returns: string }",
    "save_contact: { Args: {payload:Json}; Returns:string }",
    "archive_contact: { Args: {payload:Json}; Returns:string }",
    "list_contacts: { Args: {payload:Json}; Returns:Json }",
    "prepare_contact_import: { Args: {payload:Json}; Returns:Json }",
    "confirm_contact_import: { Args: {payload:Json}; Returns:Json }",
    "process_contact_import_batch: { Args: {payload:Json}; Returns:Json }",
    "get_contact_import: { Args: {payload:Json}; Returns:Json }",
    "list_contact_imports: { Args: {payload:Json}; Returns:Json }",
    "export_contact_import: { Args: {payload:Json}; Returns:Json }",
    "unsubscribe_contact: { Args: {payload:Json}; Returns:string }",
    "save_template: { Args: {payload:Json}; Returns:string }",
    "duplicate_template: { Args: {payload:Json}; Returns:string }",
    "set_template_archived: { Args: {payload:Json}; Returns:string }",
    "list_templates: { Args: {payload:Json}; Returns:Json }",
    "list_activity_logs: { Args: {payload:Json}; Returns:Json }",
    "list_campaigns: { Args: {payload:Json}; Returns:Json }",
    "get_campaign: { Args: {payload:Json}; Returns:Json }",
    "get_campaign_preview: { Args: {payload:Json}; Returns:Json }",
    "confirm_campaign: { Args: {payload:Json}; Returns:Json }",
    "duplicate_confirmed_campaign: { Args: {payload:Json}; Returns:string }",
    "get_campaign_export_chunk: { Args: {payload:Json}; Returns:Json }",
    "save_campaign: { Args: {payload:Json}; Returns:string }",
    "set_campaign_archived: { Args: {payload:Json}; Returns:string }",
    "get_campaign_editor_options: { Args: {payload:Json}; Returns:Json }",
    "get_delivery_channel: { Args: {payload:Json}; Returns:Json }",
    "save_delivery_channel: { Args: {payload:Json}; Returns:Json }",
    "disconnect_delivery_channel: { Args: {payload:Json}; Returns:Json }",
    "prepare_delivery_test: { Args: {payload:Json}; Returns:Json }",
    "get_delivery_test_summary: { Args: {payload:Json}; Returns:Json }",
  ].join(";");
  await writeFile(
    "src/lib/supabase/database.types.ts",
    `// 由迁移对应的数据库结构生成，请运行 npm run db:types 更新。\ntype Json = string | number | boolean | null | { [key:string]: Json | undefined } | Json[];\nexport type Database = { edm: { Tables: { ${definitions} }; Views: Record<string,never>; Functions: { ${functions} }; Enums: Record<string,never>; CompositeTypes: Record<string,never> } };\n`,
  );
} finally {
  await db.close();
}
