-- 会员功能：用户会员等级与到期时间
alter table public.app_users add column if not exists member_level text not null default '';
alter table public.app_users add column if not exists member_expire timestamptz;
