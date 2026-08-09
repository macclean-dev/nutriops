// ─────────────────────────────────────────────────────────────────────────────
// Lógica pura da importação de planilha por foto/PDF (item 11) — separada do
// componente React (import-template-modal.jsx) pra ser testável sem DOM/fetch.
// A chamada de rede em si mora no componente; aqui só o que dá pra testar
// direto: ler o arquivo, validar a resposta da IA, e montar o template no
// shape que forms.jsx espera (mesmo shape dos TPL_* — id/category/frequency/
// title/sections[].fields[]).
// ─────────────────────────────────────────────────────────────────────────────

const VALID_FREQUENCIES = ['daily', 'weekly', 'biweekly', 'monthly'];
const VALID_FIELD_TYPES = ['cnc', 'text', 'presence'];

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Falha ao ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

// A IA às vezes erra o schema (seção sem fields, tarefa sem label) — aqui só
// os problemas que impediriam publicar; erro de campo individual é corrigível
// na revisão, não trava tudo.
export function validateDraft(draft) {
  const errors = [];
  if (!draft || typeof draft !== 'object') { errors.push('A IA não retornou uma extração válida.'); return errors; }
  if (!draft.title || !String(draft.title).trim()) errors.push('Não veio um título — confirme antes de publicar.');
  const sections = Array.isArray(draft.sections) ? draft.sections : [];
  const totalFields = sections.reduce((n, s) => n + (Array.isArray(s.fields) ? s.fields.length : 0), 0);
  if (totalFields === 0) errors.push('Nenhuma tarefa foi extraída da imagem — tente uma foto mais nítida.');
  return errors;
}

export function draftToTemplate(draft, { category = 'custom', uid = () => crypto.randomUUID() } = {}) {
  const sections = (Array.isArray(draft?.sections) ? draft.sections : [])
    .filter((s) => Array.isArray(s.fields) && s.fields.length > 0)
    .map((s) => ({
      id: uid(),
      title: (s.title ?? '').trim() || 'Seção',
      fields: s.fields.map((f) => ({
        id: uid(),
        label: (f.label ?? '').trim() || '—',
        type: VALID_FIELD_TYPES.includes(f.type) ? f.type : 'cnc',
        hint: f.hint ? String(f.hint).trim() : null,
      })),
    }));

  return {
    id: uid(),
    category,
    frequency: VALID_FREQUENCIES.includes(draft?.frequency) ? draft.frequency : 'daily',
    title: (draft?.title ?? '').trim() || 'Planilha importada',
    description: 'Importada por foto/PDF via IA — revisada antes de publicar.',
    sections,
    custom: true,
    importedByAI: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
