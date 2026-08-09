import { describe, it, expect } from 'vitest';
import { fileToBase64, validateDraft, draftToTemplate } from './import-template';

describe('fileToBase64', () => {
  it('lê um arquivo e devolve só a parte base64, sem o prefixo data:', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'foto.jpg', { type: 'image/jpeg' });
    const b64 = await fileToBase64(file);
    expect(b64).not.toMatch(/^data:/);
    expect(b64.length).toBeGreaterThan(0);
  });
});

describe('validateDraft', () => {
  it('draft nulo ou não-objeto falha', () => {
    expect(validateDraft(null)).toHaveLength(1);
    expect(validateDraft(undefined)).toHaveLength(1);
  });
  it('sem título gera erro', () => {
    const errors = validateDraft({ title: '', sections: [{ title: 'S', fields: [{ label: 'x', type: 'cnc' }] }] });
    expect(errors.some((e) => /título/.test(e))).toBe(true);
  });
  it('sem nenhuma tarefa extraída gera erro', () => {
    const errors = validateDraft({ title: 'Planilha X', sections: [] });
    expect(errors.some((e) => /nenhuma tarefa/i.test(e))).toBe(true);
  });
  it('draft válido não gera erros', () => {
    const errors = validateDraft({ title: 'Planilha X', sections: [{ title: 'S', fields: [{ label: 'Tarefa 1', type: 'cnc' }] }] });
    expect(errors).toEqual([]);
  });
});

describe('draftToTemplate', () => {
  let counter = 0;
  const uid = () => `test-uid-${counter++}`;

  it('monta o shape esperado por forms.jsx (category/frequency/sections/fields)', () => {
    const draft = {
      title: 'Controle de Temperatura de Câmaras',
      frequency: 'daily',
      sections: [{ title: 'Leituras', fields: [{ label: 'Câmara 1', type: 'cnc', hint: 'Manhã e tarde' }] }],
    };
    const tpl = draftToTemplate(draft, { uid });
    expect(tpl.title).toBe('Controle de Temperatura de Câmaras');
    expect(tpl.frequency).toBe('daily');
    expect(tpl.category).toBe('custom');
    expect(tpl.custom).toBe(true);
    expect(tpl.importedByAI).toBe(true);
    expect(tpl.sections).toHaveLength(1);
    expect(tpl.sections[0].fields[0]).toMatchObject({ label: 'Câmara 1', type: 'cnc', hint: 'Manhã e tarde' });
  });

  it('frequência inválida cai pro default (daily)', () => {
    const tpl = draftToTemplate({ title: 'X', frequency: 'anualmente', sections: [{ title: 'S', fields: [{ label: 'a', type: 'cnc' }] }] }, { uid });
    expect(tpl.frequency).toBe('daily');
  });

  it('tipo de campo inválido cai pro default (cnc)', () => {
    const tpl = draftToTemplate({ title: 'X', frequency: 'daily', sections: [{ title: 'S', fields: [{ label: 'a', type: 'inventado' }] }] }, { uid });
    expect(tpl.sections[0].fields[0].type).toBe('cnc');
  });

  it('descarta seção sem nenhum campo (a IA às vezes devolve seção vazia)', () => {
    const tpl = draftToTemplate({
      title: 'X', frequency: 'daily',
      sections: [{ title: 'Vazia', fields: [] }, { title: 'Com dado', fields: [{ label: 'a', type: 'cnc' }] }],
    }, { uid });
    expect(tpl.sections).toHaveLength(1);
    expect(tpl.sections[0].title).toBe('Com dado');
  });

  it('respeita a categoria escolhida na revisão', () => {
    const tpl = draftToTemplate({ title: 'X', frequency: 'daily', sections: [{ title: 'S', fields: [{ label: 'a', type: 'cnc' }] }] }, { category: 'higienizacao', uid });
    expect(tpl.category).toBe('higienizacao');
  });
});
