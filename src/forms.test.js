import { describe, it, expect, beforeEach } from 'vitest';
import { completionPct, generateFormPDF, readFormTemplates } from './forms';

// Template no formato do CASA DOCE Banheiros, exercitando os tipos novos.
const TPL = {
  id:'t1', category:'faxina', frequency:'daily', title:'Banheiros', description:'x',
  sections:[
    { id:'s1', title:'Limpeza Geral', fields:[
      { id:'lg', label:'Realizada', type:'checkbox' },
      { id:'lgh', label:'Horário', type:'text' },        // text não conta no %
    ]},
    { id:'s2', title:'Manutenção', fields:[
      { id:'mn', label:'Realizada', type:'checkbox' },
      { id:'dt', label:'Data', type:'date' },
    ]},
  ],
};

describe('completionPct — tipos date e checkbox (Fase B)', () => {
  it('vazio = 0%', () => {
    expect(completionPct(TPL, { responses:{} })).toBe(0);
  });
  it('checkbox só conta quando MARCADO (true); false não conta', () => {
    // campos que contam: lg(checkbox), mn(checkbox), dt(date) = 3 (lgh é text, ignorado)
    expect(completionPct(TPL, { responses:{ lg:false } })).toBe(0);   // false não conta
    expect(completionPct(TPL, { responses:{ lg:true } })).toBe(33);   // 1/3
  });
  it('date conta quando preenchido', () => {
    expect(completionPct(TPL, { responses:{ dt:'2026-07-28' } })).toBe(33); // 1/3
  });
  it('tudo preenchido = 100%', () => {
    expect(completionPct(TPL, { responses:{ lg:true, mn:true, dt:'2026-07-28', lgh:'08:00' } })).toBe(100);
  });
});

describe('seedTemplates CASA DOCE — 11 planilhas BPF (Fase A+B+C)', () => {
  beforeEach(() => localStorage.clear());
  const CD = { id:'bf245c3b-2f9', name:'CASA DOCE' };

  it('retorna 11 templates com ids uuid únicos', () => {
    const tpls = readFormTemplates(CD);
    expect(tpls).toHaveLength(11);
    const ids = tpls.map(t => t.id);
    expect(new Set(ids).size).toBe(11);                        // sem colisão de uuid
    for (const id of ids) expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('todo campo tem id/label/type; ids de campo não repetem no template', () => {
    for (const t of readFormTemplates(CD)) {
      const fieldIds = [];
      for (const s of t.sections) for (const f of s.fields) {
        expect(Boolean(f.id && f.label && f.type)).toBe(true);
        fieldIds.push(f.id);
      }
      expect(new Set(fieldIds).size).toBe(fieldIds.length);    // sem campo duplicado
    }
  });

  it('carrinhos tem os 32 códigos como checklist (1 data/responsável pro lote)', () => {
    const carr = readFormTemplates(CD).find(t => t.title.includes('Carrinhos'));
    const checklist = carr.sections.find(s => s.id === 'cd-carr-lav');
    expect(checklist.fields).toHaveLength(32);
    expect(checklist.fields.every(f => f.type === 'checkbox')).toBe(true);
    const registro = carr.sections.find(s => s.id === 'cd-carr-reg');
    expect(registro.fields.map(f => f.type)).toEqual(['date', 'text']);
  });

  it('vetores customizado: sem Pombo, com Abelha, hint de setor', () => {
    const vet = readFormTemplates(CD).find(t => t.category === 'vetores_pragas');
    const labels = vet.sections[0].fields.map(f => f.label);
    expect(labels.some(l => l.includes('Pombo'))).toBe(false);
    expect(labels.some(l => l.includes('Abelha'))).toBe(true);
    const abelha = vet.sections[0].fields.find(f => f.label.includes('Abelha'));
    expect(abelha.hint).toMatch(/Padaria/);
  });

  it('banheiros e hortifrutícolas têm bloco de não conformidade completo (desc+ação+responsável)', () => {
    const tpls = readFormTemplates(CD);
    for (const title of ['Banheiros', 'Hortifrutícolas']) {
      const t = tpls.find(x => x.title.includes(title));
      const ncSection = t.sections.find(s => s.title.includes('conformidade'));
      const labels = ncSection.fields.map(f => f.label);
      expect(labels.some(l => l.includes('conformidade'))).toBe(true);
      expect(labels.some(l => l.includes('corretiva'))).toBe(true);
      expect(labels.some(l => l.includes('Responsável'))).toBe(true);
    }
  });
});

describe('generateFormPDF — não quebra com date/checkbox e formata certo', () => {
  const rec = { id:'r1', periodKey:'2026-07-28', responses:{ lg:true, mn:false, dt:'2026-07-28', lgh:'08:00' } };
  const html = generateFormPDF(TPL, rec, { id:'bf245c3b-2f9', name:'CASA DOCE' });
  it('gera HTML sem lançar', () => { expect(typeof html).toBe('string'); expect(html.length).toBeGreaterThan(100); });
  it('checkbox marcado vira ✓ SIM', () => { expect(html).toContain('SIM'); });
  it('date vira DD/MM/AAAA', () => { expect(html).toContain('28/07/2026'); });
});
