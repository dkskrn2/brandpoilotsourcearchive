alter table brand_profiles
  add column if not exists logo_url text null,
  add column if not exists logo_storage_path text null;

