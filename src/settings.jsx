import React, { useState, useEffect } from 'react';
import { APP_VERSION } from './brand';
import {
  getSupabaseConfig, saveSupabaseConfig, isSupabaseEnabled,
  supabaseRepository, SUPABASE_SQL, migrateAllToSupabase,
  getOfflineQueue, getSyncStatus,
} from './repository';

const COMPANY_PROFILE_KEY = (tenantId) => `nutriops.company.profile.${tenantId}`;

export function readCompanyProfile(tenantId) {
  try { const r = localStorage.getItem(COMPANY_PROFILE_KEY(tenantId)); return r ? JSON.parse(r) : {}; } catch { return {}; }
}

export function saveCompanyProfile(tenantId, profile) {
  try { localStorage.setItem(COMPANY_PROFILE_KEY(tenantId), JSON.stringify(profile)); } catch {}
}

export function SettingsView({ session, activeTenant, activeTenants, tenants }) {
  const cfg = getSupabaseConfig();
  const [url,     setUrl]     = useState(cfg.url ?? '');
  const [anonKey, setAnonKey] = useState(cfg.anonKey ?? '');
  const [enabled, setEnabled] = useState(cfg.enabled ?? false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [copied,  setCopied]  = useState(false);
  const [migrating, setMigrating]     = useState(false);
  const [migrateResult, setMigrateResult] = useState(null);
  const [currentPin, setCurrentPin] = useState('');
  const [newPin,     setNewPin]     = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinMsg,     setPinMsg]     = useState(null);
  const [profile, setProfile] = useState(() => readCompanyProfile(activeTenant?.id ?? 'global'));
  const [profileSaved, setProfileSaved] = useState(false);

  useEffect(() => {
    setProfile(readCompanyProfile(activeTenant?.id ?? 'global'));
  }, [activeTenant?.id]);

  const setProfileField = (field, value) => setProfile(prev => ({ ...prev, [field]: value }));

  const handleSaveProfile = () => {
    saveCompanyProfile(activeTenant?.id ?? 'global', profile);
    setProfileSaved(true);
    setTimeout(() => setProfileSaved(false), 2500);
  };

  const handleSave = () => {
    saveSupabaseConfig({ url: url.trim(), anonKey: anonKey.trim(), enabled });
    window.location.reload();
  };

  const handleTest = async () => {
    setTesting(true); setTestResult(null);
    saveSupabaseConfig({ url: url.trim(), anonKey: anonKey.trim(), enabled: true });
    const result = await supabaseRepository.testConnection();
    setTestResult(result); setTesting(false);
  };

  const testMessage = () => {
    if (!testResult) return null;
    if (testResult.ok) return { tone:'ok', text:'✓ Conexão estabelecida! Tabela encontrada.' };
    if (testResult.reason==='table_missing') return { tone:'warn', text:'⚠ Supabase conectado, mas a tabela não existe. Copie e execute o SQL abaixo.' };
    if (testResult.reason==='auth_error')    return { tone:'danger', text:'✕ Chave inválida. Verifique o Anon Key.' };
    if (testResult.reason==='network_error') return { tone:'danger', text:'✕ Não foi possível conectar. Verifique a URL.' };
    return { tone:'danger', text:`✕ Erro (${testResult.reason}).` };
  };
  const msg = testMessage();
  const tableMissing = testResult?.reason === 'table_missing';

  const copySql = () => {
    navigator.clipboard.writeText(SUPABASE_SQL).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  const [exporting, setExporting] = useState(false);

  const handleExportBackup = () => {
    setExporting(true);
    try {
      const backup = {
        version: APP_VERSION,
        exportedAt: new Date().toISOString(),
        tenantId: activeTenant?.id,
        tenantName: activeTenant?.name,
        data: {},
      };

      const tenantId = activeTenant?.id;
      const keys = Object.keys(localStorage).filter(k =>
        k.includes(tenantId) || k.includes('nutriops.')
      );

      keys.forEach(key => {
        try { backup.data[key] = JSON.parse(localStorage.getItem(key)); } catch { backup.data[key] = localStorage.getItem(key); }
      });

      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `nutriops-backup-${tenantId}-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const handleImportBackup = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const backup = JSON.parse(ev.target.result);
        if (!backup.data) { alert('Arquivo de backup inválido.'); return; }
        if (!window.confirm(`Restaurar backup de ${backup.tenantName} (${backup.exportedAt?.slice(0,10)})?\n\nIsso vai sobrescrever os dados locais.`)) return;
        Object.entries(backup.data).forEach(([key, value]) => {
          try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
        });
        alert('✓ Backup restaurado! A página será recarregada.');
        window.location.reload();
      } catch { alert('Erro ao ler o arquivo de backup.'); }
    };
    reader.readAsText(file);
  };

  const handleMigrate = async () => {
    if (!isSupabaseEnabled()) { setMigrateResult({ tone:'warn', text:'Habilite o Supabase primeiro.' }); return; }
    setMigrating(true); setMigrateResult(null);
    try {
      const result = await migrateAllToSupabase(activeTenants);
      setMigrateResult({ tone: result.failed===0?'ok':'warn', text:`✓ ${result.pushed} registros migrados${result.failed>0?` · ${result.failed} falha(s)`:''}. Todos os módulos sincronizados.` });
    } catch (e) {
      setMigrateResult({ tone:'danger', text:`Erro na migração: ${e.message}` });
    }
    setMigrating(false);
  };

  const handleChangePin = () => {
    setPinMsg(null);
    if (!session?.user) return;
    if (newPin.length < 4) { setPinMsg({ tone:'danger', text:'PIN deve ter no mínimo 4 dígitos.' }); return; }
    if (newPin !== confirmPin) { setPinMsg({ tone:'danger', text:'Os PINs não coincidem.' }); return; }
    const tenantId = session.tenantId;
    const usersKey = `nutriops.users.${tenantId}`;
    const users = JSON.parse(localStorage.getItem(usersKey) ?? 'null') ??
      (tenants.find(t=>t.id===tenantId)?.usersList ?? []);
    const expectedPin = (users.find(u=>u.name===session.user.name)?.pin ?? '0000');
    if (currentPin !== expectedPin) { setPinMsg({ tone:'danger', text:'PIN atual incorreto.' }); return; }
    const updated = users.map(u => u.name===session.user.name ? { ...u, pin: newPin } : u);
    localStorage.setItem(usersKey, JSON.stringify(updated));
    setCurrentPin(''); setNewPin(''); setConfirmPin('');
    setPinMsg({ tone:'ok', text:'✓ PIN alterado com sucesso!' });
  };

  return (
    <section className="management-page">
      <div className="page-header"><div><span className="eyebrow">Infraestrutura</span><h1>Configurações</h1><p className="muted">Dados do estabelecimento, Supabase, migração e segurança de acesso.</p></div></div>

      <article className="management-card" style={{ marginBottom:16 }}>
        <div className="card-head">
          <div><span className="eyebrow">Identificação</span><h2>Dados do estabelecimento</h2></div>
          <span className="badge neutral">{activeTenant?.name}</span>
        </div>
        <div className="capture-fields">
          <p className="muted" style={{ fontSize:12 }}>Estes dados aparecem em todos os PDFs gerados — planilhas, relatórios, certificados e controles. Exigidos pela RDC 216/2004 para fins de fiscalização.</p>
          <div className="grid-2">
            <label>Razão social / Nome do estabelecimento
              <input value={profile.razaoSocial ?? activeTenant?.name ?? ''} onChange={e=>setProfileField('razaoSocial', e.target.value)} placeholder={activeTenant?.name} />
            </label>
            <label>CNPJ
              <input value={profile.cnpj ?? ''} onChange={e=>setProfileField('cnpj', e.target.value)} placeholder="00.000.000/0000-00" />
            </label>
          </div>
          <label>Endereço completo
            <input value={profile.endereco ?? ''} onChange={e=>setProfileField('endereco', e.target.value)} placeholder="Rua, nº, Bairro, Cidade - UF, CEP" />
          </label>
          <div className="grid-2">
            <label>Telefone
              <input value={profile.telefone ?? ''} onChange={e=>setProfileField('telefone', e.target.value)} placeholder="(61) 9xxxx-xxxx" />
            </label>
            <label>E-mail de contato
              <input value={profile.email ?? ''} onChange={e=>setProfileField('email', e.target.value)} placeholder="contato@empresa.com.br" />
            </label>
          </div>
          <div className="grid-2">
            <label>Responsável Técnico (RT)
              <input value={profile.rtNome ?? ''} onChange={e=>setProfileField('rtNome', e.target.value)} placeholder="Nome completo da nutricionista" />
            </label>
            <label>CRN do Responsável Técnico
              <input value={profile.rtCrn ?? ''} onChange={e=>setProfileField('rtCrn', e.target.value)} placeholder="Ex.: CRN-1 12345" />
            </label>
          </div>
          <div className="grid-2">
            <label>Tipo de atividade
              <input value={profile.atividade ?? activeTenant?.segment ?? ''} onChange={e=>setProfileField('atividade', e.target.value)} placeholder="Ex.: Padaria, Confeitaria, Produção de alimentos" />
            </label>
            <label>Alvará sanitário / Licença
              <input value={profile.alvara ?? ''} onChange={e=>setProfileField('alvara', e.target.value)} placeholder="Número do alvará" />
            </label>
          </div>
          <div className="actions-row" style={{ justifyContent:'flex-end' }}>
            <button className="primary-action attention" onClick={handleSaveProfile}>Salvar dados do estabelecimento</button>
          </div>
          {profileSaved && <div className="submission ok">✓ Dados salvos. Todos os PDFs usarão essas informações.</div>}
        </div>
      </article>

      <div className="management-grid">
        <article className="management-card">
          <div className="card-head"><div><span className="eyebrow">Backend</span><h2>Supabase</h2></div>
            <span className={`badge ${isSupabaseEnabled()?'ok':'neutral'}`}>{isSupabaseEnabled()?'Conectado':'Modo local'}</span>
          </div>
          <div className="capture-fields">
            <label>Project URL<input value={url} onChange={(e)=>setUrl(e.target.value)} placeholder="https://xxxx.supabase.co" /></label>
            <label>Anon Key<textarea value={anonKey} onChange={(e)=>setAnonKey(e.target.value)} placeholder="eyJ…" style={{ minHeight:72, fontFamily:'var(--mono)', fontSize:12 }} /></label>
            <label style={{ flexDirection:'row', alignItems:'center', gap:10, cursor:'pointer' }}>
              <input type="checkbox" checked={enabled} onChange={(e)=>setEnabled(e.target.checked)} />
              <span style={{ color:'var(--text)', fontWeight:600 }}>Usar Supabase como banco de dados</span>
            </label>
            <div className="actions-row">
              <button className="secondary-action" onClick={handleTest} disabled={testing||!url||!anonKey}>{testing?'Testando…':'Testar conexão'}</button>
              <button className="primary-action" onClick={handleSave}>Salvar configurações</button>
            </div>
            {msg && <div className={`submission ${msg.tone}`}>{msg.text}</div>}
          </div>
        </article>

        <article className="management-card" style={tableMissing?{borderColor:'var(--amber-border)',boxShadow:'0 0 0 3px rgba(154,103,0,.1)'}:{}}>
          <div className="card-head">
            <div><span className="eyebrow">SQL</span><h2>Schema do banco de dados</h2>
              {tableMissing && <p style={{ fontSize:12, color:'var(--amber)', fontWeight:600, marginTop:4 }}>👆 Execute este SQL no Supabase</p>}
            </div>
            <button className="secondary-action" style={{ fontSize:12 }} onClick={copySql}>{copied?'✓ Copiado!':'Copiar SQL'}</button>
          </div>
          <div style={{ padding:'12px 16px' }}>
            <p className="muted" style={{ marginBottom:12 }}>Cole no Supabase → SQL Editor → New query → Run.</p>
            <pre style={{ fontFamily:'var(--mono)', fontSize:11, background:'var(--rail-bg)', color:'#e6edf3', padding:16, borderRadius:'var(--r)', overflow:'auto', lineHeight:1.6, maxHeight:280 }}>{SUPABASE_SQL}</pre>
          </div>
        </article>
      </div>

      <article className="management-card" style={{ marginTop:16 }}>
        <div className="card-head">
          <div><span className="eyebrow">Migração</span><h2>Transferir dados locais para o Supabase</h2></div>
          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
            <span className="badge neutral">{(() => { try { return JSON.parse(localStorage.getItem('nutriops.temperature.records')||'[]').length; } catch { return 0; } })()} temperaturas</span>
            <span className="badge neutral">{getOfflineQueue().length} na fila</span>
            <span className="badge neutral" style={{ fontSize:10 }}>{(() => { const s = getSyncStatus(); return s?.lastSync ? `sync ${new Date(s.lastSync).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}` : 'sem sync'; })()}</span>
          </div>
        </div>
        <div style={{ padding:'14px 20px', display:'flex', flexDirection:'column', gap:12 }}>
          <p className="muted">Envia todos os dados locais para o Supabase: temperatura, planilhas BPF, recebimento, produtos, controles especiais e movimentações de estoque. Execute apenas uma vez após configurar o Supabase.</p>
          {!isSupabaseEnabled() && getOfflineQueue().length > 0 && (
            <div className="submission warn">
              ⚠ Há {getOfflineQueue().length} registros aguardando sincronização. Eles serão enviados automaticamente assim que o Supabase for habilitado e a página recarregar.
            </div>
          )}
          <div className="actions-row">
            <button className="primary-action" onClick={handleMigrate} disabled={migrating||!isSupabaseEnabled()}>
              {migrating ? '⏳ Migrando…' : '↑ Migrar registros locais para Supabase'}
            </button>
          </div>
          {migrateResult && <div className={`submission ${migrateResult.tone}`}>{migrateResult.text}</div>}
        </div>
      </article>

      <article className="management-card" style={{ marginTop:16 }}>
        <div className="card-head">
          <div><span className="eyebrow">Dados</span><h2>Backup e restauração</h2></div>
        </div>
        <div style={{ padding:'14px 20px', display:'flex', flexDirection:'column', gap:12 }}>
          <p className="muted">Exporte todos os dados da empresa para um arquivo JSON. Use para backup ou para migrar para outro dispositivo.</p>
          <div className="actions-row">
            <button className="secondary-action" onClick={handleExportBackup} disabled={exporting}>
              {exporting ? '⏳ Exportando…' : '↓ Exportar backup completo'}
            </button>
            <label style={{ cursor:'pointer' }}>
              <span className="secondary-action" style={{ display:'inline-block' }}>↑ Restaurar backup</span>
              <input type="file" accept=".json" onChange={handleImportBackup} style={{ display:'none' }} />
            </label>
          </div>
          <div style={{ padding:'10px 12px', background:'var(--amber-light)', border:'1px solid var(--amber-border)', borderRadius:'var(--r)', fontSize:12, color:'var(--amber)' }}>
            ⚠ Restaurar substitui os dados locais. Faça um backup antes.
          </div>
        </div>
      </article>
      <article className="management-card" style={{ marginTop:16 }}>
        <div className="card-head"><div><span className="eyebrow">Segurança</span><h2>Alterar meu PIN</h2></div>
          <span className="badge neutral">{session?.user?.name}</span>
        </div>
        <div className="capture-fields" style={{ maxWidth:360 }}>
          <label>PIN atual
            <input type="password" inputMode="numeric" maxLength={6} value={currentPin} onChange={(e)=>setCurrentPin(e.target.value.replace(/\D/g,''))}
              placeholder="••••" style={{ letterSpacing:'0.3em', fontFamily:'var(--mono)', fontSize:18, textAlign:'center' }} />
          </label>
          <label>Novo PIN (4–6 dígitos)
            <input type="password" inputMode="numeric" maxLength={6} value={newPin} onChange={(e)=>setNewPin(e.target.value.replace(/\D/g,''))}
              placeholder="••••" style={{ letterSpacing:'0.3em', fontFamily:'var(--mono)', fontSize:18, textAlign:'center' }} />
          </label>
          <label>Confirmar novo PIN
            <input type="password" inputMode="numeric" maxLength={6} value={confirmPin} onChange={(e)=>setConfirmPin(e.target.value.replace(/\D/g,''))}
              placeholder="••••" style={{ letterSpacing:'0.3em', fontFamily:'var(--mono)', fontSize:18, textAlign:'center' }}
              onKeyDown={(e)=>{ if(e.key==='Enter') handleChangePin(); }} />
          </label>
          <button className="primary-action" onClick={handleChangePin} disabled={!currentPin||!newPin||!confirmPin}>Alterar PIN</button>
          {pinMsg && <div className={`submission ${pinMsg.tone}`}>{pinMsg.text}</div>}
        </div>
      </article>
    </section>
  );
}
