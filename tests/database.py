"""Run against a DISPOSABLE local PostgreSQL container, never a production database."""
from pathlib import Path
import subprocess
import concurrent.futures

container = 'polytech-db-check'

def sql(statement, check=True):
    return subprocess.run(['docker', 'exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], input=statement, text=True, capture_output=True, check=check)

sql('create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users (id uuid primary key);')
sql(Path('supabase/migrations/202610180001_graduation.sql').read_text())
assert sql("select registration_open from event_settings").stdout.strip() == 'f'
assert sql('update event_settings set registration_open = true', check=False).returncode != 0, 'opening without settings must fail'
assert sql("select reserve_graduation('Camille','Martin','c@example.com','',1,'fr')", check=False).returncode != 0, 'closed registration must reject'
sql("""update event_settings set capacity=3, venue='Test venue', venue_address='Test address', organizer_email='test@example.com', privacy_notice_fr=repeat('Notice de confidentialité ',5), privacy_notice_en=repeat('Privacy notice ',5), retention_until='2027-03-28', registration_open=true;""")

def reserve(email):
    return sql(f"select reserve_graduation('Camille','Martin','{email}','',2,'fr')", check=False)

with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    results = list(pool.map(reserve, ['one@example.com', 'two@example.com']))
assert sorted(result.returncode == 0 for result in results) == [False, True], 'only one competing reservation can fit'
assert sql("select sum(party_size) from reservations where status='confirmed'").stdout.strip() == '2'
existing = sql('select email from reservations limit 1').stdout.strip()
assert '"duplicate": true' in reserve(existing).stdout
assert sql('select count(*) from reservations').stdout.strip() == '1', 'duplicate must not consume seats'
assert sql("select reserve_graduation('Camille','Martin','too-big@example.com','',5,'fr')", check=False).returncode != 0
assert sql("set role anon; select * from reservations", check=False).returncode != 0, 'anon cannot read guest data'
assert sql("set role authenticated; select * from reservations", check=False).returncode != 0, 'signed-in non-organizer cannot read guest data'
assert sql("set role anon; select reserve_graduation('A','B','a@example.com','',1,'fr')", check=False).returncode != 0, 'anonymous cannot bypass edge verification'
assert sql("select has_function_privilege('service_role','public.reserve_graduation(text,text,text,text,integer,text)','execute')").stdout.strip() == 't'
id_value = sql('select id from reservations limit 1').stdout.strip()
assert sql(f"select claim_invitation_email('{id_value}') is not null").stdout.strip() == 't'
assert sql(f"select claim_invitation_email('{id_value}') is null").stdout.strip() == 't', 'concurrent email attempt must not claim same reservation'
sql(f"update reservations set email_status='failed' where id='{id_value}'")
assert sql(f"select claim_invitation_email('{id_value}') is not null").stdout.strip() == 't', 'failed invitation retry permitted'
sql(f"update reservations set status='cancelled' where id='{id_value}'")
assert reserve('new@example.com').returncode == 0, 'cancelled reservations release places'
assert sql('select purge_expired_guest_data()').stdout.strip() == '0', 'future retention deadline keeps reservations'
sql("update event_settings set registration_open=false, event_date='2020-02-28', retention_until='2020-03-28'")
assert sql('select purge_expired_guest_data()').stdout.strip() == '2', 'expired guest data is deleted'
assert sql('select count(*) from reservations').stdout.strip() == '0'
print('PASS: migration, closed/open guards, concurrent seat limits, duplicate protection, party limits, access control, email claiming/retry, cancellation, retention cleanup.')
