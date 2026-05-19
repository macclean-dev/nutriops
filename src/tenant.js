export const tenantRoles = ["Funcionário", "Supervisor", "Nutricionista RT", "Fiscal"];

export function buildTenantSession(tenant) {
  return {
    tenantId: tenant.id,
    companyName: tenant.name,
    companyType: tenant.segment,
    plan: tenant.plan,
    currentUser: {
      id: `${tenant.id}-rt-01`,
      name: `${tenant.name} RT`,
      role: "Nutricionista RT"
    },
    currentModule: "Temperatura"
  };
}
