(() => {
  "use strict";
  const config = window.EVENT_CONFIG || {};
  let language = "fr",
    session = null,
    rows = [],
    settings = null,
    busy = false;
  const text = (fr, en) => (language === "en" ? en : fr);
  const originals = new Map(
    [...document.querySelectorAll("[data-en]")].map((el) => [
      el,
      el.textContent,
    ]),
  );
  const message = document.querySelector("#admin-message");
  const login = document.querySelector("#login-form");
  const eventForm = document.querySelector("#event-form");
  const configured = Boolean(
    config.apiUrl &&
      config.supabaseUrl &&
      config.supabaseAnonKey &&
      /^https:\/\//.test(config.apiUrl) &&
      /^https:\/\//.test(config.supabaseUrl),
  );
  const notify = (value) => {
    message.textContent = value;
  };
  if (configured) {
    document.querySelector("#login-button").disabled = false;
    document.querySelector("#setup-notice").hidden = true;
  }
  async function auth(path, body, token) {
    const response = await fetch(`${config.supabaseUrl}/auth/v1/${path}`, {
      method: "POST",
      headers: {
        apikey: config.supabaseAnonKey,
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        text(
          "Connexion impossible. Vérifiez vos identifiants.",
          "Sign-in failed. Check your credentials.",
        ),
      );
    return data;
  }
  async function api(body) {
    if (!session)
      throw new Error(text("Veuillez vous connecter.", "Please sign in."));
    if (Date.now() / 1000 > session.expires_at - 60) {
      session = await auth("token?grant_type=refresh_token", {
        refresh_token: session.refresh_token,
      });
    }
    const response = await fetch(`${config.apiUrl}${body ? "" : "?admin=1"}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        data.error || text("Opération impossible.", "The operation failed."),
      );
    return data;
  }
  const cell = (value) => {
    const td = document.createElement("td");
    td.textContent = String(value ?? "—");
    return td;
  };
  function render() {
    const active = rows.filter((row) => row.status === "confirmed");
    const reserved = active.reduce((sum, row) => sum + row.party_size, 0);
    document.querySelector("#reserved-count").textContent = reserved;
    document.querySelector("#remaining-count").textContent =
      settings?.capacity === null
        ? text("À définir", "Set limit")
        : Math.max(0, settings.capacity - reserved);
    document.querySelector("#checked-count").textContent = active
      .filter((row) => row.checked_in)
      .reduce((sum, row) => sum + row.party_size, 0);
    const query = document.querySelector("#search").value.toLowerCase();
    const tbody = document.querySelector("#reservations");
    tbody.replaceChildren();
    const filtered = rows.filter((row) =>
      `${row.first_name} ${row.last_name} ${row.email} ${row.reference}`
        .toLowerCase()
        .includes(query),
    );
    for (const row of filtered) {
      const tr = document.createElement("tr");
      const guest = cell(`${row.first_name} ${row.last_name}`);
      const reference = document.createElement("small");
      reference.textContent = row.reference;
      guest.append(reference);
      tr.append(guest);
      const contact = cell(row.email);
      const phone = document.createElement("small");
      phone.textContent = row.phone || "";
      contact.append(phone);
      tr.append(contact);
      tr.append(cell(row.party_size));
      tr.append(
        cell(
          row.status === "cancelled"
            ? text("Annulée", "Cancelled")
            : row.checked_in
              ? text("Arrivé(e)", "Checked in")
              : text("Confirmée", "Confirmed"),
        ),
      );
      tr.append(
        cell(
          {
            sent: text("Envoyée", "Sent"),
            pending: text("En attente", "Pending"),
            sending: text("Envoi en cours", "Sending"),
            failed: text("Échec", "Failed"),
          }[row.email_status],
        ),
      );
      const actions = document.createElement("td");
      const button = (label, action) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "button outline small";
        b.textContent = label;
        b.disabled = busy;
        b.addEventListener("click", () => change(action, row));
        actions.append(b);
      };
      if (row.status === "confirmed") {
        button(
          row.checked_in
            ? text("Annuler l’arrivée", "Undo check-in")
            : text("Accueillir le groupe", "Check in group"),
          "checkin",
        );
        if (row.email_status !== "sent")
          button(text("Réessayer l’email", "Retry email"), "resend");
        button(text("Annuler", "Cancel"), "cancel");
      }
      button(text("Supprimer", "Delete"), "delete");
      tr.append(actions);
      tbody.append(tr);
    }
    if (!filtered.length) {
      const tr = document.createElement("tr");
      const td = cell(
        text("Aucune réservation à afficher.", "No reservations to display."),
      );
      td.colSpan = 6;
      tr.append(td);
      tbody.append(tr);
    }
  }
  async function refresh() {
    const data = await api();
    rows = data.reservations;
    settings = data.settings;
    for (const [key, value] of Object.entries(settings)) {
      const field = eventForm.elements.namedItem(key);
      if (field) {
        if (field.type === "checkbox") field.checked = value;
        else field.value = value ?? "";
      }
    }
    render();
  }
  async function change(action, row) {
    if (busy) return;
    if (
      ["cancel", "delete"].includes(action) &&
      !window.confirm(
        action === "delete"
          ? text(
              "Supprimer définitivement cette réservation et ses coordonnées ?",
              "Permanently delete this reservation and its personal details?",
            )
          : text(
              "Annuler cette réservation et libérer ses places ?",
              "Cancel this reservation and release its places?",
            ),
      )
    )
      return;
    busy = true;
    render();
    notify(text("Traitement…", "Working…"));
    try {
      await api({ action, id: row.id });
      await refresh();
      notify(text("Mise à jour enregistrée.", "Changes saved."));
    } catch (error) {
      notify(error.message);
    } finally {
      busy = false;
      render();
    }
  }
  login.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!configured) return;
    const button = document.querySelector("#login-button");
    button.disabled = true;
    try {
      session = await auth("token?grant_type=password", {
        email: login.elements.email.value,
        password: login.elements.password.value,
      });
      login.elements.password.value = "";
      await refresh();
      document.querySelector("#login-panel").hidden = true;
      document.querySelector("#workspace").hidden = false;
      document.querySelector("#logout").hidden = false;
      notify("");
    } catch (error) {
      session = null;
      notify(error.message);
    } finally {
      button.disabled = false;
    }
  });
  eventForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    const body = Object.fromEntries(new FormData(eventForm));
    body.capacity = body.capacity ? Number(body.capacity) : null;
    body.max_party_size = Number(body.max_party_size);
    body.registration_open = eventForm.elements.registration_open.checked;
    body.retention_until = body.retention_until || null;
    body.event_time = body.event_time || null;
    busy = true;
    const button = eventForm.querySelector("button");
    button.disabled = true;
    try {
      await api({ action: "settings", settings: body });
      await refresh();
      notify(text("Paramètres enregistrés.", "Settings saved."));
    } catch (error) {
      notify(error.message);
    } finally {
      busy = false;
      button.disabled = false;
    }
  });
  document.querySelector("#logout").addEventListener("click", async () => {
    const current = session;
    session = null;
    rows = [];
    settings = null;
    document.querySelector("#workspace").hidden = true;
    document.querySelector("#logout").hidden = true;
    document.querySelector("#login-panel").hidden = false;
    document.querySelector("#reservations").replaceChildren();
    login.reset();
    notify("");
    if (current) await auth("logout", {}, current.access_token).catch(() => {});
  });
  document.querySelector("#refresh").addEventListener("click", () =>
    refresh()
      .then(() => notify(text("Liste actualisée.", "List refreshed.")))
      .catch((error) => notify(error.message)),
  );
  document.querySelector("#search").addEventListener("input", render);
  document.querySelector("#language").addEventListener("click", () => {
    language = language === "fr" ? "en" : "fr";
    document.documentElement.lang = language;
    originals.forEach((fr, el) => {
      el.textContent = language === "en" ? el.dataset.en : fr;
    });
    document
      .querySelector("#language")
      .setAttribute(
        "aria-label",
        text("Switch to English", "Passer en français"),
      );
    if (session) render();
  });
  document.querySelector("#export").addEventListener("click", () => {
    // Neutralize spreadsheet formulas as well as quoting delimiters and newlines.
    const quote = (value) => {
      let s = String(value ?? "");
      if (/^[\s]*[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const columns = [
      "reference",
      "first_name",
      "last_name",
      "email",
      "phone",
      "party_size",
      "language",
      "status",
      "checked_in",
      "email_status",
      "created_at",
    ];
    const csv =
      "\ufeff" +
      [columns, ...rows.map((row) => columns.map((key) => row[key]))]
        .map((row) => row.map(quote).join(","))
        .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "polytech-dijon-reservations.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
})();
