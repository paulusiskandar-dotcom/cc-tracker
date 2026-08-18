-- v3.1 — allow "Personal" as a reimburse entity, drop "Travelio".
--
-- Travelio was never used (zero ledger rows). Personal is needed for money fronted
-- for an individual — a partner's share of a payout, someone else's tax bill — which
-- passes through Paulus's account without being his income or his spending.
-- The app side changed in 7c1e3cf; this is the DB check that rejected the first
-- Personal settlement ("violates check constraint reimburse_settlements_entity_check").

alter table reimburse_settlements drop constraint if exists reimburse_settlements_entity_check;
alter table reimburse_settlements add constraint reimburse_settlements_entity_check
  check (entity = any (array['Hamasa'::text, 'SDC'::text, 'Personal'::text]));

-- The seeded receivable account follows the entity rename.
update accounts set name = 'Piutang Personal', entity = 'Personal'
 where entity = 'Travelio' and name = 'Piutang Travelio' and is_active;
