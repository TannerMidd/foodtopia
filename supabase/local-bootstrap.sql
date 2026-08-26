-- Local Docker bootstrap: allow signups so the stack is usable immediately.
update public.beta_signup_settings
set signups_open = true,
    updated_at = now();
