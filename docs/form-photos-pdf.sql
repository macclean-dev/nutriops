-- ═══════════════════════════════════════════════════════════════════════════
-- NutriOPS · Liberar PDF no bucket `form-photos` (v1.9.260, 03/10/2026)
--
-- POR QUE: desde a v1.9.134 os campos "Comprovante de dedetização (foto ou
-- PDF)" e "Comprovante / laudo (foto ou PDF)" prometem PDF, mas o bucket só
-- aceitava imagem e o campo só abria a câmera. A v1.9.260 passou a aceitar PDF
-- no app; falta o bucket aceitar o tipo `application/pdf`.
--
-- O QUE ESTE ARQUIVO FAZ: muda SÓ a lista de tipos aceitos do bucket. Não toca
-- nas regras de acesso (policies). As regras atuais vivem em
-- docs/rls-policies.sql. NÃO rode docs/form-photos-storage.sql de novo pra
-- isto: ele recria as regras numa versão antiga.
--
-- Idempotente: rodar duas vezes dá o mesmo resultado.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── PASSO 0 · Confirmar o projeto ───────────────────────────────────────────
-- Tem que devolver 1 linha com id = form-photos. Se der erro ou vier vazio,
-- PARE: você está no projeto errado (o bucket só existe no NutriOPS).
select current_database(), id, allowed_mime_types, file_size_limit
from storage.buckets where id = 'form-photos';

-- ── PASSO 1 · Liberar PDF (mantém as 3 imagens e o limite de 5 MB) ─────────
update storage.buckets
   set allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf']
 where id = 'form-photos';

-- ── PASSO 2 · Conferência ───────────────────────────────────────────────────
-- Tem que devolver pdf_liberado = true e limite = 5242880. Se pdf_liberado
-- vier false, o PASSO 1 não rodou (o editor às vezes roda só o trecho
-- selecionado): rode o arquivo inteiro de novo.
select id,
       'application/pdf' = any(allowed_mime_types) as pdf_liberado,
       file_size_limit as limite
from storage.buckets where id = 'form-photos';
