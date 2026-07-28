(function initialiseFrostOfficeModule() {
  "use strict";

  const script = document.currentScript;
  const appId = script && script.dataset ? script.dataset.app : "";
  const params = new URLSearchParams(window.location.search);
  const isSuiteMode = params.get("suite") === "1";
  const handoffStorageKey = "frost_office_suite_handoff_v1";
  const defaultSupabaseStorageKey = "sb-mbudwnwxucluwgbkgbfx-auth-token";
  const personnelLaunchStorageKey = "frost_personnel_pin_launch_v1";
  const personnelWindowUnlockKey = "frost_personnel_window_unlocked_v1";
  const supabaseUrl = "https://mbudwnwxucluwgbkgbfx.supabase.co";
  const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1idWR3bnd4dWNsdXdnYmtnYmZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMDQwMjYsImV4cCI6MjA5MDc4MDAyNn0.xFv-FiQ894vdfJuQYWQyF4WzQXmlnmnKvz_c8nuzl5Q";
  const appPermissions = Object.freeze({
    planning: "planning",
    "route-planner": "route_planner",
    drivers: "drivers",
    maintenance: "maintenance",
    invoicing: "invoicing",
    personnel: "personnel",
    customer: "customer_portal"
  });
  const appLabels = Object.freeze({
    planning: "Planning",
    "route-planner": "Route Planner",
    drivers: "Drivers Dashboard",
    maintenance: "Vehicle Maintenance",
    invoicing: "Invoicing",
    personnel: "Personnel Manager",
    customer: "Customer Portal"
  });

  let suiteSession = null;
  if (isSuiteMode) {
    try {
      suiteSession = JSON.parse(localStorage.getItem(handoffStorageKey) || "null");
    } catch (_) {
      suiteSession = null;
    }
  }

  const hasValidSession = Boolean(
    suiteSession
    && suiteSession.access_token
    && suiteSession.refresh_token
    && (!suiteSession.expires_at || Number(suiteSession.expires_at) > Math.floor(Date.now() / 1000) - 60)
  );

  function isMissingPermissionSetup(status, payload) {
    const code = String(payload && payload.code || "");
    const message = String(payload && (payload.message || payload.hint) || "").toLowerCase();
    return status === 404
      || code === "PGRST202"
      || code === "42883"
      || message.includes("get_my_office_permissions")
      || message.includes("office_staff_permissions");
  }

  async function verifyModulePermission() {
    const permission = appPermissions[appId];
    if (!isSuiteMode || !hasValidSession || !permission) {
      return { allowed: false, setupAvailable: true, permissions: {}, isAdmin: false };
    }
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/get_my_office_permissions`, {
        method: "POST",
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${suiteSession.access_token}`,
          "Content-Type": "application/json"
        },
        body: "{}"
      });
      const responseText = await response.text();
      let payload = {};
      try { payload = responseText ? JSON.parse(responseText) : {}; } catch (_) { payload = {}; }
      if (!response.ok) {
        if (isMissingPermissionSetup(response.status, payload)) {
          return { allowed: true, setupAvailable: false, permissions: {}, isAdmin: false };
        }
        return { allowed: false, setupAvailable: true, permissions: {}, isAdmin: false, verificationFailed: true };
      }
      if (typeof payload === "string") {
        try { payload = JSON.parse(payload); } catch (_) { payload = {}; }
      }
      let permissions = payload && payload.permissions;
      if (typeof permissions === "string") {
        try { permissions = JSON.parse(permissions); } catch (_) { permissions = {}; }
      }
      permissions = permissions && typeof permissions === "object" ? permissions : {};
      const isAdmin = payload && payload.is_admin === true;
      const hasRoutePlannerPermission = Object.prototype.hasOwnProperty.call(permissions, "route_planner");
      const routePlannerLegacyAccess = appId === "route-planner"
        && !hasRoutePlannerPermission
        && permissions.planning === true;
      return {
        allowed: isAdmin || permissions[permission] === true || routePlannerLegacyAccess,
        setupAvailable: true,
        permissions,
        isAdmin
      };
    } catch (_) {
      return { allowed: false, setupAvailable: true, permissions: {}, isAdmin: false, verificationFailed: true };
    }
  }

  const permissionPromise = isSuiteMode && hasValidSession
    ? verifyModulePermission()
    : Promise.resolve({ allowed: false, setupAvailable: true, permissions: {}, isAdmin: false });

  const diagnosticFingerprints = new Map();
  const diagnosticReportTimes = [];

  async function reportModuleDiagnostic(errorLike, extraContext = {}) {
    if (!isSuiteMode || !hasValidSession) return;
    const error = errorLike instanceof Error
      ? errorLike
      : new Error(String(errorLike && errorLike.message || errorLike || "Unexpected software error"));
    const message = String(error.message || "Unexpected software error");
    if (/ResizeObserver loop limit exceeded/i.test(message)) return;

    const now = Date.now();
    while (diagnosticReportTimes.length && diagnosticReportTimes[0] < now - 60000) diagnosticReportTimes.shift();
    if (diagnosticReportTimes.length >= 8) return;
    const fingerprint = `${appId}|${message}|${String(error.stack || "").slice(0, 240)}`;
    if (now - (diagnosticFingerprints.get(fingerprint) || 0) < 300000) return;
    diagnosticFingerprints.set(fingerprint, now);
    diagnosticReportTimes.push(now);

    let appVersion = "Web edition";
    const updateBridge = window.frostDesktopUpdates;
    if (updateBridge && typeof updateBridge.getStatus === "function") {
      try {
        const updateState = await updateBridge.getStatus();
        appVersion = String(updateState && updateState.currentVersion || "Unknown");
      } catch (_) {}
    }

    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/report_office_suite_diagnostic`, {
        method: "POST",
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${suiteSession.access_token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          p_source: `Office Suite - ${appLabels[appId] || appId || "Module"}`,
          p_message: message,
          p_stack: String(error.stack || "") || null,
          p_context: {
            application: appLabels[appId] || appId || "Module",
            app_id: appId,
            page: String(window.location.pathname || "").split(/[\\/]/).pop(),
            app_version: appVersion,
            online: navigator.onLine !== false,
            platform: String(navigator.platform || "").slice(0, 120),
            ...extraContext
          },
          p_severity: "error"
        })
      });
      if (!response.ok && ![404, 400].includes(response.status)) {
        console.warn("Module diagnostic report could not be stored.");
      }
    } catch (_) {}
  }

  window.FrostOffice = Object.freeze({
    appId,
    isSuiteMode,
    allowAllModules: isSuiteMode && hasValidSession,
    session: hasValidSession ? suiteSession : null,
    permissionPromise,
    reportDiagnostic: reportModuleDiagnostic
  });

  if (!isSuiteMode) return;

  window.addEventListener("error", (event) => {
    void reportModuleDiagnostic(event.error || event.message || "A module resource failed to load", {
      line: Number(event.lineno || 0),
      column: Number(event.colno || 0)
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    void reportModuleDiagnostic(event.reason || "Unhandled promise rejection");
  });

  document.documentElement.classList.add("frost-suite-module");

  if (!hasValidSession) {
    window.location.replace("OfficeSuite.html");
    return;
  }

  document.documentElement.classList.add("frost-suite-access-pending");
  const accessStyle = document.createElement("style");
  accessStyle.textContent = `
    .frost-suite-access-pending body > * { visibility: hidden !important; }
    .frost-suite-access-denied {
      min-height: 100vh;
      display: grid;
      place-items: center;
      margin: 0;
      padding: 28px;
      box-sizing: border-box;
      background: #f7f7f7;
      color: #111111;
      font-family: Arial, Helvetica, sans-serif;
    }
    .frost-suite-access-denied main {
      width: min(720px, 100%);
      padding: 34px 0;
      border-top: 3px solid #dc2626;
      border-bottom: 1px solid #d1d5db;
      text-align: center;
    }
    .frost-suite-access-denied .access-brand {
      margin: 0 0 8px;
      color: #dc2626;
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
    }
    .frost-suite-access-denied h1 {
      margin: 0;
      color: #111111;
      font-size: 25px;
      line-height: 1.35;
      letter-spacing: 0;
    }
    .frost-suite-access-denied p {
      margin: 12px 0 20px;
      color: #111111;
      font-size: 14px;
    }
    .frost-suite-access-denied button {
      min-height: 42px;
      padding: 10px 16px;
      border: 1px solid #dc2626;
      border-radius: 6px;
      background: #dc2626;
      color: #ffffff;
      font: 800 13px/1 Arial, Helvetica, sans-serif;
      cursor: pointer;
    }
  `;
  document.head.appendChild(accessStyle);

  if (appId === "personnel" && sessionStorage.getItem(personnelWindowUnlockKey) !== "1") {
    const launchToken = params.get("personnel_pin_token") || "";
    let launch = null;
    try {
      launch = JSON.parse(localStorage.getItem(personnelLaunchStorageKey) || "null");
    } catch (_) {
      launch = null;
    }
    const launchAllowed = Boolean(
      launchToken
      && launch
      && launch.token === launchToken
      && Number(launch.expiresAt) > Date.now()
    );
    localStorage.removeItem(personnelLaunchStorageKey);
    if (!launchAllowed) {
      window.location.replace("OfficeSuite.html?personnel=pin-required");
      return;
    }
    sessionStorage.setItem(personnelWindowUnlockKey, "1");
  }

  const sessionJson = JSON.stringify(suiteSession);
  if (["planning", "drivers", "maintenance"].includes(appId)) {
    localStorage.setItem(defaultSupabaseStorageKey, sessionJson);
  }
  if (appId === "invoicing") {
    localStorage.setItem("frost_invoice_manager_auth_v1", sessionJson);
  }
  if (appId === "personnel") {
    localStorage.setItem("frost_hr_supabase_session_v1", sessionJson);
  }

  const installSuiteControls = () => {
    if (!document.body || document.getElementById("frost-suite-home-button")) return;

    document.body.classList.add("frost-suite-module-body");

    const style = document.createElement("style");
    style.textContent = `
      #frost-suite-home-button {
        position: fixed;
        left: 16px;
        bottom: 16px;
        z-index: 2147483647;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 40px;
        padding: 9px 13px;
        border: 1px solid #fecaca;
        border-radius: 8px;
        background: #ffffff;
        color: #dc2626;
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.18);
        font: 800 13px/1 Arial, Helvetica, sans-serif;
        cursor: pointer;
      }
      #frost-suite-home-button:hover {
        background: #fef2f2;
        border-color: #dc2626;
      }
      #frost-suite-home-button:focus-visible {
        outline: 3px solid rgba(220, 38, 38, 0.2);
        outline-offset: 2px;
      }
      .frost-suite-hide-module-signout {
        display: none !important;
      }
      @media print {
        #frost-suite-home-button { display: none !important; }
      }
    `;
    document.head.appendChild(style);

    const button = document.createElement("button");
    button.type = "button";
    button.id = "frost-suite-home-button";
    button.setAttribute("aria-label", "Back to Frost Office");
    button.innerHTML = '<span aria-hidden="true">&larr;</span><span>Frost Office</span>';
    button.addEventListener("click", () => {
      if (window.opener && !window.opener.closed) {
        window.opener.focus();
        window.close();
        return;
      }
      window.location.href = "OfficeSuite.html";
    });
    document.body.appendChild(button);

    const signOutSelectors = {
      invoicing: ["#signOutBtn"],
      maintenance: ['button[onclick="handleLogout()"]'],
      personnel: [".btn-logout"]
    };
    (signOutSelectors[appId] || []).forEach((selector) => {
      document.querySelectorAll(selector).forEach((element) => {
        element.classList.add("frost-suite-hide-module-signout");
      });
    });
  };

  const runWhenBodyReady = (callback) => {
    if (document.body) callback();
    else document.addEventListener("DOMContentLoaded", callback, { once: true });
  };

  const renderAccessDenied = (access) => {
    runWhenBodyReady(() => {
      document.documentElement.classList.remove("frost-suite-access-pending");
      document.title = "Access restricted - Frost Office";
      document.body.className = "frost-suite-access-denied";
      document.body.innerHTML = `
        <main>
          <p class="access-brand">Access restricted</p>
          <h1>You are not authorised to view this section, if you require access please ask</h1>
          <p>${access && access.verificationFailed ? "Your access could not be verified." : `${appLabels[appId] || "This application"} is not enabled for your account.`}</p>
          <button id="frost-suite-denied-home" type="button">Return to Frost Office</button>
        </main>
      `;
      document.getElementById("frost-suite-denied-home").addEventListener("click", () => {
        if (window.opener && !window.opener.closed) {
          window.opener.focus();
          window.close();
          return;
        }
        window.location.href = "OfficeSuite.html";
      });
    });
  };

  permissionPromise.then((access) => {
    if (!access.allowed) {
      renderAccessDenied(access);
      return;
    }
    document.documentElement.classList.remove("frost-suite-access-pending");
    runWhenBodyReady(installSuiteControls);
  });
})();
