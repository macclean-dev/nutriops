import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getTemperatureRepository } from './repository';
import { resolveLimits as resolveTemperatureLimits, resolveTone as resolveTemperatureTone, suspectMissingMinus } from './limits';
import { readOperator } from './operator';
import { OperatorPicker, readStaff } from './operator-picker';
import { BrandLockup } from './brand';
import { writeKioskConfig } from './kiosk-config';
import { ordenarPorSetor, agruparPorSetor } from './setores';

// ─── Helpers ───────────────────────────────────────────────────────────────

function fmtTime() {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// ─── Numpad ────────────────────────────────────────────────────────────────

function Numpad({ value, onChange, onConfirm, onBlocked, label, hint, tone, confirmDisabled = false }) {
  const handleKey = (k) => {
    if (k === '⌫') { onChange(value.slice(0, -1)); return; }
    if (k === '.' && value.includes('.')) return;
    // O menos vira ALTERNADOR de sinal, em vez de só valer com o campo vazio.
    // Antes, quem digitasse "18" e depois tentasse o menos não conseguia mais:
    // a tecla era ignorada em silêncio e a leitura ia positiva pro banco
    // (bug da CASA DOCE, 14/08 — freezer gravado como +18°C).
    if (k === '-') { onChange(value.startsWith('-') ? value.slice(1) : `-${value}`); return; }
    if (value.length >= 6) return;
    onChange(value + k);
  };

  const keys = [['7','8','9'],['4','5','6'],['1','2','3'],['-','0','.'],['⌫','','✓']];
  const bgTone = tone === 'ok' ? '#dafbe1' : tone === 'warn' ? '#fdf8e3' : tone === 'danger' ? '#ffebe9' : 'white';
  const colorTone = tone === 'ok' ? '#00a35c' : tone === 'warn' ? '#8a4e00' : tone === 'danger' ? '#c0392b' : '#001e2b';

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12, alignItems:'center' }}>
      {/* Display */}
      <div style={{ width:'100%', padding:'16px 20px', background: bgTone, border:`2px solid ${tone==='ok'?'#4ac26b':tone==='warn'?'#e3aa14':tone==='danger'?'#ff8182':'#c1ccd6'}`, borderRadius:16, textAlign:'center', transition:'all .2s' }}>
        <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:'#5c6c7a', marginBottom:4 }}>{label}</div>
        <div style={{ fontSize:56, fontWeight:800, fontFamily:'monospace', color: colorTone, lineHeight:1, minHeight:64 }}>
          {value || <span style={{ color:'#c1ccd6' }}>–</span>}
          {value && <span style={{ fontSize:28, fontWeight:400 }}>°C</span>}
        </div>
        {hint && <div style={{ fontSize:13, color:'#5c6c7a', marginTop:4 }}>{hint}</div>}
      </div>

      {/* Keys */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, width:'100%' }}>
        {keys.flat().map((k, i) => {
          if (k === '') return <div key={i} />;
          const isConfirm = k === '✓';
          const isClear   = k === '⌫';
          const confirmBlocked = isConfirm && confirmDisabled;
          return (
            <button key={i} onClick={() => {
                // ⚠️ O ✓ bloqueado NUNCA pode ficar mudo (CASA DOCE, 17/08). Ele
                // ficava cinza mas `disabled` era false: rodava a animação de
                // toque, o dedo sentia que apertou, e não gravava nada. Numa
                // leitura crítica — justo a que mais importa registrar — a
                // pessoa media, o número sumia, e a conclusão era "o quiosque
                // não registra". Agora ele diz o que falta.
                if (k === '✓') { confirmDisabled ? onBlocked?.() : onConfirm(); return; }
                handleKey(k);
              }}
              style={{
                height: 68, borderRadius: 14, border: 'none',
                cursor: confirmBlocked ? 'not-allowed' : 'pointer',
                fontSize: isConfirm ? 28 : isClear ? 22 : 28,
                fontWeight: 700,
                background: confirmBlocked ? '#c1ccd6' : isConfirm ? '#00a35c' : isClear ? '#ffebe9' : 'white',
                color: isConfirm ? 'white' : isClear ? '#c0392b' : '#001e2b',
                boxShadow: '0 2px 4px rgba(0,0,0,.08)',
                transition: 'transform .1s, background .1s',
                fontFamily: 'inherit',
              }}
              onMouseDown={e => { if (!confirmBlocked) e.currentTarget.style.transform='scale(.95)'; }}
              onMouseUp={e => e.currentTarget.style.transform='scale(1)'}
              onTouchStart={e => { if (!confirmBlocked) e.currentTarget.style.transform='scale(.95)'; }}
              onTouchEnd={e => e.currentTarget.style.transform='scale(1)'}
            >
              {k}
            </button>
          );
        })}
      </div>
    </div>
  );
}


// ─── Semear leituras do dia (evita duplicata no quiosque) ──────────────────
// Puro e testável de propósito: sem isso, um equipamento medido de manhã por
// outra pessoa/sessão aparecia como pendente à tarde, convidando duplicata.
export function seedSavedValuesFromToday(records, nowMs = Date.now()) {
  const todayMs = new Date(nowMs).setHours(0, 0, 0, 0);
  const seeded = {}, seededAt = {};
  for (const r of records ?? []) {
    const ts = new Date(r.createdAt).getTime();
    if (!Number.isFinite(ts) || ts < todayMs) continue;
    if (!(r.equipment in seededAt) || ts > seededAt[r.equipment]) {
      seeded[r.equipment] = r.value;
      seededAt[r.equipment] = ts;
    }
  }
  return seeded;
}

// Abre direto no primeiro card pendente em vez do índice 0 (que pode já
// estar feito por outra pessoa) — só quando ninguém navegou manualmente
// nesse meio tempo, pra não brigar com o toque da pessoa.
export function firstPendingIndexIfUntouched(catalog, seeded, currentIdx) {
  if (currentIdx !== 0 || seeded[catalog[0]?.label] === undefined) return currentIdx;
  const idx = catalog.findIndex((eq) => seeded[eq.label] === undefined);
  return idx === -1 ? currentIdx : idx;
}

