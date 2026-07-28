import { describe, it, expect } from 'vitest';
import { completionPct, generateFormPDF } from './forms';

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

describe('generateFormPDF — não quebra com date/checkbox e formata certo', () => {
  const rec = { id:'r1', periodKey:'2026-07-28', responses:{ lg:true, mn:false, dt:'2026-07-28', lgh:'08:00' } };
  const html = generateFormPDF(TPL, rec, { id:'bf245c3b-2f9', name:'CASA DOCE' });
  it('gera HTML sem lançar', () => { expect(typeof html).toBe('string'); expect(html.length).toBeGreaterThan(100); });
  it('checkbox marcado vira ✓ SIM', () => { expect(html).toContain('SIM'); });
  it('date vira DD/MM/AAAA', () => { expect(html).toContain('28/07/2026'); });
});
