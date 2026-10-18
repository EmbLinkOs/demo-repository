-- Guest data is only accessible through the Edge Function using the service role.
create table public.event_settings (
  id boolean primary key default true check (id),
  event_date date default '2027-02-28',
  event_time time,
  venue text,
  venue_address text,
  capacity integer check (capacity > 0 and capacity <= 100000),
  max_party_size integer not null default 4 check (max_party_size between 1 and 20),
  registration_open boolean not null default false,
  organizer_email text,
  privacy_notice_fr text,
  privacy_notice_en text,
  retention_until date,
  check (not registration_open or coalesce((
    event_date is not null and capacity is not null and
    length(trim(venue)) > 0 and length(trim(venue_address)) > 0 and
    organizer_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and
    length(trim(privacy_notice_fr)) > 50 and length(trim(privacy_notice_en)) > 50 and
    retention_until >= event_date and retention_until <= event_date + 366
  ), false))
);
insert into public.event_settings (id) values (true);

create table public.organizers (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('PD27-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  first_name text not null check (length(trim(first_name)) between 1 and 80),
  last_name text not null check (length(trim(last_name)) between 1 and 80),
  email text not null unique check (email = lower(trim(email)) and length(email) <= 254),
  phone text check (length(phone) <= 30),
  party_size integer not null check (party_size between 1 and 20),
  language text not null default 'fr' check (language in ('fr', 'en')),
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  checked_in boolean not null default false,
  email_status text not null default 'pending' check (email_status in ('pending', 'sending', 'sent', 'failed')),
  email_attempt integer not null default 1,
  email_claimed_at timestamptz,
  resend_id text,
  consent_at timestamptz not null default now(),
  consent_notice text not null,
  created_at timestamptz not null default now()
);
create index reservations_status on public.reservations(status);
alter table public.event_settings enable row level security;
alter table public.organizers enable row level security;
alter table public.reservations enable row level security;
revoke all on public.event_settings, public.organizers, public.reservations from anon, authenticated;
grant all on public.event_settings, public.organizers, public.reservations to service_role;

-- Lock the single settings row so simultaneous requests cannot overbook.
create function public.reserve_graduation(p_first_name text, p_last_name text, p_email text, p_phone text, p_party_size integer, p_language text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare settings public.event_settings; booking public.reservations; used integer;
begin
  select * into settings from public.event_settings where id = true for update;
  if not settings.registration_open or settings.retention_until < current_date then raise exception 'REGISTRATION_CLOSED'; end if;
  select * into booking from public.reservations where email = lower(trim(p_email));
  if found then return jsonb_build_object('duplicate', true); end if;
  if p_party_size < 1 or p_party_size > settings.max_party_size then raise exception 'INVALID_PARTY_SIZE'; end if;
  select coalesce(sum(party_size), 0) into used from public.reservations where status = 'confirmed';
  if used + p_party_size > settings.capacity then raise exception 'CAPACITY_EXCEEDED'; end if;
  insert into public.reservations (first_name, last_name, email, phone, party_size, language, consent_notice)
    values (trim(p_first_name), trim(p_last_name), lower(trim(p_email)), nullif(trim(p_phone), ''), p_party_size, p_language,
      case when p_language = 'en' then settings.privacy_notice_en else settings.privacy_notice_fr end)
    returning * into booking;
  return jsonb_build_object('duplicate', false, 'reservation', to_jsonb(booking));
end;
$$;

-- Settings and seat counts share the reservation lock. Capacity cannot be reduced below attendance.
create function public.update_graduation_settings(p_settings jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare used integer;
begin
  perform 1 from public.event_settings where id = true for update;
  select coalesce(sum(party_size), 0) into used from public.reservations where status = 'confirmed';
  if (p_settings->>'capacity')::integer < used then raise exception 'CAPACITY_BELOW_BOOKED'; end if;
  update public.event_settings set event_date = (p_settings->>'event_date')::date,
    event_time = nullif(p_settings->>'event_time', '')::time,
    venue = nullif(trim(p_settings->>'venue'), ''), venue_address = nullif(trim(p_settings->>'venue_address'), ''),
    capacity = (p_settings->>'capacity')::integer, max_party_size = (p_settings->>'max_party_size')::integer,
    registration_open = (p_settings->>'registration_open')::boolean,
    organizer_email = nullif(trim(p_settings->>'organizer_email'), ''),
    privacy_notice_fr = p_settings->>'privacy_notice_fr', privacy_notice_en = p_settings->>'privacy_notice_en',
    retention_until = (p_settings->>'retention_until')::date where id = true;
end;
$$;

-- Atomically claim an email send. Failed requests keep the same idempotency key.
create function public.claim_invitation_email(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare booking public.reservations;
begin
  select * into booking from public.reservations where id = p_id for update;
  if not found or booking.status <> 'confirmed' or booking.email_status = 'sent' then return null; end if;
  if booking.email_status = 'sending' and booking.email_claimed_at > now() - interval '2 minutes' then return null; end if;
  update public.reservations set email_status = 'sending', email_claimed_at = now() where id = p_id returning * into booking;
  return to_jsonb(booking);
end;
$$;

revoke all on function public.reserve_graduation(text,text,text,text,integer,text) from public, anon, authenticated;
revoke all on function public.update_graduation_settings(jsonb) from public, anon, authenticated;
revoke all on function public.claim_invitation_email(uuid) from public, anon, authenticated;
grant execute on function public.reserve_graduation(text,text,text,text,integer,text) to service_role;
grant execute on function public.update_graduation_settings(jsonb) to service_role;
grant execute on function public.claim_invitation_email(uuid) to service_role;

create function public.purge_expired_guest_data()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare removed integer;
begin
  perform 1 from public.event_settings where id = true for update;
  if exists (select 1 from public.event_settings where retention_until < current_date) then
    update public.event_settings set registration_open = false where id = true;
    delete from public.reservations;
    get diagnostics removed = row_count;
    return removed;
  end if;
  return 0;
end;
$$;
revoke all on function public.purge_expired_guest_data() from public, anon, authenticated;
grant execute on function public.purge_expired_guest_data() to service_role;
