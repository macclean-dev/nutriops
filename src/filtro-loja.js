// ─────────────────────────────────────────────────────────────────────────────
// Filtro de empresa das telas que consolidam várias lojas (Relatórios,
// Exportação mensal, Auditoria, Dossiê Fiscal e Prontidão).
//
// Essas cinco telas começavam SEMPRE em "Todas as empresas", ignorando a loja
// escolhida no menu. Dentro do mesmo hub, Conformidade e Gráficos seguiam a
// loja do menu, então trocar de aba mudava o escopo sem aviso. Relato do dono
// (16/09): "selecionei Swiss mas estou vendo CASA DOCE junto com Bäckerei".
//
// Agora começam na loja do menu e acompanham a troca. "Todas as empresas"
// continua a um clique, só deixou de ser o padrão.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react';

// Loja do menu, se ela estiver entre as que a tela pode mostrar; senão, todas.
export function filtroInicialDeLoja(activeTenantId, tenants) {
  if (!activeTenantId) return 'all';
  return (tenants ?? []).some((t) => t?.id === activeTenantId) ? activeTenantId : 'all';
}

export function useFiltroDeLoja(activeTenant, tenants) {
  const [filtro, setFiltro] = useState(() => filtroInicialDeLoja(activeTenant?.id, tenants));
  // Trocou a loja no menu: o relatório vai junto. Escolha manual feita DENTRO
  // da tela (outra loja, ou "todas") vale até a próxima troca no menu.
  useEffect(() => {
    setFiltro(filtroInicialDeLoja(activeTenant?.id, tenants));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTenant?.id]);
  return [filtro, setFiltro];
}
