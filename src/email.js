// ─── NutriOPS Email Service via EmailJS ───────────────────────────────────
// Docs: https://www.emailjs.com/docs/

const EMAILJS_PUBLIC_KEY  = '1ef0FtPY7bx_V4tA6';
const EMAILJS_SERVICE_ID  = 'service_vmc3qlr';

const TEMPLATES = {
  welcome:       'template_385ck7e',
  adminNotify:   'template_4j2qukp',
  trialWarning:  'template_385ck7e', // reuse welcome template for now
  accessGranted: 'template_385ck7e', // reuse welcome template for now
};

// ─── Load EmailJS SDK ──────────────────────────────────────────────────────

let emailjsLoaded = false;

async function loadEmailJS() {
  if (emailjsLoaded || window.emailjs) { emailjsLoaded = true; return; }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@3/dist/email.min.js';
    script.onload = () => {
      window.emailjs.init(EMAILJS_PUBLIC_KEY);
      emailjsLoaded = true;
      resolve();
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// ─── Generic send ──────────────────────────────────────────────────────────

async function sendEmail(templateId, params) {
  try {
    await loadEmailJS();
    const result = await window.emailjs.send(EMAILJS_SERVICE_ID, templateId, params);
    console.log('[NutriOPS Email] Sent:', templateId, result.status);
    return { ok: true };
  } catch (err) {
    console.warn('[NutriOPS Email] Failed:', templateId, err);
    return { ok: false, error: err };
  }
}

// ─── Email functions ───────────────────────────────────────────────────────

/**
 * Sent to new client after completing onboarding
 */
export async function sendWelcomeEmail({ companyName, contactEmail, accessUrl, plan }) {
  return sendEmail(TEMPLATES.welcome, {
    to_email:     contactEmail,
    to_name:      companyName,
    company_name: companyName,
    access_url:   accessUrl || 'https://nutriops.uniwares.net',
    plan_name:    plan || 'Trial',
    manual_url:   'https://nutriops.uniwares.net/manual-nutriops.html',
    support_email:'timenutriops@nutriops.uniwares.net',
    year:         new Date().getFullYear(),
  });
}

/**
 * Sent to admin (macclean@gmail.com) when new client registers
 */
export async function sendAdminNotification({ companyName, contactEmail, plan, accessToken }) {
  return sendEmail(TEMPLATES.adminNotify, {
    to_email:     'macclean@gmail.com',
    company_name: companyName,
    contact_email:contactEmail || '—',
    plan_name:    plan || 'Trial',
    access_token: accessToken || '—',
    admin_url:    'https://nutriops.uniwares.net/admin',
    date:         new Date().toLocaleString('pt-BR'),
  });
}

/**
 * Sent to client when trial is about to expire
 */
export async function sendTrialWarningEmail({ companyName, contactEmail, daysLeft }) {
  return sendEmail(TEMPLATES.trialWarning, {
    to_email:     contactEmail,
    to_name:      companyName,
    company_name: companyName,
    days_left:    daysLeft,
    upgrade_url:  'mailto:timenutriops@nutriops.uniwares.net?subject=Quero assinar o NutriOPS',
    support_email:'timenutriops@nutriops.uniwares.net',
  });
}

/**
 * Sent to client when admin activates their account
 */
export async function sendAccessGrantedEmail({ companyName, contactEmail, accessUrl }) {
  return sendEmail(TEMPLATES.accessGranted, {
    to_email:     contactEmail,
    to_name:      companyName,
    company_name: companyName,
    access_url:   accessUrl || 'https://nutriops.uniwares.net',
    manual_url:   'https://nutriops.uniwares.net/manual-nutriops.html',
    support_email:'timenutriops@nutriops.uniwares.net',
  });
}

// ─── Update template IDs ───────────────────────────────────────────────────

export function updateTemplateIds(ids) {
  if (ids.welcome)       TEMPLATES.welcome       = ids.welcome;
  if (ids.adminNotify)   TEMPLATES.adminNotify   = ids.adminNotify;
  if (ids.trialWarning)  TEMPLATES.trialWarning  = ids.trialWarning;
  if (ids.accessGranted) TEMPLATES.accessGranted = ids.accessGranted;
}
