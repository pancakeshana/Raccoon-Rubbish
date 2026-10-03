# Shared Advice Wall Setup

The page uses the same-origin Vercel function at `/api/advice`. Supabase stores the notes. The browser never receives the Supabase service-role key; it is only used by the API function.

## Create the Supabase Tables

In the Supabase SQL Editor, run:

```sql
create table public.advice_notes (
  id uuid primary key default gen_random_uuid(),
  text text not null check (char_length(btrim(text)) between 1 and 280),
  author text not null check (char_length(author) <= 40),
  color text not null check (color in ('#FEF08A', '#BAE6FD', '#BBF7D0', '#FBCFE8', '#E9D5FF')),
  date date not null,
  created_at timestamptz not null default now()
);

alter table public.advice_notes enable row level security;
revoke all on table public.advice_notes from public, anon, authenticated;
grant select, insert on table public.advice_notes to service_role;
create index advice_notes_created_at_idx on public.advice_notes (created_at desc);

create table public.advice_rate_limits (
  ip_hash text not null,
  window_start timestamptz not null,
  submission_count integer not null default 1,
  primary key (ip_hash, window_start)
);

alter table public.advice_rate_limits enable row level security;
revoke all on table public.advice_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.advice_rate_limits to service_role;
create index advice_rate_limits_window_idx on public.advice_rate_limits (window_start);

create or replace function public.consume_advice_rate_limit(p_ip_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  bucket_start timestamptz := date_trunc('minute', now());
  current_count integer;
begin
  insert into public.advice_rate_limits (ip_hash, window_start, submission_count)
  values (p_ip_hash, bucket_start, 1)
  on conflict (ip_hash, window_start)
  do update set submission_count = public.advice_rate_limits.submission_count + 1
  returning submission_count into current_count;

  delete from public.advice_rate_limits
  where window_start < bucket_start - interval '2 minutes';

  return current_count <= 10;
end;
$function$;

revoke all on function public.consume_advice_rate_limit(text) from public, anon, authenticated;
grant execute on function public.consume_advice_rate_limit(text) to service_role;
```

RLS is enabled and anonymous/authenticated browser roles receive no table permissions. The service-role key bypasses RLS, so keep it in Vercel environment variables only; never place it in HTML or frontend JavaScript.

## Configure Turnstile

Create a Cloudflare Turnstile widget and allow the production hostname. The site key is public; the secret key is private. The API verifies each submission with Cloudflare and checks the returned hostname and action.

## Configure Vercel

Set these environment variables in the Vercel project, then redeploy:

- `SUPABASE_URL`: project URL, such as `https://project-ref.supabase.co`.
- `SUPABASE_SERVICE_ROLE_KEY`: private service-role key.
- `ADVICE_ALLOWED_ORIGIN`: exact website origin with no trailing slash, such as `https://cse-raccoon-tips.vercel.app`.
- `TURNSTILE_SITE_KEY`: public Turnstile site key.
- `TURNSTILE_SECRET_KEY`: private Turnstile secret key.
- `ADVICE_RATE_LIMIT_SECRET`: a long random secret used to HMAC IP addresses before rate-limit storage.

For local development, copy `.env.example` to `.env.local`, fill in the values, and run `npx vercel dev`. Never commit `.env.local`.

## Note Handling

Notes are public to all visitors; contributors are warned not to include personal information. The API validates note fields, enforces the allowed origin, requires Turnstile, and limits submissions to 10 per IP per minute. Rate-limit records contain a keyed HMAC rather than raw IP addresses. There is no public delete API; manage removal with a trusted Supabase administrator account.

Existing notes in browser `localStorage` are not automatically uploaded, avoiding accidental publication of previously private browser data.