(() => {
  "use strict";
  const config = window.EVENT_CONFIG || {};
  let lang = "fr";
  const originals = new Map(
    [...document.querySelectorAll("[data-en]")].map((el) => [
      el,
      el.textContent,
    ]),
  );
  const t = (fr, en) => (lang === "en" ? en : fr);
  const menu = document.querySelector(".menu-toggle");
  const nav = document.querySelector("#navigation");
  menu.hidden = false;
  const closeMenu = () => {
    nav.classList.remove("is-open");
    menu.setAttribute("aria-expanded", "false");
  };
  menu.addEventListener("click", () => {
    menu.setAttribute("aria-expanded", String(nav.classList.toggle("is-open")));
  });
  nav.addEventListener("click", (e) => {
    if (e.target.closest("a")) closeMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && nav.classList.contains("is-open")) {
      closeMenu();
      menu.focus();
    }
  });
  const form = document.querySelector("#registration-form");
  const submit = document.querySelector("#submit-registration");
  const notice = document.querySelector("#registration-notice");
  const result = document.querySelector("#form-result");
  let info = null,
    captchaToken = "",
    widget = null,
    loading = false;
  const configured = Boolean(
    config.apiUrl &&
      config.turnstileSiteKey &&
      /^https:\/\//.test(config.apiUrl),
  );
  const isOpen = () =>
    Boolean(
      configured &&
        info?.registrationOpen &&
        info?.eventDate &&
        info?.capacity &&
        info?.organizerEmail &&
        info?.privacyNoticeFr &&
        info?.privacyNoticeEn &&
        info.availableSeats > 0,
    );
  const preview = () => {
    document.querySelector("#preview-name").textContent =
      `${form.elements.firstName.value.trim()} ${form.elements.lastName.value.trim()}`.trim() ||
      t("Votre prénom et nom", "Your first and last name");
    const n = Number(form.elements.partySize.value);
    document.querySelector("#preview-party").textContent =
      `${n} ${t(n === 1 ? "personne" : "personnes", n === 1 ? "person" : "people")}`;
  };
  form.addEventListener("input", preview);
  const showResult = (text, error = false) => {
    result.textContent = text;
    result.classList.toggle("error", error);
    result.hidden = false;
    result.focus();
  };
  const updateButton = () => {
    submit.disabled = loading || !isOpen() || !captchaToken;
    submit.textContent = loading
      ? t("Enregistrement en cours…", "Saving your reservation…")
      : isOpen()
        ? t("Confirmer mon inscription", "Confirm my reservation")
        : info?.registrationOpen && info.availableSeats === 0
          ? t("Les réservations sont complètes", "Fully booked")
          : t("Inscriptions bientôt disponibles", "Registration opens soon");
  };
  function renderEvent() {
    if (!info) return;
    if (info.eventDate) {
      const date = new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-GB", {
        dateStyle: "long",
        timeZone: "Europe/Paris",
      }).format(new Date(info.eventDate));
      const time = info.eventTime
        ? info.eventTime.slice(0, 5)
        : t("Horaires à confirmer", "Time to be confirmed");
      document.querySelectorAll("[data-event-date]").forEach((el) => {
        el.textContent = date;
      });
      document.querySelector("[data-event-time]").textContent = time;
      document.querySelector("#faq-date").textContent = t(
        `La cérémonie aura lieu le ${date}. ${time}${info.eventTime ? " (heure de Dijon)" : ""}.`,
        `The ceremony takes place on ${date}. ${time}${info.eventTime ? " (Dijon time)" : ""}.`,
      );
    }
    if (info.venue) {
      document.querySelector("[data-event-venue]").textContent = info.venue;
      document.querySelector("[data-event-address]").textContent =
        info.venueAddress || "Dijon, France";
      document.querySelector("#faq-venue").textContent =
        `${info.venue}. ${info.venueAddress || ""}`;
    }
    const privacy = lang === "fr" ? info.privacyNoticeFr : info.privacyNoticeEn;
    if (privacy) document.querySelector("#privacy-text").textContent = privacy;
    if (info.organizerEmail)
      document.querySelector("#faq-contact").textContent = t(
        `Contactez ${info.organizerEmail} en indiquant votre référence de réservation.`,
        `Contact ${info.organizerEmail} and quote your booking reference.`,
      );
    if (info.maxPartySize) {
      const selected = form.elements.partySize.value;
      form.elements.partySize.replaceChildren();
      for (let n = 1; n <= info.maxPartySize; n++)
        form.elements.partySize.add(
          new Option(
            t(
              `${n} personne${n > 1 ? "s" : ""} · ${n === 1 ? "moi uniquement" : `moi + ${n - 1} proche${n > 2 ? "s" : ""}`}`,
              `${n} ${n === 1 ? "person · just me" : `people · me + ${n - 1} guest${n > 2 ? "s" : ""}`}`,
            ),
            String(n),
          ),
        );
      if (Number(selected) <= info.maxPartySize)
        form.elements.partySize.value = selected;
      document.querySelector("#party-help").textContent = t(
        `Vous compris(e). ${info.maxPartySize} personnes maximum.`,
        `Including you. Maximum ${info.maxPartySize} people.`,
      );
    }
    if (isOpen()) {
      notice.textContent = t(
        "Les inscriptions sont ouvertes. Votre réservation sera enregistrée avant l’envoi de votre invitation par email.",
        "Registration is open. Your reservation will be saved before your invitation is sent by email.",
      );
      document.querySelector("#opening-note").textContent = t(
        "Les inscriptions sont ouvertes, dans la limite des places disponibles.",
        "Registration is open, subject to availability.",
      );
      loadCaptcha();
    } else if (info.registrationOpen && info.availableSeats === 0) {
      notice.textContent = t(
        "Toutes les places sont réservées. Merci de votre intérêt.",
        "All places are reserved. Thank you for your interest.",
      );
      document.querySelector("#opening-note").textContent = t(
        "Les réservations sont complètes.",
        "Fully booked.",
      );
    } else {
      notice.textContent = t(
        "Les inscriptions ne sont pas encore ouvertes. Les modalités doivent d’abord être confirmées.",
        "Registration is not open yet. Event arrangements must be confirmed first.",
      );
      document.querySelector("#opening-note").textContent = t(
        "Les inscriptions ouvriront après confirmation des détails.",
        "Registration opens once the event details are confirmed.",
      );
    }
    updateButton();
    preview();
  }
  document.querySelector("#language").addEventListener("click", () => {
    lang = lang === "fr" ? "en" : "fr";
    document.documentElement.lang = lang;
    originals.forEach((fr, el) => {
      el.textContent = lang === "en" ? el.dataset.en : fr;
    });
    document
      .querySelector("#language")
      .setAttribute(
        "aria-label",
        lang === "fr" ? "Switch to English" : "Passer en français",
      );
    document
      .querySelector(".hero-art")
      .setAttribute(
        "aria-label",
        t(
          "Carte illustrée de la promotion 2027",
          "Illustrated graduation card for the class of 2027",
        ),
      );
    document
      .querySelector(".invitation-preview")
      .setAttribute(
        "aria-label",
        t("Aperçu de l’invitation", "Invitation preview"),
      );
    document.title = t(
      "Le début de la suite — Polytech Dijon · 2027",
      "The start of what’s next — Polytech Dijon · 2027",
    );
    result.hidden = true;
    renderEvent();
    updateButton();
    preview();
  });
  function loadCaptcha() {
    if (document.querySelector("#turnstile-script")) return;
    window.onGraduationCaptchaLoad = () => {
      widget = window.turnstile.render("#captcha-container", {
        sitekey: config.turnstileSiteKey,
        theme: "light",
        language: "auto",
        callback: (token) => {
          captchaToken = token;
          updateButton();
        },
        "expired-callback": () => {
          captchaToken = "";
          updateButton();
        },
        "error-callback": () => {
          captchaToken = "";
          updateButton();
          notice.textContent = t(
            "La vérification de sécurité a échoué. Rechargez la page.",
            "Security verification failed. Please reload the page.",
          );
        },
      });
    };
    const script = document.createElement("script");
    script.id = "turnstile-script";
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onGraduationCaptchaLoad&render=explicit";
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      notice.textContent = t(
        "La vérification de sécurité est indisponible. Réessayez plus tard.",
        "Security verification is unavailable. Please try again later.",
      );
    };
    document.head.append(script);
  }
  async function loadEvent() {
    if (!configured) return;
    try {
      const response = await fetch(config.apiUrl, { cache: "no-store" });
      if (!response.ok) throw new Error();
      info = await response.json();
      renderEvent();
    } catch {
      notice.textContent = t(
        "Le service de réservation est indisponible. Aucune inscription ne peut être envoyée pour le moment.",
        "The reservation service is unavailable. Registration is temporarily disabled.",
      );
      info = null;
      updateButton();
    }
  }
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!isOpen() || !captchaToken || loading) {
      showResult(
        t(
          "Les inscriptions ne sont pas disponibles. Aucune donnée n’a été envoyée.",
          "Registration is unavailable. No details have been sent.",
        ),
        true,
      );
      return;
    }
    if (!form.reportValidity()) return;
    loading = true;
    updateButton();
    result.hidden = true;
    try {
      const response = await fetch(config.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.elements.firstName.value.trim(),
          lastName: form.elements.lastName.value.trim(),
          email: form.elements.email.value.trim(),
          phone: form.elements.phone.value.trim(),
          partySize: Number(form.elements.partySize.value),
          consent: form.elements.consent.checked,
          language: lang,
          captchaToken,
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          data.error ||
            t(
              "La réservation a échoué.",
              "The reservation could not be saved.",
            ),
        );
      showResult(data.message);
      form.reset();
      preview();
      await loadEvent();
    } catch (error) {
      showResult(
        error.message ||
          t(
            "Une erreur est survenue. Réessayez plus tard.",
            "Something went wrong. Please try again later.",
          ),
        true,
      );
    } finally {
      loading = false;
      captchaToken = "";
      if (window.turnstile && widget !== null) window.turnstile.reset(widget);
      updateButton();
    }
  });
  loadEvent();
})();
