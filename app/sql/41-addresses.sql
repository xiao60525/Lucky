-- 41-addresses.sql
-- 多收货地址：user_addresses 表 + 4 个函数（列表/保存/删除/设默认）
-- 规则：每人最多 20 条；始终保证有且仅有一条默认地址；默认地址同步回 app_users.address
--      （app_users.address 保留给订单快照与老数据，不再由前端直接写）

create table if not exists public.user_addresses (
  id text primary key,
  user_id text not null,
  name text not null default '',
  phone text not null default '',
  region text not null default '',
  detail text not null default '',
  tag text not null default '',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_addresses_user_idx
  on public.user_addresses (user_id, is_default desc, updated_at desc);

create unique index if not exists user_addresses_one_default_idx
  on public.user_addresses (user_id) where is_default;

-- 把默认地址同步到 app_users.address（订单快照仍读这里）
create or replace function public._addr_sync(p_user text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare d record;
begin
  select * into d from user_addresses where user_id = p_user and is_default limit 1;
  if not found then
    select * into d from user_addresses where user_id = p_user order by updated_at desc limit 1;
    if found then
      update user_addresses set is_default = true, updated_at = now() where id = d.id;
      d.is_default := true;
    end if;
  end if;

  if found then
    update app_users
       set address = jsonb_build_object(
             'id', d.id,
             'name', d.name,
             'phone', d.phone,
             'region', d.region,
             'detail', btrim(coalesce(d.region, '') || ' ' || coalesce(d.detail, ''))
           ),
           updated_at = now()
     where id = p_user;
  else
    update app_users set address = '{}'::jsonb, updated_at = now() where id = p_user;
  end if;
end
$function$;

-- 统一返回结构：{ addresses: [...], focusId: '当前编辑的地址' }
create or replace function public._addr_payload(p_user text, p_focus text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v jsonb;
begin
  select coalesce(jsonb_agg(x order by ord, upd desc), '[]'::jsonb) into v
  from (
    select is_default, updated_at as upd,
           case when is_default then 0 else 1 end as ord,
           jsonb_build_object(
             'id', id,
             'name', name,
             'phone', phone,
             'phoneMasked', substr(phone, 1, 3) || '****' || substr(phone, 8, 4),
             'region', region,
             'detail', detail,
             'tag', tag,
             'isDefault', is_default,
             'updatedAt', (extract(epoch from updated_at) * 1000)::bigint
           ) as x
      from user_addresses
     where user_id = p_user
  ) s;

  return jsonb_build_object('addresses', coalesce(v, '[]'::jsonb), 'focusId', coalesce(p_focus, ''));
end
$function$;

-- 列表：老用户第一次进来时把 app_users.address 里的旧地址迁成一条
create or replace function public.app_addr_list(p_secret text, p_user text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  uid text;
  legacy jsonb;
  n int;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  uid := btrim(coalesce(p_user, ''));
  if uid = '' then raise exception 'missing_user'; end if;

  select count(*) into n from user_addresses where user_id = uid;
  if n = 0 then
    select address into legacy from app_users where id = uid;
    if legacy is not null
       and (coalesce(btrim(legacy->>'detail'), '') <> '' or coalesce(btrim(legacy->>'name'), '') <> '') then
      insert into user_addresses (id, user_id, name, phone, region, detail, tag, is_default)
      values (
        'ad_' || substr(md5(random()::text || clock_timestamp()::text), 1, 16),
        uid,
        left(coalesce(btrim(legacy->>'name'), ''), 20),
        left(regexp_replace(coalesce(legacy->>'phone', ''), '[^0-9]', '', 'g'), 11),
        left(coalesce(btrim(legacy->>'region'), ''), 40),
        left(coalesce(btrim(legacy->>'detail'), ''), 120),
        '',
        true
      );
      perform _addr_sync(uid);
    end if;
  end if;

  return _addr_payload(uid, '');
end
$function$;

-- 保存（p_id 为空=新增，否则=编辑）
create or replace function public.app_addr_save(
  p_secret text,
  p_user text,
  p_id text,
  p_name text,
  p_phone text,
  p_region text,
  p_detail text,
  p_tag text,
  p_default boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  uid text;
  aid text;
  nm text;
  ph text;
  rg text;
  dt text;
  tg text;
  cnt int;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  uid := btrim(coalesce(p_user, ''));
  if uid = '' then raise exception 'missing_user'; end if;

  nm := left(btrim(coalesce(p_name, '')), 20);
  ph := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  rg := left(btrim(coalesce(p_region, '')), 40);
  dt := left(btrim(coalesce(p_detail, '')), 120);
  tg := left(btrim(coalesce(p_tag, '')), 6);

  if nm = '' then raise exception 'addr_name_required'; end if;
  if length(ph) <> 11 or ph !~ '^1[3-9]' then raise exception 'addr_phone_bad'; end if;
  if length(dt) < 4 then raise exception 'addr_detail_short'; end if;

  select count(*) into cnt from user_addresses where user_id = uid;
  aid := btrim(coalesce(p_id, ''));

  if aid = '' then
    if cnt >= 20 then raise exception 'addr_too_many'; end if;
    aid := 'ad_' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
    insert into user_addresses (id, user_id, name, phone, region, detail, tag, is_default)
    values (aid, uid, nm, ph, rg, dt, tg, false);
  else
    update user_addresses
       set name = nm, phone = ph, region = rg, detail = dt, tag = tg, updated_at = now()
     where id = aid and user_id = uid;
    if not found then raise exception 'addr_missing'; end if;
  end if;

  if coalesce(p_default, false) or cnt = 0 then
    update user_addresses set is_default = false, updated_at = now()
     where user_id = uid and id <> aid and is_default;
    update user_addresses set is_default = true, updated_at = now() where id = aid;
  end if;

  if not exists (select 1 from user_addresses where user_id = uid and is_default) then
    update user_addresses set is_default = true, updated_at = now()
     where id = (select id from user_addresses where user_id = uid order by updated_at desc limit 1);
  end if;

  perform _addr_sync(uid);
  return _addr_payload(uid, aid);
end
$function$;

-- 删除：删掉默认地址后自动把最近修改的一条提为默认
create or replace function public.app_addr_delete(p_secret text, p_user text, p_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  uid text;
  aid text;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  uid := btrim(coalesce(p_user, ''));
  if uid = '' then raise exception 'missing_user'; end if;
  aid := btrim(coalesce(p_id, ''));
  if aid = '' then raise exception 'addr_missing'; end if;

  delete from user_addresses where id = aid and user_id = uid;
  if not found then raise exception 'addr_missing'; end if;

  perform _addr_sync(uid);
  return _addr_payload(uid, '');
end
$function$;

-- 设为默认
create or replace function public.app_addr_default(p_secret text, p_user text, p_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  uid text;
  aid text;
begin
  if not _svc_ok(p_secret) then raise exception 'unauthorized'; end if;
  uid := btrim(coalesce(p_user, ''));
  if uid = '' then raise exception 'missing_user'; end if;
  aid := btrim(coalesce(p_id, ''));
  if not exists (select 1 from user_addresses where id = aid and user_id = uid) then
    raise exception 'addr_missing';
  end if;

  update user_addresses set is_default = false, updated_at = now()
   where user_id = uid and id <> aid and is_default;
  update user_addresses set is_default = true, updated_at = now() where id = aid;

  perform _addr_sync(uid);
  return _addr_payload(uid, aid);
end
$function$;

grant execute on function public.app_addr_list(text, text) to anon, authenticated;
grant execute on function public.app_addr_save(text, text, text, text, text, text, text, text, boolean) to anon, authenticated;
grant execute on function public.app_addr_delete(text, text, text) to anon, authenticated;
grant execute on function public.app_addr_default(text, text, text) to anon, authenticated;
