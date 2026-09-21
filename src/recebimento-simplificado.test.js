import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { receivingSuggestedResult } from './verdict';
import { sectionReceiving } from './dossier';
import { pendingReceivingItems } from './nonconformities';

// Pedido da nutricionista da CASA DOCE (21/09): "deixar mais simples e
// prática" a planilha de Recebimento de Mercadorias — só Data de validade,
// Hora, Produto, Temperatura, 3 verificações C/NC (embalagem, rotulagem,
// aparência) e o Resultado (Aceito/Rejeitado/Aceito parcial). O dono decidiu
// que a mudança é GLOBAL — vale pras mesmas lojas que já usam esta tela
// (Swiss, Bäckerei, DBK e a família CASA DOCE), não é personalização por
// loja: a tela é uma só, compartilhada.
//
// Fornecedor/NF/Quantidade/Forma de conservação saíram do FORMULÁRIO, mas as
// colunas continuam no banco: registro antigo mantém esses dados (evidência
// de fiscalização não pode sumir), só não é mais coletado.

const pages = readFileSync(`${process.cwd()}/src/pages.jsx`, 'utf8');
const corpoRecebimento = pages.slice(pages.indexOf('function RecebimentoView('), pages.indexOf('// ─── Offline Indicator'));

describe('RECEIVING_CHECKS — só as 3 checáveis na hora do recebimento', () => {
  it('tem exatamente embalagem, rotulagem e aparência — nem mais, nem menos', () => {
    const bloco = pages.slice(pages.indexOf('const RECEIVING_CHECKS = ['), pages.indexOf('];', pages.indexOf('const RECEIVING_CHECKS = [')));
    expect(bloco).toContain("id: 'embalagem'");
    expect(bloco).toContain("id: 'rotulagem'");
    expect(bloco).toContain("id: 'aparencia'");
    expect(bloco).not.toContain("id: 'veiculo'");
    expect(bloco).not.toContain("id: 'entregador'");
    expect(bloco).not.toContain("id: 'temperatura'");
  });

  it('a sugestão de resultado continua funcionando com só 3 checks (aceito quando os 3 são C)', () => {
    const ids = ['embalagem', 'rotulagem', 'aparencia'];
    expect(receivingSuggestedResult({ embalagem: 'C', rotulagem: 'C', aparencia: 'C' }, ids)).toBe('aceito');
    expect(receivingSuggestedResult({ embalagem: 'C', rotulagem: 'NC', aparencia: 'C' }, ids)).toBe('aceito_parcial');
  });
});

describe('campos do formulário — o que sobrou e o que entrou', () => {
  it('fornecedor, NF, quantidade e forma de conservação saíram da tela de captura', () => {
    expect(corpoRecebimento).not.toContain('setFornecedor');
    expect(corpoRecebimento).not.toContain('setNf(');
    expect(corpoRecebimento).not.toContain('setQuantidade');
    expect(corpoRecebimento).not.toContain('setConservacao');
    expect(corpoRecebimento).not.toContain('Forma de conservação');
  });

  it('Hora é campo novo — type="time", sem valor padrão (a pessoa anota a hora real)', () => {
    expect(corpoRecebimento).toContain('<label>Hora<input type="time" value={hora} onChange={(e) => setHora(e.target.value)} /></label>');
    expect(corpoRecebimento).toContain("const [hora, setHora]             = useState('');");
  });

  it('produto, validade e temperatura continuam', () => {
    expect(corpoRecebimento).toContain('<label>Produto<input value={produto}');
    expect(corpoRecebimento).toContain('Data de validade<input value={validade}');
    expect(corpoRecebimento).toContain('Temperatura na chegada');
  });

  it('fornecedor não é mais obrigatório pra registrar — só produto e resultado', () => {
    expect(corpoRecebimento).toContain("disabled={!produto.trim() || !resultado || (motivoObrigatorio && !motivoRejeicao.trim()) || saving}");
    expect(corpoRecebimento).toContain("if (!produto.trim() || !resultado || (motivoObrigatorio && !motivoRejeicao.trim())) return;");
  });

  it('o registro novo grava hora e não tenta mais gravar fornecedor/nf/quantidade/conservacao', () => {
    const ini = corpoRecebimento.indexOf('const record = {');
    const fim = corpoRecebimento.indexOf('};', ini);
    const bloco = corpoRecebimento.slice(ini, fim);
    expect(bloco).toContain('hora: hora.trim()');
    expect(bloco).not.toContain('fornecedor:');
    expect(bloco).not.toContain('nf:');
    expect(bloco).not.toContain('quantidade:');
    expect(bloco).not.toContain('conservacao');
  });
});

