-- v3.2 — stop recurring reminders from piling up.
--
-- generateMissingReminders walks from a template's created_at to today and inserts
-- a pending reminder for every due date it cannot find in the list handed to it.
-- That list is app state and can be stale, and nothing stopped a second insert, so
-- the same (template, due_date) accumulated duplicates — 29 of them here — and any
-- reminder that was deleted or confirmed outside the app came back as pending.
--
-- The index makes a duplicate impossible; the code side switches to an upsert with
-- ignoreDuplicates and stops backfilling further than BACKFILL_MONTHS.

delete from recurring_reminders r
 using (
   select id, row_number() over (
            partition by user_id, template_id, due_date
            order by (status = 'confirmed') desc, (status = 'skipped') desc, created_at
          ) as rn
     from recurring_reminders
 ) dup
 where r.id = dup.id and dup.rn > 1;

create unique index if not exists recurring_reminders_uniq
  on recurring_reminders (user_id, template_id, due_date);
