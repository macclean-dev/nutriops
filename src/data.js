// ⚠️ Arquivo PRIVADO — contém PINs reais. Está em .gitignore.
// Metadata pública dos tenants (sem PINs) vive em ./tenants-public.js
// e PODE commitar normalmente.

import { tenantsBase } from './tenants-public';

// Users por tenant — PINs aqui. Editar à vontade, não vai pro git.
const USERS = {
  swiss: [
    { name: "Emmilyn Barbosa",  role: "Colaborador",     status: "Ativo", location: "Swiss — BSB", storeId: "swiss-bsb", pin: "0000" },
    { name: "Adiel Pinheiro",   role: "Colaborador",     status: "Ativo", location: "Swiss — BSB", storeId: "swiss-bsb", pin: "0000" },
    { name: "Antonio Sergio",   role: "Colaborador",     status: "Ativo", location: "Swiss — BSB", storeId: "swiss-bsb", pin: "0000" },
    { name: "Laura Isabely",    role: "Colaborador",     status: "Ativo", location: "Swiss — BSB", storeId: "swiss-bsb", pin: "0000" },
    { name: "Meyany Irany",     role: "Colaborador",     status: "Ativo", location: "Swiss — BSB", storeId: "swiss-bsb", pin: "0000" },
    { name: "Mikael Silva",     role: "Colaborador",     status: "Ativo", location: "Swiss — BSB", storeId: "swiss-bsb", pin: "0000" },
    { name: "Shayane Oliveira", role: "Colaborador",     status: "Ativo", location: "Swiss — BSB", storeId: "swiss-bsb", pin: "0000" },
    { name: "Fran",             role: "Supervisor",       status: "Ativo", location: "Swiss / Bäckerei", storeId: null,  pin: "6270" },
    { name: "Ana Paula Saraiva",role: "Nutricionista RT", status: "Ativo", location: "Acesso geral",     storeId: null,  pin: "8771" },
  ],
  backerei: [
    { name: "Sila",              role: "Colaborador",     status: "Ativo", location: "Bäckerei — BSB", storeId: "back-bsb", pin: "0000" },
    { name: "Iuana Silva",       role: "Colaborador",     status: "Ativo", location: "Bäckerei — BSB", storeId: "back-bsb", pin: "0000" },
    { name: "Micaely Medeiros",  role: "Colaborador",     status: "Ativo", location: "Bäckerei — BSB", storeId: "back-bsb", pin: "0000" },
    { name: "Zenilma Cardoso",   role: "Colaborador",     status: "Ativo", location: "Bäckerei — BSB", storeId: "back-bsb", pin: "0000" },
    { name: "Fran",              role: "Supervisor",       status: "Ativo", location: "Swiss / Bäckerei", storeId: null,     pin: "6270" },
    { name: "Ana Paula Saraiva", role: "Nutricionista RT", status: "Ativo", location: "Acesso geral",     storeId: null,     pin: "8771" },
  ],
  'dbk-producao': [
    { name: "Mateus Portela",    role: "Colaborador",     status: "Ativo", location: "DBK Produção", storeId: "dbk-main", pin: "0000" },
    { name: "Stephanie Barbosa", role: "Colaborador",     status: "Ativo", location: "DBK Produção", storeId: "dbk-main", pin: "0000" },
    { name: "Dominique Ganster", role: "Supervisor",       status: "Ativo", location: "DBK Produção", storeId: "dbk-main", pin: "0000" },
    { name: "Ana Paula Saraiva", role: "Nutricionista RT", status: "Ativo", location: "Acesso geral", storeId: null,       pin: "8771" },
  ],
};

// Merge runtime: tenant público + usersList privado
export const tenants = tenantsBase.map(t => ({
  ...t,
  usersList: USERS[t.id] ?? [],
}));

export const globalAdmin = {
  id: 'admin-global', name: 'Administrador', role: 'Administrador',
  location: 'Acesso global', pin: '9999', tenantId: null,
};
