-- Apply once in the intended Supabase project; server uses only the service-role key.
-- No client-side table privileges: all writes go through the server.
create extension if not exists pgcrypto;
create table if not exists public.profiles (
 id uuid primary key default gen_random_uuid(),
 username text not null unique check (username ~ '^[a-z0-9_]{3,30}$'),
 password_hash text not null,
 display_name text not null default '' check (char_length(display_name)<=80),
 bio text not null default '' check (char_length(bio)<=500),
 tiktok_handle text check (tiktok_handle is null or tiktok_handle ~ '^[A-Za-z0-9._]{1,24}$'),
 tiktok_url text check (tiktok_url is null or tiktok_url ~ '^https://(www[.])?tiktok[.]com/@[A-Za-z0-9._]{1,24}/?$'),
 wallet_address text unique,
 credits_spent bigint not null default 0 check(credits_spent>=0),
 created_at timestamptz not null default now()
);
create table if not exists public.auth_attempts (
 username text primary key,
 failures integer not null default 0,
 blocked_until timestamptz,
 updated_at timestamptz not null default now()
);
create table if not exists public.sessions (
 token_hash text primary key check (char_length(token_hash)=64),
 user_id uuid not null references public.profiles(id) on delete cascade,
 expires_at timestamptz not null,
 created_at timestamptz not null default now()
);
create index if not exists sessions_user on public.sessions(user_id);
create table if not exists public.wallet_challenges (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 address text not null,
 nonce_hash text not null,
 expires_at timestamptz not null,
 consumed_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists challenges_user on public.wallet_challenges(user_id,created_at desc);
create table if not exists public.personas (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 name text not null check (char_length(name) between 1 and 80),
 description text not null default '' check (char_length(description)<=2000),
 image_url text,
 created_at timestamptz not null default now()
);
create index if not exists personas_user on public.personas(user_id,created_at desc);
create table if not exists public.posts (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 persona_id uuid references public.personas(id) on delete set null,
 body text not null check (char_length(body) between 1 and 5000),
 media_url text,
 video_url text,
 created_at timestamptz not null default now()
);
create index if not exists posts_user on public.posts(user_id,created_at desc);
create table if not exists public.generations (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 prompt text not null default '',
 input jsonb not null,
 status text not null default 'reserved' check(status in ('reserved','queued','completed','failed','submission_unknown')),
 provider_request_id text unique,
 status_url text,
 output_url text,
 error text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists generations_user on public.generations(user_id,created_at desc);
create table if not exists public.token_activity (
 signature text primary key,
 slot bigint not null,
 mint text not null,
 changes jsonb not null,
 created_at timestamptz not null default now()
);
create index if not exists token_activity_recent on public.token_activity(slot desc);
alter table public.token_activity enable row level security;
revoke all on public.token_activity from anon, authenticated;
grant all on public.token_activity to service_role;

alter table public.profiles enable row level security;
alter table public.auth_attempts enable row level security;
alter table public.sessions enable row level security;
alter table public.wallet_challenges enable row level security;
alter table public.personas enable row level security;
alter table public.posts enable row level security;
alter table public.generations enable row level security;
revoke all on public.profiles, public.auth_attempts, public.sessions, public.wallet_challenges, public.personas, public.posts, public.generations from anon, authenticated;
grant all on public.profiles, public.auth_attempts, public.sessions, public.wallet_challenges, public.personas, public.posts, public.generations to service_role;

-- Must be invoked by server-side service-role credential only. Atomic nonce consumption + wallet link.
create or replace function public.claim_wallet_challenge(p_id uuid,p_user uuid,p_address text,p_nonce_hash text)
returns boolean language plpgsql security invoker set search_path = public as $$
begin
 update wallet_challenges set consumed_at=now()
 where id=p_id and user_id=p_user and address=p_address and nonce_hash=p_nonce_hash
   and consumed_at is null and expires_at>now();
 if not found then return false; end if;
 update profiles set wallet_address=p_address where id=p_user;
 return found;
end $$;
-- The API passes a fresh on-chain balance; only service_role can execute.
create or replace function public.reserve_generation(p_user uuid,p_input jsonb,p_raw numeric,p_decimals integer)
returns uuid language plpgsql security invoker set search_path = public as $$
declare p profiles%rowtype; entitlement numeric; gid uuid;
begin
 if p_raw<0 or p_decimals<0 or p_decimals>18 or p_raw<>trunc(p_raw) then raise exception 'invalid balance'; end if;
 select * into p from profiles where id=p_user and wallet_address is not null for update;
 if not found then raise exception 'wallet not linked'; end if;
 entitlement := floor(p_raw/(1000*power(10::numeric,p_decimals)));
 if entitlement <= p.credits_spent then raise exception 'insufficient credits'; end if;
 update profiles set credits_spent=credits_spent+1 where id=p_user;
 insert into generations(user_id,prompt,input) values (p_user,coalesce(p_input->>'prompt',''),p_input) returning id into gid;
 return gid;
end $$;
create or replace function public.finish_generation(p_id uuid,p_user uuid,p_status text,p_request_id text default null,p_status_url text default null,p_output_url text default null,p_error text default null)
returns boolean language plpgsql security invoker set search_path = public as $$
declare prior text;
begin
 select status into prior from generations where id=p_id and user_id=p_user for update;
 if not found then return false; end if;
 if prior in ('completed','failed') then return false; end if;
 if p_status not in ('queued','completed','failed','submission_unknown') then raise exception 'invalid status'; end if;
 -- A pending submission is never auto-refunded: timeout may have accepted the request.
 if p_status='failed' then
   update profiles set credits_spent=credits_spent-1 where id=p_user;
 end if;
 update generations set status=p_status, provider_request_id=coalesce(p_request_id,provider_request_id),
 status_url=coalesce(p_status_url,status_url),output_url=coalesce(p_output_url,output_url),
 error=p_error,updated_at=now() where id=p_id;
 return true;
end $$;
-- Username-based distributed login throttle (10 failures in 15 minutes).
create or replace function public.auth_rate_check(p_username text)
returns boolean language sql security invoker set search_path=public as $$
 select not exists(select 1 from auth_attempts where username=p_username and blocked_until>now());
$$;
create or replace function public.auth_rate_record(p_username text,p_success boolean)
returns void language plpgsql security invoker set search_path=public as $$
begin
 if p_success then delete from auth_attempts where username=p_username; return; end if;
 insert into auth_attempts(username,failures,blocked_until,updated_at) values(p_username,1,null,now())
 on conflict(username) do update set
 failures=case when auth_attempts.updated_at<now()-interval '15 minutes' then 1 else auth_attempts.failures+1 end,
 blocked_until=case when auth_attempts.updated_at<now()-interval '15 minutes' then null when auth_attempts.failures+1>=10 then now()+interval '15 minutes' else auth_attempts.blocked_until end,
 updated_at=now();
end $$;
revoke all on function public.auth_rate_check(text), public.auth_rate_record(text,boolean) from public, anon, authenticated;
grant execute on function public.auth_rate_check(text), public.auth_rate_record(text,boolean) to service_role;
revoke all on function public.claim_wallet_challenge(uuid,uuid,text,text), public.reserve_generation(uuid,jsonb,numeric,integer), public.finish_generation(uuid,uuid,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.claim_wallet_challenge(uuid,uuid,text,text), public.reserve_generation(uuid,jsonb,numeric,integer), public.finish_generation(uuid,uuid,text,text,text,text,text) to service_role;
