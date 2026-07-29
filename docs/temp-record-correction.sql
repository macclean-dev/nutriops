-- Correção de registro de temperatura com trilha de auditoria.
-- Nunca sobrescreve sem rastro: ao corrigir, o valor ATUAL do registro vira o
-- valor certo (dashboards/relatórios/PDF continuam lendo `value` sem precisar
-- mudar nada), mas o valor original + quem + quando + por quê ficam gravados
-- ao lado, pra qualquer auditoria (ANVISA, nutricionista RT) ver o que houve.
-- Aditivo e nullable — não quebra registros existentes nem o schema atual.

alter table public.temperature_records add column if not exists original_value    numeric;
alter table public.temperature_records add column if not exists correction_reason text;
alter table public.temperature_records add column if not exists corrected_by      text;
alter table public.temperature_records add column if not exists corrected_at      timestamptz;

-- RLS: nenhuma policy nova necessária. A policy tenant_isolation já existente
-- em temperature_records é `for all` (cobre update), gated por device-token
-- (app_metadata.tenant_id) OU is_member(tenant_id) — mesmo caminho que já
-- libera o INSERT hoje. Ver docs/auth-fase1-tenant-members.sql.
