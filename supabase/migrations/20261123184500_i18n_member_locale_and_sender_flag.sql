-- i18n P0-a 底座：为成员表增加语言偏好列、自定义署名标志位，以及保存语言偏好的安全 RPC。

alter table edm.members
  add column if not exists locale text check (locale is null or locale in ('zh-CN', 'en')),
  add column if not exists display_name_customized boolean not null default false;

-- 回填既有数据：非默认“店主”且非空的成员视为已自定义对外署名。
update edm.members
set display_name_customized = true
where btrim(display_name) <> ''
  and btrim(display_name) <> '店主';

-- 由触发器自动维护 display_name_customized，避免向 authenticated 暴露直接修改标志位的列权限。
create or replace function edm_private.sync_member_display_name_customized()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  normalized text := btrim(coalesce(new.display_name, ''));
begin
  if tg_op = 'INSERT' then
    if normalized <> '' and normalized <> '店主' then
      new.display_name_customized := true;
    end if;
    return new;
  end if;

  if new.display_name is distinct from old.display_name then
    new.display_name_customized := (normalized <> '' and normalized <> '店主');
  end if;
  return new;
end;
$$;

drop trigger if exists sync_member_display_name_customized on edm.members;
create trigger sync_member_display_name_customized
  before insert or update of display_name on edm.members
  for each row
  execute function edm_private.sync_member_display_name_customized();

create or replace function edm_private.set_member_locale(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  next_locale text := btrim(coalesce(payload->>'locale', ''));
  saved_locale text;
begin
  if uid is null then
    raise exception '需要登录' using errcode = '42501';
  end if;

  if next_locale not in ('zh-CN', 'en') then
    raise exception '不支持的语言选项' using errcode = '22023';
  end if;

  update edm.members
  set locale = next_locale,
      updated_at = now()
  where user_id = uid
    and status = 'active'
  returning locale into saved_locale;

  if saved_locale is null then
    raise exception '当前账号不可用，无法保存语言偏好' using errcode = '42501';
  end if;

  return jsonb_build_object('locale', saved_locale);
end;
$$;

create or replace function edm.set_member_locale(payload jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select edm_private.set_member_locale(payload);
$$;

revoke all on function
  edm_private.sync_member_display_name_customized(),
  edm_private.set_member_locale(jsonb),
  edm.set_member_locale(jsonb)
from public, anon, authenticated;

grant execute on function
  edm_private.set_member_locale(jsonb),
  edm.set_member_locale(jsonb)
to authenticated;

do $$ begin
  if exists(select 1 from pg_roles where rolname = 'aigc_api') then
    revoke all on function
      edm_private.sync_member_display_name_customized(),
      edm_private.set_member_locale(jsonb),
      edm.set_member_locale(jsonb)
    from aigc_api;
  end if;
end $$;
