// ─────────────────────────────────────────────────────────────────────────────
// Extração de planilha por foto/PDF via IA — item 11 da revisão de produto
// (09/08). Primeira função serverless do projeto: NutriOPS é SPA estática
// (Vite), sem isso a chave da Anthropic vazaria no bundle do client (como
// aconteceria se essa chamada fosse feita direto do browser). Vercel resolve
// funções em /api/* ANTES dos rewrites do vercel.json, então o catch-all pro
// SPA (`/(.*) → /index.html`) não intercepta esta rota.
//
// ANTHROPIC_API_KEY precisa estar configurada em Vercel → Project → Settings
// → Environment Variables — SEM prefixo VITE_ (senão embute no bundle client).
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
// Vercel limita o corpo de Serverless Functions a ~4.5MB; base64 soma ~33% ao
// tamanho original. Ficando abaixo disso sobra margem pro resto do JSON.
const MAX_BASE64_CHARS = 4_000_000;

const EXTRACT_TOOL = {
  name: 'extrair_planilha',
  description: 'Extrai a estrutura de uma planilha de controle sanitário (RDC 216/2004) a partir da imagem/PDF de uma planilha de papel.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Título da planilha' },
      frequency: { type: 'string', enum: ['daily', 'weekly', 'biweekly', 'monthly'], description: 'Frequência de preenchimento mais provável' },
      sections: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            fields: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  type: { type: 'string', enum: ['cnc', 'text', 'presence'], description: "'cnc' = conforme/não-conforme (a maioria das tarefas), 'text' = campo de observação livre, 'presence' = marcação de ocorrência (ex.: praga vista sim/não)" },
                  hint: { type: 'string', description: 'Instrução ou legenda curta da tarefa, se houver no original' },
                },
                required: ['label', 'type'],
              },
            },
          },
          required: ['title', 'fields'],
        },
      },
    },
    required: ['title', 'frequency', 'sections'],
  },
};

const EXTRACT_PROMPT = 'Esta é a foto (ou digitalização) de uma planilha de controle sanitário de papel, usada por uma cozinha/confeitaria pra registrar conformidade com a RDC 216/2004 da ANVISA. Extraia a estrutura: título da planilha, a frequência de preenchimento mais provável (diária/semanal/quinzenal/mensal — pela quantidade de colunas de data ou pelo texto), e as seções com suas tarefas/itens de verificação. Cada tarefa vira um "field": use type "cnc" pra itens de conforme/não-conforme (a maioria), "text" pra campos de observação livre, "presence" pra marcações de ocorrência (ex.: pragas). Não invente tarefas que não estão na imagem. Se algum trecho estiver ilegível, pule esse item em vez de adivinhar.';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido.' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY não configurada no servidor.' });
    return;
  }

  const { imageBase64, mediaType } = req.body ?? {};
  if (!imageBase64 || !mediaType) {
    res.status(400).json({ error: 'Envie imageBase64 e mediaType.' });
    return;
  }
  if (!ALLOWED_MEDIA_TYPES.includes(mediaType)) {
    res.status(400).json({ error: 'Formato não suportado. Use JPEG, PNG, WebP ou PDF.' });
    return;
  }
  if (imageBase64.length > MAX_BASE64_CHARS) {
    res.status(400).json({ error: 'Arquivo grande demais. Envie uma foto por página, ou comprima antes de enviar.' });
    return;
  }

  const contentBlockType = mediaType === 'application/pdf' ? 'document' : 'image';

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 4096,
        tools: [EXTRACT_TOOL],
        tool_choice: { type: 'tool', name: 'extrair_planilha' },
        messages: [{
          role: 'user',
          content: [
            { type: contentBlockType, source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: EXTRACT_PROMPT },
          ],
        }],
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      res.status(502).json({ error: 'Falha ao consultar a IA.', detail: detail.slice(0, 500) });
      return;
    }

    const data = await response.json();
    const toolUse = (data.content ?? []).find((block) => block.type === 'tool_use');
    if (!toolUse) {
      res.status(502).json({ error: 'A IA não retornou uma extração estruturada.' });
      return;
    }

    res.status(200).json({ draft: toolUse.input });
  } catch (err) {
    res.status(500).json({ error: err?.message ?? 'Erro inesperado ao processar.' });
  }
}
