import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { quickSign } from './date-sig-field';
import { sectionReceiving } from './dossier';

// Resposta da nutricionista (22/09), sobre o Recebimento simplificado:
// "na data de validade pode adicionar data e horário de recebimento? Da
// mesma forma dos outros onde clicamos em 'Feito agora' já aparece a data
// do dia e a aba pra colocar o nome do responsável."
//
// É o mesmo carimbo de 1 toque das planilhas de higienização (date_sig/
// quickSign/DateSigField) - extraído pra date-sig-field.jsx (22/09) pra
// pages.jsx poder usar sem puxar forms.jsx inteiro. "Data de validade"
// (a validade do PRODUTO) não muda - o campo novo é "Recebido em", separado.

const pages = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');
const corpoRecebimento = pages.slice(pages.indexOf('function RecebimentoView('), pages.indexOf('// ─── Offline Indicator'));

describe('quickSign/DateSigField saíram de forms.jsx sem quebrar quem já usava', () => {
  it('quickSign continua exportado de forms.jsx (re-export) e agora também de date-sig-field.jsx', () => {
    const forms = readFileSync(`${process.cwd()}/src/forms.jsx`, 'utf8');
    expect(forms).toContain("import { quickSign, DateSigField } from './date-sig-field';");
    expect(forms).toContain('export { quickSign };');
  });

  it('mesmo comportamento de sempre: data de hoje (YYYY-MM-DD) + nome aparado', () => {
    const r = quickSign('  Ana Paula  ');
    expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.sig).toBe('Ana Paula');
    expect(quickSign(undefined).sig).toBe('');
  });
});

describe('"Recebido em" no formulário - campo novo, separado de Data de validade', () => {
  it('usa DateSigField, não um input de texto', () => {
    expect(corpoRecebimento).toContain('<DateSigField value={recebido} onChange={setRecebido} currentName={session?.user?.name} />');
  });

  it('"Data de validade" continua existindo do jeito que estava - não virou o carimbo', () => {
    expect(corpoRecebimento).toContain('<label>Data de validade<input value={validade} onChange={(e) => setValidade(e.target.value)} placeholder="DD/MM/AAAA" /></label>');
  });

  it('é opcional - não entra na obrigatoriedade do botão', () => {
    expect(corpoRecebimento).toContain("disabled={!produto.trim() || !resultado || (motivoObrigatorio && !motivoRejeicao.trim()) || saving}");
    expect(corpoRecebimento).not.toMatch(/disabled=\{[^}]*recebido/);
  });

  it('o registro grava recebido, e o reset do formulário limpa de volta pra {}', () => {
    const ini = corpoRecebimento.indexOf('const record = {');
    const fim = corpoRecebimento.indexOf('};', ini);
    expect(corpoRecebimento.slice(ini, fim)).toContain('recebido,');
    expect(corpoRecebimento).toContain('setRecebido({});');
  });
});

describe('recebido aparece em todo lugar que já mostra o registro', () => {
  it('histórico da própria tela: data (DD/MM/AAAA) e responsável entram na linha', () => {
    const ini = corpoRecebimento.indexOf('filtered.map((r) => {');
    const fim = corpoRecebimento.indexOf('})}', ini);
    const bloco = corpoRecebimento.slice(ini, fim);
    expect(bloco).toContain("r.recebido?.date ? r.recebido.date.split('-').reverse().join('/') : null");
    expect(bloco).toContain('r.recebido?.sig || null');
  });

  it('CSV ganha dataRecebimento/responsavelRecebimento, resolvidos a partir do objeto recebido', () => {
    expect(corpoRecebimento).toContain("'dataRecebimento'");
    expect(corpoRecebimento).toContain("'responsavelRecebimento'");
    expect(corpoRecebimento).toContain("k === 'dataRecebimento' ? r.recebido?.date ?? ''");
    expect(corpoRecebimento).toContain("k === 'responsavelRecebimento' ? r.recebido?.sig ?? ''");
  });

  it('dossiê fiscal: ganha a coluna "Recebido por" com o nome de quem carimbou', () => {
    const s = sectionReceiving([{
      hora: '08:40', recebido: { date: '2026-09-22', sig: 'Ana Paula' },
      produto: 'Queijo', resultado: 'aceito', createdAt: '2026-09-22T10:00:00Z',
    }]);
    expect(s.headers).toContain('Recebido por');
    expect(s.rowsHtml).toContain('Ana Paula');
  });

  it('registro sem carimbo (recebido ausente) não quebra o dossiê - célula fica vazia', () => {
    const s = sectionReceiving([{ hora: '08:40', produto: 'Queijo', resultado: 'aceito', createdAt: '2026-09-22T10:00:00Z' }]);
    expect(() => s.rowsHtml).not.toThrow();
    expect(s.rowsHtml).toContain('08:40');
  });
});

describe('repository - recebido chega na nuvem e volta', () => {
  const repo = readFileSync(`${process.cwd()}/src/repository.js`, 'utf8');

  it('recvToRow só manda o objeto quando tem algo dentro (date ou sig) - {} vira null, não um jsonb vazio inútil', () => {
    expect(repo).toContain('recebido: r.recebido && (r.recebido.date || r.recebido.sig) ? r.recebido : null');
  });

  it('recvFromRow lê de volta com fallback pra {} (mesmo padrão de checks/responses no resto do app)', () => {
    expect(repo).toContain('recebido: row.recebido ?? {}');
  });

  it('o schema do setup do zero (Configurações → SQL) já cria a coluna recebido (jsonb)', () => {
    const ini = repo.indexOf('create table if not exists receiving_records');
    const fim = repo.indexOf(');', ini);
    expect(repo.slice(ini, fim)).toContain('recebido jsonb');
  });

  it('existe migração idempotente pra quem já tem a tabela, com o check de projeto obrigatório', () => {
    const sql = readFileSync(`${process.cwd()}/docs/receiving-recebido.sql`, 'utf8');
    expect(sql).toContain('select current_database()');
    expect(sql).toContain('add column if not exists recebido jsonb');
  });
});