// ─── Equipment card ────────────────────────────────────────────────────────

function EquipmentCard({ item, saved, active, onClick }) {
  const tone = saved ? 'ok' : active ? 'active' : 'idle';
  const bg    = tone==='ok' ? '#dafbe1' : tone==='active' ? 'rgba(29,78,137,.10)' : 'white';
  const border= tone==='ok' ? '#4ac26b' : tone==='active' ? 'rgba(29,78,137,.4)' : '#c1ccd6';
  const color = tone==='ok' ? '#00a35c' : tone==='active' ? '#1d4e89' : '#001e2b';

  return (
    <button onClick={onClick} style={{ padding:'14px 16px', borderRadius:14, border:`2px solid ${border}`, background:bg, cursor:'pointer', textAlign:'left', transition:'all .15s', fontFamily:'inherit', position:'relative' }}>
      <div style={{ fontSize:15, fontWeight:700, color }}>{item.label}</div>
      <div style={{ fontSize:11, color:'#5c6c7a', marginTop:2 }}>{item.location || 'Sem localização'}</div>
      {saved && <span style={{ position:'absolute', top:8, right:10, fontSize:12, fontWeight:800, color:'#00a35c' }}>✓✓</span>}
    </button>
  );
}

// ─── Success overlay ───────────────────────────────────────────────────────

