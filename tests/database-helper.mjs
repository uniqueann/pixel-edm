import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
export async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create role aigc_api;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
    $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    create schema aigc;
    create table aigc.members(user_id uuid primary key references auth.users, status text default 'active');
    grant usage on schema aigc to aigc_api;
    grant select on aigc.members to aigc_api;
    alter table aigc.members enable row level security;
    create policy member_self on aigc.members to aigc_api using(user_id=nullif(current_setting('aigc.user_id',true),'')::uuid);
  `);
  for (const file of (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  }
  return db;
}
export async function asUser(db, user, sql, role = "authenticated") {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
      user ?? "",
    ]);
    return tx.query(sql);
  });
}
