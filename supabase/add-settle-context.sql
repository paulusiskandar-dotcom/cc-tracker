-- Remember which entity is being settled so a bare "out 2 in 1" reply (without
-- retyping "hamasa") resolves. Optional convenience — "hamasa out 2 in 1" works
-- without it. Run in Supabase → SQL Editor.
alter table tg_chat_memory add column if not exists settle_entity text;
alter table tg_chat_memory add column if not exists settle_at    timestamptz;
