-- Run in Supabase SQL Editor after enabling pg_cron in Database > Extensions.
-- Idempotent: replace this project's cleanup job without touching other jobs.
do $$
declare job bigint;
begin
  for job in select jobid from cron.job where jobname = 'graduation-delete-expired-guests' loop
    perform cron.unschedule(job);
  end loop;
end;
$$;
select cron.schedule('graduation-delete-expired-guests', '15 2 * * *', 'select public.purge_expired_guest_data();');
