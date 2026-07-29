-- Recebimento: "forma de conservação" (Resfriado/Congelado/Ambiente), campo
-- informativo — nutricionista confirmou (29/07) que não precisa medir
-- temperatura por item recebido, cada categoria já vai pra câmara com
-- temperatura fixa (congelada ou refrigerada). Aditivo, nullable.
alter table public.receiving_records add column if not exists conservacao text;
