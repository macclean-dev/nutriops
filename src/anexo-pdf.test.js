import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { campoAceitaPdf, anexoEhPdf } from './forms.jsx';
import { buildPhotoPath, PDF_MIME, LIMITE_ANEXO_BYTES } from './repository';

// ─────────────────────────────────────────────────────────────────────────────
// Defeito achado na pesquisa de 03/10: desde a v1.9.134 o comprovante de
// dedetização e o laudo do reservatório dizem "(foto ou PDF)", mas o campo só
// abria a câmera (accept="image/*") e o bucket só aceitava imagem. Quem tinha
// o laudo em PDF não tinha como anexar.
// ─────────────────────────────────────────────────────────────────────────────

const forms = readFileSync(`${process.cwd()}/src/forms.jsx`, 'utf8');

describe('quais campos aceitam PDF', () => {
  it('os três rótulos que prometem PDF', () => {
    expect(campoAceitaPdf({ label: 'Comprovante de dedetização (foto ou PDF)' })).toBe(true);
    expect(campoAceitaPdf({ label: 'Comprovante / laudo (foto ou PDF)' })).toBe(true);
  });

  it('os rótulos que prometem PDF existem de verdade nas planilhas do seed', () => {
    expect(forms).toContain("'Comprovante de dedetização (foto ou PDF)'");
    expect(forms).toContain("label:'Comprovante / laudo (foto ou PDF)'");
  });

  it('campo de foto comum continua só foto (câmera direto, sem seletor de arquivo)', () => {
    expect(campoAceitaPdf({ label: 'Foto (opcional)' })).toBe(false);
    expect(campoAceitaPdf({ label: 'Evidência fotográfica' })).toBe(false);
    expect(campoAceitaPdf({})).toBe(false);
    expect(campoAceitaPdf(null)).toBe(false);
  });

  it('a tela passa a regra pro campo', () => {
    expect(forms).toContain('aceitaPdf={campoAceitaPdf(field)}');
  });
});

describe('o anexo sabe se é PDF', () => {
  it('pelo tipo gravado ou pela extensão', () => {
    expect(anexoEhPdf({ path: 'swiss/f/p/c-abc.pdf' })).toBe(true);
    expect(anexoEhPdf({ path: 'swiss/f/p/c-abc', tipo: 'pdf' })).toBe(true);
  });

  it('foto antiga, sem `tipo`, continua foto', () => {
    expect(anexoEhPdf({ path: 'swiss/f/p/c-abc.jpg', at: '2026-08-07' })).toBe(false);
    expect(anexoEhPdf(null)).toBe(false);
  });
});

describe('caminho e envio', () => {
  const meta = { tenantId: 'swiss', formId: 'ded', periodKey: '2026-10', fieldId: 'ded-foto' };

  it('PDF ganha extensão .pdf; foto segue .jpg (padrão, nada muda pra quem já chamava)', () => {
    expect(buildPhotoPath({ ...meta, ext: 'pdf' })).toMatch(/^swiss\/ded\/2026-10\/ded-foto-[a-z0-9]+\.pdf$/);
    expect(buildPhotoPath(meta)).toMatch(/\.jpg$/);
  });

  it('extensão desconhecida não passa: vira .jpg', () => {
    expect(buildPhotoPath({ ...meta, ext: 'exe' })).toMatch(/\.jpg$/);
  });

  it('tipo e limite batem com o bucket (docs/form-photos-pdf.sql)', () => {
    const sql = readFileSync(`${process.cwd()}/docs/form-photos-pdf.sql`, 'utf8');
    expect(PDF_MIME).toBe('application/pdf');
    expect(sql).toContain("'application/pdf'");
    expect(LIMITE_ANEXO_BYTES).toBe(5242880);
    expect(sql).toContain('5242880');
  });

  it('PDF vai sem passar por reduzirFoto, com aviso de tamanho antes de enviar', () => {
    const ini = forms.indexOf('const escolher = async (file) => {');
    const b = forms.slice(ini, forms.indexOf('setSub(false);', ini));
    const ramoPdf = b.slice(b.indexOf('if (file.type === m.PDF_MIME)'), b.indexOf('} else {'));
    expect(ramoPdf).toContain('m.LIMITE_ANEXO_BYTES');
    expect(ramoPdf).toContain('m.uploadFormPhoto(tenantId, file,');
    expect(ramoPdf).not.toContain('reduzirFoto');
    expect(ramoPdf).toContain("tipo: 'pdf'");
  });

  it('o SQL novo só mexe nos tipos do bucket, não recria regra de acesso', () => {
    const sql = readFileSync(`${process.cwd()}/docs/form-photos-pdf.sql`, 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(sql).not.toMatch(/create policy|drop policy/i);
    expect(sql).toMatch(/select current_database\(\)/);
  });
});
