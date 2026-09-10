import { writeFile } from "node:fs/promises";
import { createDatabase } from "../tests/database-helper.mjs";
const db = await createDatabase();
try {
  const { rows } = await db.query(
    "select table_name,column_name,data_type,is_nullable,column_default from information_schema.columns where table_schema='edm' order by table_name,ordinal_position",
  );
  const tables = Object.groupBy(rows, (r) => r.table_name);
  const type = (r) =>
    (r.data_type === "jsonb"
      ? "Json"
      : r.data_type === "boolean"
        ? "boolean"
        : ["integer", "numeric"].includes(r.data_type)
          ? "number"
          : "string") + (r.is_nullable === "YES" ? " | null" : "");
  const definitions = Object.entries(tables)
    .map(
      ([name, cols]) =>
        `${name}: { Row: {${cols.map((r) => `${r.column_name}: ${type(r)}`).join(";")}}; Insert: {${cols.map((r) => `${r.column_name}${r.column_default || r.is_nullable === "YES" ? "?" : ""}: ${type(r)}`).join(";")}}; Update: {${cols.map((r) => `${r.column_name}?: ${type(r)}`).join(";")}}; Relationships: [] }`,
    )
    .join(";\n");
  await writeFile(
    "src/lib/supabase/database.types.ts",
    `// 由迁移对应的数据库结构生成，请运行 npm run db:types 更新。\ntype Json = string | number | boolean | null | { [key:string]: Json | undefined } | Json[];\nexport type Database = { edm: { Tables: { ${definitions} }; Views: Record<string,never>; Functions: { initialize_member: { Args: Record<string,never>; Returns: string }; save_contact: { Args: {payload:Json}; Returns:string }; archive_contact: { Args: {payload:Json}; Returns:string }; list_contacts: { Args: {payload:Json}; Returns:Json }; prepare_contact_import: { Args: {payload:Json}; Returns:Json }; confirm_contact_import: { Args: {payload:Json}; Returns:Json }; process_contact_import_batch: { Args: {payload:Json}; Returns:Json }; get_contact_import: { Args: {payload:Json}; Returns:Json }; list_contact_imports: { Args: {payload:Json}; Returns:Json }; export_contact_import: { Args: {payload:Json}; Returns:Json }; unsubscribe_contact: { Args: {payload:Json}; Returns:string }; save_template: { Args: {payload:Json}; Returns:string }; duplicate_template: { Args: {payload:Json}; Returns:string }; set_template_archived: { Args: {payload:Json}; Returns:string }; list_templates: { Args: {payload:Json}; Returns:Json }; list_activity_logs: { Args: {payload:Json}; Returns:Json } }; Enums: Record<string,never>; CompositeTypes: Record<string,never> } };\n`,
  );
} finally {
  await db.close();
}
