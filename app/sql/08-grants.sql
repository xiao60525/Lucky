grant execute on function public.app_list_contents(text) to anon, authenticated;
grant execute on function public.app_admin_list_contents(text) to anon, authenticated;
grant execute on function public.app_admin_upsert_content(text, jsonb) to anon, authenticated;
grant execute on function public.app_admin_delete_content(text, text) to anon, authenticated
