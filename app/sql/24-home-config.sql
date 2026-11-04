-- 24：首页展示配置（后台可改服务保障条、板块标题、客服联系方式）
-- 结构：{"trust":[{icon,title,desc,on}...],"goodsTitle":"","goodsSub":"","contentTitle":"","support":{wechat,phone,note}}

alter table public.app_settings
  add column if not exists home jsonb not null default '{}'::jsonb;

-- 保存外观配置：在原基础上支持 p_settings->'home'（整块覆盖，null 表示不改）
CREATE OR REPLACE FUNCTION public.app_admin_save_settings(p_secret text, p_settings jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_row jsonb;
  v_action text;
  v_reg boolean;
BEGIN
  IF NOT _svc_ok(p_secret) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  v_action := COALESCE(p_settings->>'icon_action', 'keep');
  v_reg := CASE
    WHEN p_settings->>'enable_register' IS NULL THEN NULL
    ELSE (p_settings->>'enable_register') = 'true'
  END;

  UPDATE app_settings SET
    app_name = COALESCE(NULLIF(btrim(p_settings->>'app_name'), ''), app_settings.app_name),
    tagline = COALESCE(p_settings->>'tagline', app_settings.tagline),
    notice = COALESCE(p_settings->>'notice', app_settings.notice),
    enable_register = COALESCE(v_reg, app_settings.enable_register),
    show_mock = COALESCE((p_settings->>'show_mock')::boolean, app_settings.show_mock),
    show_balance = COALESCE((p_settings->>'show_balance')::boolean, app_settings.show_balance),
    home = CASE
      WHEN p_settings ? 'home' THEN COALESCE(p_settings->'home', '{}'::jsonb)
      ELSE app_settings.home
    END,
    icon_mime = CASE v_action WHEN 'set' THEN p_settings->>'icon_mime' WHEN 'clear' THEN NULL ELSE app_settings.icon_mime END,
    icon_data = CASE v_action WHEN 'set' THEN p_settings->>'icon_data' WHEN 'clear' THEN NULL ELSE app_settings.icon_data END,
    icon_thumb = CASE v_action WHEN 'set' THEN p_settings->>'icon_thumb' WHEN 'clear' THEN NULL ELSE app_settings.icon_thumb END,
    icon_ver = CASE v_action WHEN 'set' THEN p_settings->>'icon_ver' WHEN 'clear' THEN NULL ELSE app_settings.icon_ver END,
    updated_at = now()
  WHERE id = 1
  RETURNING to_jsonb(app_settings.*) INTO v_row;

  IF NOT FOUND THEN
    INSERT INTO app_settings (id, app_name, tagline, notice, enable_register, show_mock, show_balance, home, updated_at)
    VALUES (
      1,
      COALESCE(NULLIF(btrim(p_settings->>'app_name'), ''), '我的应用'),
      COALESCE(p_settings->>'tagline', ''),
      COALESCE(p_settings->>'notice', ''),
      COALESCE(v_reg, true),
      COALESCE((p_settings->>'show_mock')::boolean, true),
      COALESCE((p_settings->>'show_balance')::boolean, true),
      COALESCE(p_settings->'home', '{}'::jsonb),
      now()
    )
    RETURNING to_jsonb(app_settings.*) INTO v_row;
  END IF;

  RETURN v_row - 'icon_data' - 'icon_thumb';
END
$function$;
