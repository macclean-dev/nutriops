-- Adiciona as colunas custom/v na tabela form_templates já existente em
-- produção. Sem isso, uma planilha editada pela RT (custom:true) pode ser
-- silenciosamente revertida por um sync entre devices — o registro que volta
-- da nuvem não carrega a marcação, e o próximo boot reaplica o seed por cima
-- da edição dela. Rodar no Supabase SQL Editor ANTES do deploy da versão que
-- dá à RT autonomia pra editar opções de lista suspensa nas planilhas.
--
-- Como rodar: Supabase Dashboard → SQL Editor → colar sem nada selecionado →
-- Run.

alter table form_templates add column if not exists custom boolean default false;
alter table form_templates add column if not exists v integer default 0;