// Antes travava a tela por 2,5s sem jeito de pular — numa rodada de 44
// equipamentos (CASA DOCE) isso soma quase 2 minutos parado só nesta tela.
// Agora um toque dispensa na hora, e o automático também encurtou.
function SuccessOverlay({ temperature, equipment, tone, onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 1100);
    return () => clearTimeout(t);
  }, [onDismiss]);

  const bg    = tone==='ok' ? '#00a35c' : tone==='warn' ? '#8a4e00' : '#c0392b';
  const label = tone==='ok' ? 'Dentro da faixa' : tone==='warn' ? 'Desvio leve' : 'Fora da faixa';
  const icon  = tone==='ok' ? '✓' : '⚠';

  return (
    <div onClick={onDismiss} style={{ position:'fixed', inset:0, background:`${bg}ee`, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', zIndex:100, gap:16, cursor:'pointer' }}>
      <div style={{ fontSize:80, color:'white' }}>{icon}</div>
      <div style={{ fontSize:32, fontWeight:800, color:'white' }}>{temperature}°C</div>
      <div style={{ fontSize:18, color:'rgba(255,255,255,.9)' }}>{equipment} — {label}</div>
      <div style={{ fontSize:14, color:'rgba(255,255,255,.7)', marginTop:8 }}>Registro salvo · toque para continuar</div>
    </div>
  );
}

// ─── Kiosk App ─────────────────────────────────────────────────────────────

export function KioskApp({ config, onExit }) {
  const repository = useMemo(() => getTemperatureRepository(), []);
  // Ordenado por setor: a grade sai agrupada E o avanço automático anda dentro
  // do mesmo setor, em vez de pular de área a cada leitura.
  const catalog = useMemo(() => ordenarPorSetor(config.equipmentCatalog ?? []), [config.equipmentCatalog]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [value, setValue]         = useState('');
  // Observação — só existe/importa quando a leitura é 'danger' (item 16 da
  // revisão). Reseta a cada equipamento pra não vazar nota de um card pro
  // outro; ok/warn continuam salvando note:'' como sempre salvaram.
  const [note, setNote]           = useState('');
  const [insistiuPositivo, setInsistiuPositivo] = useState(false);
  // Aviso de "por que o ✓ não gravou". Fica ACIMA do teclado de propósito: a
  // observação obrigatória era renderizada lá embaixo (y≈644-723) e em tablet
  // na horizontal ficava cortada — a pessoa não via o que o app pedia.
  const [avisoBloqueio, setAvisoBloqueio] = useState(null);
  const [savedValues, setSavedValues] = useState({});
  const [saving, setSaving]       = useState(false);
  const [successData, setSuccessData] = useState(null);
  const [exitAttempts, setExitAttempts] = useState(0);
  const [currentTime, setCurrentTime] = useState(fmtTime());

  // Operador do quiosque. Antes o nome era congelado na ABERTURA (config.userName)
  // e todas as leituras do dia saíam carimbadas em quem abriu o tablet — mesmo
  // que outras cinco pessoas medissem depois. O quiosque é, por definição, o
  // aparelho compartilhado: quem mede é quem toca no próprio nome.
  const tenantForStaff = { id: config.tenantId, name: config.tenantName };
  const [operator, setOperator] = useState(() => readOperator(config.tenantId)?.name ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Sem lista de equipe cadastrada não dá pra escolher ninguém — cai no nome de
  // quem abriu, pra não travar a loja fora do registro sanitário.
  const staffCount = useMemo(() => readStaff(tenantForStaff).length, [config.tenantId]);
  const grupos = useMemo(() => agruparPorSetor(catalog), [catalog]);
  const precisaEscolher = !operator && staffCount > 0;
  const autorAtual = operator ?? config.userName ?? 'Quiosque';

  useEffect(() => {
    const t = setInterval(() => {
      setCurrentTime(fmtTime());
      // Antes o operador só era lido 1x, no mount — um tablet que fica aberto
      // o dia inteiro nunca reexibia o seletor, mesmo passadas as 6h do TTL
      // ou a virada do dia. readOperator já sabe dizer "expirou" (devolve
      // null); só faltava perguntar de novo de vez em quando.
      setOperator(readOperator(config.tenantId)?.name ?? null);
    }, 10000);
    return () => clearInterval(t);
  }, [config.tenantId]);

  // Semeia com o que já foi registrado HOJE (por qualquer pessoa, em
  // qualquer sessão) — sem isso, um equipamento medido de manhã aparecia
  // como pendente à tarde, convidando duplicata. `savedValues` guarda só o
  // essencial pro card ficar marcado; o valor em si não é reexibido em
  // lugar nenhum, então não precisa (nem pode, com segurança) reconciliar
  // tipo string-vs-number com o que vem do banco.
  // `semente` faz o efeito abaixo rodar de novo a cada 2 min — sem isso o
  // tablet em modo quiosque semeava UMA vez, no mount, e passava o dia inteiro
  // sem saber do que foi medido nos outros aparelhos (relato da CASA DOCE,
  // 17/08: 2 tablets + 3 computadores, nada se atualizava entre eles).
  const [semente, setSemente] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') setSemente((n) => n + 1);
    }, 120000);
    const aoVoltar = () => { if (document.visibilityState === 'visible') setSemente((n) => n + 1); };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', aoVoltar); };
  }, []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const recs = await repository.list({ tenantId: config.tenantId, days: 1 });
        const seeded = seedSavedValuesFromToday(recs);
        if (!vivo || !Object.keys(seeded).length) return;
        setSavedValues(prev => ({ ...seeded, ...prev }));
        // Abre direto no primeiro pendente em vez do card 0, que pode já
        // estar feito — só se ninguém navegou manualmente nesse meio tempo.
        setActiveIdx(prevIdx => firstPendingIndexIfUntouched(catalog, seeded, prevIdx));
      } catch { /* sem isso o quiosque mostra tudo pendente — pior é travar */ }
    })();
    return () => { vivo = false; };
  }, [config.tenantId, repository, catalog, semente]);

  const active = catalog[activeIdx];
  const limits = resolveTemperatureLimits(active?.label ?? '', active);
  // ⚠️ `value` é STRING do teclado: '-' e '.' sozinhos são truthy mas viram NaN.
  // Digitar -18 e apagar dois dígitos deixa '-'; o ✓ estava vivo, gravava NaN,
  // o JSON virava value:null, o banco recusava (23502) e o registro ia pra fila
  // offline ONDE NUNCA IA SUBIR — entupindo a fila pra sempre, com a tela
  // dizendo "Registro salvo". (CASA DOCE, 17/08.)
  const numero = Number(value);
  const numeroValido = value !== '' && Number.isFinite(numero);
  const tone   = numeroValido ? resolveTemperatureTone(value, limits.min, limits.max) : 'neutral';
  const noteRequired = tone === 'danger';
  const noteMissing   = noteRequired && !note.trim();
  // Sinal trocado: a tecla − existia mas só valia com o campo vazio, então
  // "18" + − ficava +18 e ia pro banco (CASA DOCE, 14/08). Aqui a leitura
  // trava até resolver — corrigir num toque ou confirmar que o positivo é real.
  const faltouMenos = numeroValido && suspectMissingMinus(numero, limits.min, limits.max);
  const bloqueadoPeloSinal = faltouMenos && !insistiuPositivo;
  const numeroIncompleto = value !== '' && !numeroValido;

  // O motivo do bloqueio, em português, pro toque no ✓ nunca ser mudo.
  const motivoBloqueio = numeroIncompleto
    ? 'Número incompleto — digite o valor da temperatura.'
    : bloqueadoPeloSinal
      ? `Confirme o sinal: ${active?.label ?? 'este equipamento'} não deveria marcar positivo. Toque em "Corrigir para ${-Math.abs(numero)}°" ou confirme que o positivo é real.`
      : noteMissing
        ? 'Escreva a observação antes de salvar — a leitura está fora da faixa e a RDC exige a ação registrada.'
        : null;

  useEffect(() => { if (!motivoBloqueio) setAvisoBloqueio(null); }, [motivoBloqueio]);

  const handleConfirm = useCallback(async () => {
    if (!value || !active || saving) return;
    if (!Number.isFinite(Number(value))) return;   // '-' ou '.' sozinho — nunca grava NaN
    if (suspectMissingMinus(Number(value), limits.min, limits.max) && !insistiuPositivo) return;
    const currentTone = resolveTemperatureTone(value, limits.min, limits.max);
    // RDC 216 espera a ação anotada quando o desvio é crítico (item 16 da
    // revisão) — o botão ✓ já vem desabilitado nesse caso (Numpad
    // confirmDisabled), isto aqui é só a segunda trava de segurança.
    if (currentTone === 'danger' && !note.trim()) return;
    // Guarda contra erro de digitação (ex.: freezer a -19°C lançado como 19°C):
    // valor bem fora da faixa cadastrada pede confirmação antes de gravar.
    // Vem DEPOIS da observação de propósito — primeiro escreve o que
    // aconteceu, só depois confirma que o número em si é real.
    if (currentTone === 'danger') {
      const proceed = window.confirm(`${value}°C está bem fora da faixa esperada para ${active.label} (${limits.min}° a ${limits.max}°C).\n\nConfira se não é erro de digitação (ex.: sinal de negativo esquecido). Confirma o registro assim mesmo?`);
      if (!proceed) return;
    }
    setSaving(true);
    try {
      const payload = {
        tenantId: config.tenantId, tenantName: config.tenantName,
        equipmentInput: active.label, equipmentKey: active.label,
        equipmentLocation: active.location ?? null,
        user: autorAtual, role: config.userRole ?? 'Colaborador',
        equipment: active.label, measuredAt: fmtTime(), controlMode: 'routine',
        value: Number(value), note: currentTone === 'danger' ? note.trim() : '',
        min: limits.min, max: limits.max,
      };
      await repository.create(payload);
      setSavedValues(prev => ({ ...prev, [active.label]: value }));
      // O avanço pro próximo pendente acontece junto do dismiss do overlay
      // (automático ou por toque) — um só relógio, não dois desencontrados.
      const next = catalog.findIndex((eq, i) => i > activeIdx && !savedValues[eq.label]);
      setSuccessData({ temperature: value, equipment: active.label, tone: currentTone, next: next === -1 ? null : next });
      setValue(''); setNote(''); setInsistiuPositivo(false);
    } finally { setSaving(false); }
  }, [value, note, insistiuPositivo, active, saving, config, limits, repository, catalog, activeIdx, savedValues, autorAtual]);

  const allSaved = catalog.every(eq => savedValues[eq.label]);
  const savedCount = Object.keys(savedValues).length;

  const handleExit = () => {
    if (exitAttempts < 2) { setExitAttempts(e => e + 1); return; }
    onExit();
  };

  return (
    <div style={{ minHeight:'100vh', background:'#f9fbfa', fontFamily:'-apple-system, "Segoe UI", system-ui, sans-serif', userSelect:'none' }}>
      {successData && (
        <SuccessOverlay {...successData} onDismiss={() => {
          if (successData.next !== null) setActiveIdx(successData.next);
          setSuccessData(null);
        }} />
      )}

      {/* Abertura do turno / troca de pessoa no tablet */}
      {(precisaEscolher || pickerOpen) && (
        <OperatorPicker tenant={tenantForStaff} required={precisaEscolher}
          onPick={(nome) => { setOperator(nome); setPickerOpen(false); }}
          onCancel={() => setPickerOpen(false)} />
      )}

      {/* Header */}
      <div style={{ background:'#001e2b', padding:'14px 20px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ display:'flex', alignItems:'center', gap:14 }}>
          <BrandLockup size="sm" idPrefix="kiosk" showSub={false} />
          <span style={{ fontSize:11, color:'#a8b3bc', letterSpacing:'.06em', textTransform:'uppercase' }}>
            {config.tenantName}
          </span>
          {/* Quem está medindo — visível e trocável a qualquer momento, senão
              a pessoa seguinte registra sem perceber no nome da anterior. */}
          <button onClick={() => setPickerOpen(true)}
            style={{ display:'flex', alignItems:'center', gap:8, background:'rgba(0,237,100,.12)', border:'1px solid rgba(0,237,100,.35)', color:'#dffbe9', borderRadius:20, padding:'5px 12px', cursor:'pointer', fontSize:12, fontFamily:'inherit' }}>
            <strong style={{ fontWeight:700 }}>{autorAtual}</strong>
            <span style={{ opacity:.7, fontSize:11 }}>trocar</span>
          </button>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontSize:22, fontWeight:700, fontFamily:'monospace', color:'#f4f7f6' }}>{currentTime}</div>
            <div style={{ fontSize:10, color:'#a8b3bc' }}>{savedCount}/{catalog.length} registrados</div>
          </div>
          <button onClick={handleExit} style={{ background:'rgba(255,255,255,.08)', border:'1px solid rgba(255,255,255,.12)', color:'#a8b3bc', borderRadius:8, padding:'6px 10px', cursor:'pointer', fontSize:11, fontFamily:'inherit' }}>
            {exitAttempts === 0 ? 'Sair' : exitAttempts === 1 ? 'Confirmar?' : 'Sair agora'}
          </button>
        </div>
      </div>

      {allSaved ? (
        /* All done screen */
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'calc(100vh - 57px)', gap:16, padding:24 }}>
          <div style={{ fontSize:72, color:'#00a35c' }}>✓</div>
          <h2 style={{ fontSize:28, fontWeight:800, letterSpacing:'-.03em', color:'#00a35c' }}>Todos os registros concluídos!</h2>
          <p style={{ color:'#5c6c7a', fontSize:15 }}>Todos os {catalog.length} equipamentos foram registrados com sucesso.</p>
          <button onClick={() => { setSavedValues({}); setActiveIdx(0); setValue(''); }}
            style={{ marginTop:8, padding:'12px 28px', background:'#00684a', color:'white', border:'none', borderRadius:12, fontSize:16, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
            Iniciar novo registro
          </button>
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 340px', gap:0, minHeight:'calc(100vh - 57px)' }}>
          {/* Left: Equipment list */}
          <div style={{ padding:20, borderRight:'1px solid #e2e8f0', overflowY:'auto' }}>
            <div style={{ fontSize:12, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:'#5c6c7a', marginBottom:12 }}>
              Equipamentos — {config.tenantName}
            </div>
            {grupos.map(({ setor, itens }) => {
              const feitos = itens.filter(({ item }) => savedValues[item.label]).length;
              return (
                <div key={setor} style={{ marginBottom:18 }}>
                  {/* Cabeçalho de setor só quando há mais de um — com um setor
                      só, o título seria ruído acima de uma lista óbvia. */}
                  {grupos.length > 1 && (
                    <div style={{ display:'flex', alignItems:'baseline', gap:8, marginBottom:8, paddingBottom:5, borderBottom:'1px solid #e2e8f0' }}>
                      <span style={{ fontSize:13, fontWeight:800, color:'#001e2b' }}>{setor}</span>
                      <span style={{ fontSize:11, fontWeight:600, color: feitos === itens.length ? '#00a35c' : '#5c6c7a' }}>
                        {feitos}/{itens.length}{feitos === itens.length ? ' ✓' : ''}
                      </span>
                    </div>
                  )}
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(180px,1fr))', gap:10 }}>
                    {itens.map(({ item, i }) => (
                      <EquipmentCard key={item.label} item={item} saved={Boolean(savedValues[item.label])} active={i===activeIdx} onClick={() => { setActiveIdx(i); setValue(''); setNote(''); setInsistiuPositivo(false); }} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right: Numpad */}
          <div style={{ padding:20, background:'#f8fafc' }}>
            <div style={{ fontSize:12, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:'#5c6c7a', marginBottom:12 }}>
              Registrar temperatura
            </div>
            <Numpad
              value={value}
              onChange={setValue}
              onConfirm={handleConfirm}
              label={active?.label ?? '—'}
              hint={`Faixa: ${limits.min}°C a ${limits.max}°C${active?.location ? ` · ${active.location}` : ''}`}
              tone={tone}
              confirmDisabled={noteMissing || bloqueadoPeloSinal || numeroIncompleto}
              onBlocked={() => setAvisoBloqueio(motivoBloqueio)}
            />
            {avisoBloqueio && (
              <div role="alert" aria-live="assertive" style={{
                marginBottom:12, padding:'14px 16px', borderRadius:12,
                background:'#ffebe9', border:'2px solid #c0392b',
                display:'flex', alignItems:'flex-start', gap:10,
              }}>
                <span style={{ fontSize:20, lineHeight:1 }}>⚠</span>
                <div>
                  <strong style={{ fontSize:15, color:'#c0392b', display:'block', marginBottom:2 }}>Ainda não salvou</strong>
                  <span style={{ fontSize:14, color:'#5c6c7a' }}>{avisoBloqueio}</span>
                </div>
              </div>
            )}
            {faltouMenos && (
              <div role="alert" style={{ marginTop:12, padding:'12px 14px', borderRadius:10, background:'#fdf8e3', border:'1.5px solid #e3aa14' }}>
                <strong style={{ fontSize:14, color:'#8a4e00', display:'block', marginBottom:4 }}>Faltou o sinal de menos?</strong>
                <span style={{ fontSize:13, color:'#5c6c7a', display:'block', marginBottom:10 }}>
                  {active?.label} trabalha entre {limits.min}° e {limits.max}°C. Você quis dizer <strong>−{value}°C</strong>?
                </span>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                  <button onClick={() => { setValue(`-${value}`); setInsistiuPositivo(false); }}
                    style={{ flex:'1 1 auto', padding:'12px 16px', borderRadius:10, border:'none', background:'#00684a', color:'white', fontSize:15, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
                    Sim, corrigir para −{value}°C
                  </button>
                  <button onClick={() => setInsistiuPositivo(true)}
                    style={{ flex:'1 1 auto', padding:'12px 16px', borderRadius:10, border:'1.5px solid #e3aa14', background:'transparent', color:'#8a4e00', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
                    Não, foi +{value}°C mesmo
                  </button>
                </div>
              </div>
            )}
            {/* Fora da faixa exige a ação anotada (item 16 da revisão) — só
                aparece quando precisa, pra não pesar a leitura ok/warn, que é
                a maioria da rodada. */}
            {noteRequired && (
              <div style={{ marginTop:12 }}>
                <label style={{ fontSize:12, fontWeight:700, color:'#c0392b', display:'block', marginBottom:4 }}>
                  Observação — obrigatório, fora da faixa
                </label>
                <textarea value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="Descreva a ação tomada…"
                  style={{ width:'100%', minHeight:60, padding:'10px 12px', borderRadius:10, border:'1.5px solid #ff8182', fontFamily:'inherit', fontSize:14, resize:'vertical' }} />
              </div>
            )}
            {saving && <div style={{ textAlign:'center', marginTop:12, fontSize:13, color:'#5c6c7a' }}>Salvando…</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Kiosk Setup (modal dentro do app normal) ──────────────────────────────

export function KioskSetup({ activeTenant, equipmentCatalog, session, onLaunch, onCancel }) {
  const [selectedEquips, setSelectedEquips] = useState(equipmentCatalog.map(e => e.label));
  const ordenado = useMemo(() => ordenarPorSetor(equipmentCatalog), [equipmentCatalog]);
  const grupos   = useMemo(() => agruparPorSetor(ordenado), [ordenado]);

  const toggle = (label) => setSelectedEquips(prev =>
    prev.includes(label) ? prev.filter(l => l !== label) : [...prev, label]
  );

  // Marcar/desmarcar um setor inteiro. É o motivo de existir esta tela pra quem
  // trabalha numa área só: em vez de tocar 13 vezes pra montar o quiosque da
  // Padaria, desmarca "todos" e marca Padaria.
  const toggleSetor = (itens) => {
    const labels = itens.map(({ item }) => item.label);
    const todosMarcados = labels.every((l) => selectedEquips.includes(l));
    setSelectedEquips(prev => todosMarcados
      ? prev.filter((l) => !labels.includes(l))
      : [...new Set([...prev, ...labels])]);
  };

  const launch = () => {
    const cfg = {
      tenantId: activeTenant.id,
      tenantName: activeTenant.name,
      userName: session?.user?.name ?? 'Quiosque',
      userRole: session?.user?.role ?? 'Colaborador',
      equipmentCatalog: ordenado.filter(e => selectedEquips.includes(e.label)),
    };
    writeKioskConfig(cfg);
    onLaunch(cfg);
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200, padding:24 }}>
      <div style={{ background:'white', borderRadius:16, padding:28, width:'100%', maxWidth:480, maxHeight:'85vh', display:'flex', flexDirection:'column', boxShadow:'0 24px 48px rgba(0,0,0,.2)' }}>
        <h2 style={{ fontSize:20, fontWeight:800, letterSpacing:'-.03em', marginBottom:6 }}>Modo Quiosque</h2>
        <p style={{ fontSize:13, color:'#5c6c7a', marginBottom:8 }}>Interface simplificada para tablet na loja. Selecione os equipamentos a registrar.</p>

        {/* Catálogo grande (44 da CASA DOCE) + querer só 1 setor = "desmarcar todos
            os OUTROS 11" era mais rápido que "marcar 1 a 1", mas ainda dolorido —
            pedido real da RT (13/08). "Nenhum" + "marcar setor" no setor desejado
            vira 2 toques pra isolar uma área. */}
        {equipmentCatalog.length > 0 && (
          <div style={{ display:'flex', justifyContent:'flex-end', gap:14, marginBottom:14 }}>
            <button onClick={() => setSelectedEquips(equipmentCatalog.map(e => e.label))}
              style={{ background:'none', border:'none', padding:0, fontSize:12, fontWeight:700, color:'#00684a', cursor:'pointer', fontFamily:'inherit', textDecoration:'underline' }}>
              Todos
            </button>
            <button onClick={() => setSelectedEquips([])}
              style={{ background:'none', border:'none', padding:0, fontSize:12, fontWeight:700, color:'#00684a', cursor:'pointer', fontFamily:'inherit', textDecoration:'underline' }}>
              Nenhum
            </button>
          </div>
        )}

        {/* Lista rola por dentro (flex:1 + minHeight:0) — sem isso, catálogos
            grandes (ex.: 44 equip. da CASA DOCE) empurram os botões "Cancelar"/
            "Lançar quiosque" pra fora da tela, sem jeito de rolar até eles. */}
        <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:20, overflowY:'auto', flex:1, minHeight:0 }}>
          {grupos.map(({ setor, itens }) => {
            const marcados = itens.filter(({ item }) => selectedEquips.includes(item.label)).length;
            return (
              <div key={setor}>
                {grupos.length > 1 && (
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', margin:'10px 0 6px' }}>
                    <span style={{ fontSize:12, fontWeight:800, color:'#001e2b' }}>{setor} <span style={{ fontWeight:600, color:'#5c6c7a' }}>({marcados}/{itens.length})</span></span>
                    <button onClick={() => toggleSetor(itens)}
                      style={{ background:'#f1f5f4', border:'1px solid #c1ccd6', borderRadius:20, padding:'3px 10px', fontSize:11, fontWeight:700, color:'#00684a', cursor:'pointer', fontFamily:'inherit' }}>
                      {marcados === itens.length ? 'desmarcar setor' : 'marcar setor'}
                    </button>
                  </div>
                )}
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {itens.map(({ item: eq }) => {
                    const sel = selectedEquips.includes(eq.label);
                    return (
                      <div key={eq.label} onClick={() => toggle(eq.label)} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 14px', borderRadius:10, border:`1.5px solid ${sel?'rgba(29,78,137,.4)':'#c1ccd6'}`, background:sel?'rgba(29,78,137,.10)':'white', cursor:'pointer' }}>
                        <div>
                          <div style={{ fontSize:14, fontWeight:600, color: sel?'#1d4e89':'#001e2b' }}>{eq.label}</div>
                          {eq.location && <div style={{ fontSize:11, color:'#5c6c7a' }}>{eq.location}</div>}
                        </div>
                        <span style={{ width:20, height:20, borderRadius:4, border:`2px solid ${sel?'#00684a':'#c1ccd6'}`, background:sel?'#00684a':'white', display:'grid', placeItems:'center', flexShrink:0 }}>
                          {sel && <span style={{ color:'white', fontSize:12, fontWeight:800 }}>✓</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display:'flex', gap:10 }}>
          <button onClick={onCancel} style={{ flex:1, padding:'10px', borderRadius:10, border:'1px solid #c1ccd6', background:'white', cursor:'pointer', fontSize:14, fontWeight:600, fontFamily:'inherit' }}>Cancelar</button>
          <button onClick={launch} disabled={selectedEquips.length === 0} style={{ flex:2, padding:'10px', borderRadius:10, border:'none', background: selectedEquips.length===0?'#c1ccd6':'#00684a', color:'white', cursor:selectedEquips.length===0?'not-allowed':'pointer', fontSize:14, fontWeight:700, fontFamily:'inherit' }}>
            🖥️ Lançar quiosque ({selectedEquips.length} equip.)
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// FORM KIOSK — Tablet mode for BPF forms
// ═══════════════════════════════════════════════════════════════════════════

import { readFormTemplates, readFormRecords, writeFormRecords, completionPct, getPeriodKey, catMeta, isPresenceAnswered } from './forms';
import { dueFields } from './field-frequency';

function FormKioskField({ field, value, onChange, currentName }) {
  if (field.type === 'cnc') {
    return (
      <div style={{ display:'flex', gap:12 }}>
        {['C','NC'].map(opt => {
          const on = value === opt;
          const [bg,color,border] = opt==='C' ? ['#dafbe1','#00a35c','#4ac26b'] : ['#ffebe9','#c0392b','#ff8182'];
          return (
            <button key={opt} onClick={() => onChange(on?'':opt)}
              style={{ flex:1, height:64, borderRadius:14, border:`2.5px solid ${on?border:'#c1ccd6'}`, background:on?bg:'white', color:on?color:'#94a3b8', fontWeight:800, fontSize:20, cursor:'pointer', transition:'all .12s', boxShadow:on?`0 0 0 3px ${border}44`:'none' }}>
              {opt}
            </button>
          );
        })}
      </div>
    );
  }
  if (field.type === 'presence') {
    // Mesmo bug do desktop (forms.jsx PresenceField), corrigido junto: sem
    // `answered`, os dois botões ficavam com cara de "já respondido" (um
    // sempre destacado) antes de qualquer toque real.
    const answered = isPresenceAnswered(value);
    const detected = value?.detected ?? false;
    return (
      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        <div style={{ display:'flex', gap:12 }}>
          <button onClick={() => onChange({ ...value, detected:true })}
            style={{ flex:1, height:60, borderRadius:14, border:`2.5px solid ${answered && detected?'#ff8182':'#c1ccd6'}`, background:answered && detected?'#ffebe9':'white', color:answered && detected?'#c0392b':'#94a3b8', fontWeight:700, fontSize:16, cursor:'pointer' }}>
            ✕ Detectado
          </button>
          <button onClick={() => onChange({ ...value, detected:false })}
            style={{ flex:1, height:60, borderRadius:14, border:`2.5px solid ${answered && !detected?'#4ac26b':'#c1ccd6'}`, background:answered && !detected?'#dafbe1':'white', color:answered && !detected?'#00a35c':'#94a3b8', fontWeight:700, fontSize:16, cursor:'pointer' }}>
            ✓ Sem ocorrência
          </button>
        </div>
        {answered && detected && (
          <input value={value?.location??''} onChange={e=>onChange({ ...value, location:e.target.value })}
            placeholder="Local (ex.: D=Distribuição)" style={{ width:'100%', padding:'14px', borderRadius:10, border:'1.5px solid #c1ccd6', fontSize:16, fontFamily:'inherit' }} />
        )}
      </div>
    );
  }
  if (field.type === 'date_sig') {
    const done = Boolean(value?.date || value?.sig);
    if (done) {
      return (
        <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <span style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'10px 16px', borderRadius:12, background:'#dafbe1', border:'2px solid #4ac26b', color:'#00a35c', fontSize:16, fontWeight:800 }}>
            ✓ {value.date ? value.date.split('-').reverse().join('/') : '—'} · {value.sig || '—'}
          </span>
          <button onClick={() => onChange({})} style={{ padding:'10px 16px', borderRadius:10, border:'1.5px solid #c1ccd6', background:'white', color:'#5c6c7a', fontWeight:700, fontSize:14, cursor:'pointer', fontFamily:'inherit' }}>
            Refazer
          </button>
        </div>
      );
    }
    return (
      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        <button onClick={() => onChange({ date: getPeriodKey('daily'), sig: currentName ?? '' })}
          style={{ height:64, borderRadius:14, border:'2.5px solid #4ac26b', background:'#dafbe1', color:'#00a35c', fontWeight:800, fontSize:18, cursor:'pointer', fontFamily:'inherit' }}>
          ✓ Feito agora{currentName ? ` — ${currentName}` : ''}
        </button>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          <input type="date" value={value?.date??''} onChange={e=>onChange({ ...value, date:e.target.value })}
            style={{ flex:1, minWidth:140, padding:'14px', borderRadius:10, border:'1.5px solid #c1ccd6', fontSize:16, fontFamily:'inherit' }} />
          <input value={value?.sig??''} onChange={e=>onChange({ ...value, sig:e.target.value })}
            placeholder="Ou digite: Responsável" style={{ flex:2, minWidth:180, padding:'14px', borderRadius:10, border:'1.5px solid #c1ccd6', fontSize:16, fontFamily:'inherit' }} />
        </div>
      </div>
    );
  }
  if (field.type === 'text') {
    return (
      <textarea value={value??''} onChange={e=>onChange(e.target.value)}
        placeholder="Observações…" style={{ width:'100%', padding:'14px', borderRadius:10, border:'1.5px solid #c1ccd6', fontSize:16, fontFamily:'inherit', minHeight:80, resize:'vertical' }} />
    );
  }
  // date/number/checkbox/select caíam no `return null` abaixo: no modo tablet o
  // campo simplesmente NÃO APARECIA. Já afetava planilhas em uso — Banheiros
  // (checkbox de "Realizada"), Resíduos (todos os pesos são number) e as datas
  // de Hortifrutícolas. Quem preenchia pelo tablet entregava a planilha
  // incompleta sem ver que faltava campo.
  const campoBase = { padding:'14px', borderRadius:10, border:'1.5px solid #c1ccd6', fontSize:16, fontFamily:'inherit' };
  if (field.type === 'date') {
    return <input type="date" value={value??''} onChange={e=>onChange(e.target.value)} style={{ ...campoBase, width:'100%' }} />;
  }
  if (field.type === 'number') {
    return <input type="number" inputMode="decimal" value={value??''} onChange={e=>onChange(e.target.value)}
      placeholder="0" style={{ ...campoBase, width:160, fontVariantNumeric:'tabular-nums' }} />;
  }
  if (field.type === 'checkbox') {
    const on = value === true;
    return (
      <button onClick={() => onChange(!on)}
        style={{ ...campoBase, display:'flex', alignItems:'center', gap:12, cursor:'pointer', fontWeight:700,
                 background: on ? '#dafbe1' : 'white', borderColor: on ? '#4ac26b' : '#c1ccd6', color: on ? '#00a35c' : '#001e2b' }}>
        <span style={{ width:24, height:24, borderRadius:6, border:`2px solid ${on?'#00a35c':'#c1ccd6'}`, background:on?'#00a35c':'white', display:'grid', placeItems:'center', color:'white', fontSize:15 }}>
          {on ? '✓' : ''}
        </span>
        {on ? 'Sim' : 'Marcar'}
      </button>
    );
  }
  if (field.type === 'select') {
    return (
      <select value={value??''} onChange={e=>onChange(e.target.value)} style={{ ...campoBase, width:'100%' }}>
        <option value="">Selecione…</option>
        {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (field.type === 'photo') {
    // O upload precisa do tenant/registro pra montar o caminho no Storage, e o
    // quiosque não passa esse contexto pro campo. Em vez de mostrar um botão
    // que falharia no toque, avisa onde anexar. Vale rever quando o tablet
    // virar o caminho principal da higiene pessoal.
    return (
      <div style={{ ...campoBase, background:'#f8fafc', color:'#5c6c7a', fontSize:14 }}>
        {value?.path ? '📷 Foto já anexada neste registro.' : 'Foto se anexa pelo app (fora do modo tablet).'}
      </div>
    );
  }
  return null;
}

export function FormKioskApp({ template, tenantId, tenantName, userName, userRole, initialResponses, onExit, onSave }) {
  const [responses, setResponses] = useState(() => initialResponses ?? {});
  const [sectionIdx, setSectionIdx] = useState(0);
  const [saving, setSaving]         = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [done, setDone]             = useState(false);
  const [exitAttempts, setExitAttempts] = useState(0);
  const [currentTime, setCurrentTime]   = useState(new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}));

  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})), 10000);
    return () => clearInterval(t);
  }, []);

  const section = template.sections[sectionIdx];
  const allSections = template.sections;
  const pct = completionPct(template, { responses });
  const meta = catMeta(template.category);

  const setField = (id, val) => setResponses(prev => ({ ...prev, [id]: val }));

  const handleSave = async () => {
    if (pct < 100) {
      const proceed = window.confirm(`A planilha está ${pct}% preenchida. Confirmar mesmo assim?`);
      if (!proceed) return;
    }
    setSaving(true);
    await onSave(responses, 'submitted');
    setSaving(false);
    setDone(true);
  };

  // Espelha o "Salvar rascunho" do desktop (FormFill) — sem isto, a única
  // saída do modo tablet era confirmar (mesmo incompleta) ou sair sem salvar
  // nada do que já foi preenchido.
  const handleSaveDraft = async () => {
    setSavingDraft(true);
    await onSave(responses, 'draft');
    setSavingDraft(false);
    onExit();
  };

  const handleExit = () => {
    if (exitAttempts < 2) { setExitAttempts(e => e+1); return; }
    onExit();
  };

  if (done) return (
    <div style={{ minHeight:'100vh', background:'#dafbe1', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:16, fontFamily:'-apple-system,"Segoe UI",system-ui,sans-serif' }}>
      <div style={{ fontSize:80, color:'#00a35c' }}>✓</div>
      <h2 style={{ fontSize:28, fontWeight:800, color:'#00a35c' }}>Planilha confirmada!</h2>
      <p style={{ fontSize:16, color:'#065f46' }}>{template.title}</p>
      <button onClick={onExit} style={{ marginTop:8, padding:'14px 32px', background:'#00a35c', color:'white', border:'none', borderRadius:14, fontSize:18, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
        Concluir
      </button>
    </div>
  );

  return (
    <div style={{ minHeight:'100vh', background:'#f9fbfa', fontFamily:'-apple-system,"Segoe UI",system-ui,sans-serif', userSelect:'none' }}>
      {/* Header */}
      <div style={{ background:'#001e2b', padding:'12px 20px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div>
          <div style={{ fontSize:12, color:'#a8b3bc', marginBottom:2 }}>{tenantName} · {userName}</div>
          <div style={{ fontSize:15, fontWeight:800, color:'#f4f7f6' }}>{template.title}</div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontSize:22, fontWeight:700, fontFamily:'monospace', color:'#f4f7f6' }}>{currentTime}</div>
            <div style={{ fontSize:10, color:'#a8b3bc' }}>{pct}% preenchido</div>
          </div>
          <button onClick={handleExit} style={{ background:'rgba(255,255,255,.08)', border:'1px solid rgba(255,255,255,.12)', color:'#a8b3bc', borderRadius:8, padding:'6px 10px', cursor:'pointer', fontSize:11, fontFamily:'inherit' }}>
            {exitAttempts === 0 ? 'Sair' : exitAttempts === 1 ? 'Tem certeza?' : 'Sair agora'}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ height:4, background:'#21262d' }}>
        <div style={{ height:'100%', width:`${pct}%`, background: meta.color, transition:'width .3s' }} />
      </div>

      {/* Section tabs */}
      {allSections.length > 1 && (
        <div style={{ background:'white', borderBottom:'1px solid #e2e8f0', display:'flex', padding:'0 16px', overflowX:'auto' }}>
          {allSections.map((sec, i) => (
            <button key={sec.id} onClick={() => setSectionIdx(i)} style={{ padding:'12px 16px', border:'none', borderBottom:`3px solid ${i===sectionIdx?meta.color:'transparent'}`, background:'transparent', fontSize:13, fontWeight:i===sectionIdx?700:500, color:i===sectionIdx?meta.color:'#64748b', cursor:'pointer', whiteSpace:'nowrap', fontFamily:'inherit' }}>
              {sec.title}
            </button>
          ))}
        </div>
      )}

      {/* Fields */}
      <div style={{ padding:'20px 16px', maxWidth:680, margin:'0 auto', display:'flex', flexDirection:'column', gap:20 }}>
        {dueFields(section.fields, template.frequency).map(field => (
          <div key={field.id} style={{ background:'white', borderRadius:16, padding:20, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
            <div style={{ fontSize:16, fontWeight:700, marginBottom:field.hint?6:14, color:'#001e2b' }}>{field.label}</div>
            {field.hint && <div style={{ fontSize:13, color:'#5c6c7a', marginBottom:12 }}>{field.hint}</div>}
            <FormKioskField field={field} value={responses[field.id]} onChange={v => setField(field.id, v)} currentName={userName} />
          </div>
        ))}
      </div>

      {/* Navigation footer */}
      <div style={{ position:'sticky', bottom:0, background:'white', borderTop:'1px solid #e2e8f0', padding:'12px 20px', display:'flex', justifyContent:'space-between', gap:8, alignItems:'center' }}>
        <button onClick={() => setSectionIdx(i => Math.max(0, i-1))} disabled={sectionIdx===0}
          style={{ padding:'12px 16px', borderRadius:12, border:'1px solid #c1ccd6', background:'white', fontSize:14, fontWeight:600, cursor:sectionIdx===0?'not-allowed':'pointer', opacity:sectionIdx===0?0.4:1, fontFamily:'inherit', color:'#374151' }}>
          ← Anterior
        </button>
        <button onClick={handleSaveDraft} disabled={saving || savingDraft}
          style={{ padding:'12px 14px', borderRadius:12, border:'1px solid #c1ccd6', background:'white', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit', color:'#374151', whiteSpace:'nowrap' }}>
          {savingDraft ? 'Salvando…' : 'Continuar depois'}
        </button>
        {sectionIdx < allSections.length - 1 ? (
          <button onClick={() => setSectionIdx(i => i+1)}
            style={{ flex:1, padding:'12px 24px', borderRadius:12, border:'none', background:meta.color, color:'white', fontSize:16, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
            Próxima seção →
          </button>
        ) : (
          <button onClick={handleSave} disabled={saving || savingDraft || pct === 0}
            style={{ flex:1, padding:'12px 24px', borderRadius:12, border:'none', background:pct>0?'#00a35c':'#c1ccd6', color:'white', fontSize:16, fontWeight:700, cursor:pct>0?'pointer':'not-allowed', fontFamily:'inherit' }}>
            {saving ? 'Salvando…' : `✓ Confirmar preenchimento (${pct}%)`}
          </button>
        )}
      </div>
    </div>
  );
}
