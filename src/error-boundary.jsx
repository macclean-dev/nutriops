import React from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// "fiz o logoff e a tela ficou branca. Nenhuma msg, nada." (dono, 23/08).
//
// Causa: o app não tinha NENHUM error boundary, em lugar nenhum. LoginScreen,
// AdminPanel e boa parte das telas são chunks separados carregados sob
// demanda (`lazyView`/`lazy`, pages.jsx e main.jsx). O bundle principal que já
// está na memória do navegador guarda o NOME DO ARQUIVO (com hash) de cada
// chunk — e esse nome muda a cada deploy que toca o arquivo.
//
// Publicamos 4 versões hoje (v1.9.217 a .220). Numa aba que ficou aberta
// desde antes do primeiro desses deploys, o bundle principal ainda aponta
// pro chunk ANTIGO do login — que não existe mais no servidor. Sair é
// literalmente a PRIMEIRA vez nessa aba que o app precisa baixar o chunk da
// tela de login (ela não visita essa tela de novo depois de logada) — o
// `import()` recusa (404), a Promise rejeita, e sem boundary nenhum o React
// desmonta a árvore inteira. Tela branca, sem mensagem: exatamente o relato.
//
// O toast "Nova versão disponível" (main.jsx) não protege deste caso — ele
// avisa quando o SERVICE WORKER percebe uma atualização, o que depende de um
// ciclo de checagem (a cada 30 min) que pode não ter rodado ainda. Este
// boundary é a rede de segurança PRA QUANDO o toast não chegou a tempo: se o
// erro tem cara de chunk que sumiu, recarrega sozinho — silencioso quando dá
// certo (a pessoa nem percebe), e só mostra uma tela se o reload não resolver.
// ─────────────────────────────────────────────────────────────────────────────

// Só os padrões que navegadores de verdade emitem pra "esse arquivo JS não
// existe mais" — não pode casar com um erro de LÓGICA qualquer (esses devem
// aparecer na tela de fallback, não sumir num reload silencioso).
const PADRAO_CHUNK_SUMIU = /dynamically imported module|failed to fetch|loading chunk|importing a module script failed|error loading dynamically/i;

export function pareceChunkSumido(error) {
  const msg = String(error?.message ?? error ?? '');
  return PADRAO_CHUNK_SUMIU.test(msg);
}

// Guarda 1 recarga por sessão de aba: se o reload não resolver (ex.: sem
// internet), recarregar em loop travaria o aparelho num flicker infinito em
// vez de mostrar o problema real.
const CHAVE_RELOAD = 'nutriops.errorboundary.reloaded';

export function podeRecarregarSozinho() {
  try { return sessionStorage.getItem(CHAVE_RELOAD) !== '1'; } catch { return true; }
}

export function marcarRecarregado() {
  try { sessionStorage.setItem(CHAVE_RELOAD, '1'); } catch {}
}

export function limparMarcaDeRecarga() {
  try { sessionStorage.removeItem(CHAVE_RELOAD); } catch {}
}

export class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    if (pareceChunkSumido(error) && podeRecarregarSozinho()) {
      marcarRecarregado();
      window.location.reload();
      return;
    }
    console.error('[NutriOPS] erro não tratado na árvore de UI:', error);
  }

  componentDidUpdate(prevProps, prevState) {
    // Chegou até aqui sem erro nenhum — a marca de "já tentei recarregar" não
    // serve mais pro PRÓXIMO chunk que vier a sumir (próximo deploy, dias
    // depois). Sem isto, uma única recarga que não resolveu ficaria vetando
    // recargas automáticas pelo resto da sessão de aba.
    if (!this.state.error && prevState.error) limparMarcaDeRecarga();
  }

  render() {
    if (!this.state.error) return this.props.children;

    if (pareceChunkSumido(this.state.error)) {
      // A recarga já foi disparada em componentDidCatch — esta tela só
      // aparece no instante entre o catch e o reload de fato acontecer, ou
      // se o reload já foi tentado nesta aba e o erro voltou (sem internet).
      return (
        <div style={{ minHeight:'100vh', display:'grid', placeItems:'center', background:'#f9fbfa', fontFamily:'-apple-system, "Segoe UI", system-ui, sans-serif', padding:24 }}>
          <div style={{ textAlign:'center', maxWidth:360 }}>
            <div style={{ fontSize:15, color:'#5c6c7a' }}>Atualizando o app…</div>
          </div>
        </div>
      );
    }

    return (
      <div style={{ minHeight:'100vh', display:'grid', placeItems:'center', background:'#f9fbfa', fontFamily:'-apple-system, "Segoe UI", system-ui, sans-serif', padding:24 }}>
        <div style={{ textAlign:'center', maxWidth:380 }}>
          <div style={{ fontSize:52, marginBottom:16 }}>⚠</div>
          <h2 style={{ fontSize:20, fontWeight:800, color:'#001e2b', marginBottom:8 }}>Algo deu errado</h2>
          <p style={{ color:'#5c6c7a', fontSize:14, marginBottom:24, lineHeight:1.5 }}>
            A tela travou por um erro inesperado. Nenhum registro se perde — o que
            não subiu continua salvo neste aparelho. Recarregar costuma resolver.
          </p>
          <button onClick={() => window.location.reload()}
            style={{ padding:'12px 28px', background:'#00684a', color:'white', border:'none', borderRadius:12, fontSize:15, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
            Recarregar
          </button>
        </div>
      </div>
    );
  }
}