describe('CSV e histórico não perdem dado antigo', () => {
  it('CSV mantém as colunas antigas (evidência de registro já feito) e ganha "hora"', () => {
    expect(corpoRecebimento).toContain("const cols = ['createdAt','hora','fornecedor','nf','produto','quantidade','validade','temperatura','conservacao','resultado','motivoRejeicao','obs','user'];");
  });

  it('a linha do histórico mostra registro NOVO (só hora/validade/temperatura) sem pontuação sobrando', () => {
    // Simula o que a tela monta: array de partes filtrado por Boolean
    const registroNovo = { hora: '09:15', fornecedor: undefined, nf: undefined, quantidade: undefined, validade: '30/09/2026', temperatura: '4.2', conservacao: undefined };
    const partes = [
      registroNovo.hora, registroNovo.fornecedor, registroNovo.nf ? `NF ${registroNovo.nf}` : null, registroNovo.quantidade,
      registroNovo.validade ? `Val. ${registroNovo.validade}` : null,
      registroNovo.temperatura ? `${registroNovo.temperatura}°C` : null,
      registroNovo.conservacao ? ({ resfriado: 'Resfriado', congelado: 'Congelado', ambiente: 'Ambiente' }[registroNovo.conservacao] ?? registroNovo.conservacao) : null,
    ].filter(Boolean).join(' · ');
    expect(partes).toBe('09:15 · Val. 30/09/2026 · 4.2°C');
  });

  it('registro ANTIGO (sem hora, com fornecedor/nf/quantidade/conservação) continua aparecendo por inteiro', () => {
    const registroAntigo = { hora: undefined, fornecedor: 'Distribuidora ABC', nf: '4521', quantidade: '10 kg', validade: '15/09/2026', temperatura: '3.8', conservacao: 'resfriado' };
    const partes = [
      registroAntigo.hora, registroAntigo.fornecedor, registroAntigo.nf ? `NF ${registroAntigo.nf}` : null, registroAntigo.quantidade,
      registroAntigo.validade ? `Val. ${registroAntigo.validade}` : null,
      registroAntigo.temperatura ? `${registroAntigo.temperatura}°C` : null,
      registroAntigo.conservacao ? ({ resfriado: 'Resfriado', congelado: 'Congelado', ambiente: 'Ambiente' }[registroAntigo.conservacao] ?? registroAntigo.conservacao) : null,
    ].filter(Boolean).join(' · ');
    expect(partes).toBe('Distribuidora ABC · NF 4521 · 10 kg · Val. 15/09/2026 · 3.8°C · Resfriado');
  });
});

describe('repository — hora chega na nuvem e volta', () => {
  it('a fonte grava hora em recvToRow e lê de volta em recvFromRow', () => {
    const repo = readFileSync(`${process.cwd()}/src/repository.js`, 'utf8');
    expect(repo).toContain('hora: r.hora ?? null');
    expect(repo).toContain('hora: row.hora');
  });

  it('o schema do setup do zero (Configurações → SQL) já cria a coluna hora', () => {
    const repo = readFileSync(`${process.cwd()}/src/repository.js`, 'utf8');
    const ini = repo.indexOf('create table if not exists receiving_records');
    const fim = repo.indexOf(');', ini);
    expect(repo.slice(ini, fim)).toContain('hora text');
  });

  it('existe migração idempotente pra quem já tem a tabela, com o check de projeto obrigatório', () => {
    const sql = readFileSync(`${process.cwd()}/docs/receiving-hora.sql`, 'utf8');
    expect(sql).toContain('select current_database()');
    expect(sql).toContain('add column if not exists hora text');
  });
});

describe('dossiê fiscal não fica com coluna eternamente vazia', () => {
  it('ganha a coluna Hora ao lado de Fornecedor', () => {
    const s = sectionReceiving([{ hora: '08:40', fornecedor: 'Distribuidora ABC', produto: 'Queijo', resultado: 'aceito', createdAt: '2026-09-21T10:00:00Z' }]);
    expect(s.headers).toEqual(['Hora', 'Fornecedor', 'Produto', 'Data', 'Resultado', 'Motivo / ressalva']);
    expect(s.rowsHtml).toContain('08:40');
    expect(s.rowsHtml).toContain('Distribuidora ABC');
  });

  it('registro novo sem fornecedor não quebra a linha — célula fica vazia', () => {
    const s = sectionReceiving([{ hora: '08:40', produto: 'Queijo', resultado: 'aceito', createdAt: '2026-09-21T10:00:00Z' }]);
    expect(s.rowsHtml).toContain('<td></td>');
    expect(s.rowsHtml).toContain('08:40');
  });
});

describe('Central de Não-Conformidades não depende de fornecedor', () => {
  it('recebimento rejeitado sem fornecedor ainda vira item pendente (cai no produto)', () => {
    const out = pendingReceivingItems([{ id: 'r1', produto: 'Queijo Minas', resultado: 'rejeitado', motivoRejeicao: 'Embalagem violada', createdAt: 'x' }]);
    expect(out).toHaveLength(1);
    expect(out[0].sourceLabel).toContain('Queijo Minas');
  });
});
