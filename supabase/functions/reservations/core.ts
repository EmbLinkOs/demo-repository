export type Booking = {
  id: string;
  reference: string;
  first_name: string;
  last_name: string;
  email: string;
  party_size: number;
  language: string;
  email_attempt: number;
};
export type EventSettings = {
  event_date: string;
  event_time: string | null;
  venue: string;
  venue_address: string;
  organizer_email: string;
};
export const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
export function validateRegistration(body: Record<string, unknown>): boolean {
  return (
    typeof body.firstName === "string" &&
    body.firstName.trim().length > 0 &&
    body.firstName.length <= 80 &&
    typeof body.lastName === "string" &&
    body.lastName.trim().length > 0 &&
    body.lastName.length <= 80 &&
    typeof body.email === "string" &&
    body.email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) &&
    typeof body.phone === "string" &&
    body.phone.length <= 30 &&
    /^[+\d\s().-]*$/.test(body.phone) &&
    Number.isInteger(body.partySize) &&
    Number(body.partySize) >= 1 &&
    Number(body.partySize) <= 20 &&
    ["fr", "en"].includes(String(body.language)) &&
    body.consent === true &&
    typeof body.captchaToken === "string" &&
    body.captchaToken.length > 0 &&
    body.captchaToken.length <= 2048
  );
}
export function invitationEmail(booking: Booking, settings: EventSettings) {
  const en = booking.language === "en";
  const date = new Intl.DateTimeFormat(en ? "en-GB" : "fr-FR", {
    dateStyle: "long",
    timeZone: "Europe/Paris",
  }).format(new Date(`${settings.event_date}T12:00:00Z`));
  const time =
    settings.event_time?.slice(0, 5) ||
    (en ? "Time to be confirmed" : "Horaires à confirmer");
  const name = `${booking.first_name} ${booking.last_name}`;
  const people = `${booking.party_size} ${en ? (booking.party_size === 1 ? "person" : "people") : booking.party_size === 1 ? "personne" : "personnes"}`;
  const title = en ? "The start of what’s next." : "Le début de la suite.";
  const subject = en
    ? "Your invitation · Polytech Dijon graduation"
    : "Votre invitation · Remise des diplômes Polytech Dijon";
  const intro = en
    ? "Your reservation is confirmed. Keep this invitation and your reference for the ceremony."
    : "Votre réservation est confirmée. Conservez cette invitation et votre référence pour la cérémonie.";
  const footer = en
    ? "For changes or cancellation, contact the student organizing team:"
    : "Pour une modification ou une annulation, contactez l’équipe étudiante organisatrice :";
  const text = `Polytech Dijon · 2027\n${title}\n\n${name}\n${intro}\n${date} · ${time}\n${settings.venue}\n${settings.venue_address}\n${people}\n${booking.reference}\n\n${footer} ${settings.organizer_email}`;
  const html = `<!doctype html><html lang="${en ? "en" : "fr"}"><head><meta charset="utf-8"><title>${subject}</title></head><body style="margin:0;padding:32px 16px;background:#eaece2;font-family:Arial,sans-serif;color:#153e35"><table role="presentation" style="width:100%;max-width:520px;margin:auto;border-collapse:collapse;background:#f8f6ef"><tr><td style="padding:30px 36px;border-bottom:1px solid #d8ddcb;font-size:11px;letter-spacing:2px">POLYTECH DIJON <span style="float:right">2027</span></td></tr><tr><td style="padding:36px;text-align:center"><p style="font-size:38px;color:#bd9351;margin:0">✳</p><p style="font-size:10px;letter-spacing:2px">${en ? "GRADUATION CEREMONY" : "REMISE DES DIPLÔMES"}</p><h1 style="font-family:Georgia,serif;font-weight:normal;font-size:46px;line-height:1.15;margin:20px 0 30px">${title}</h1><p style="font-size:24px;font-family:Georgia,serif">${escapeHtml(name)}</p><p style="font-size:13px;line-height:1.8">${intro}</p><p style="font-size:18px;font-family:Georgia,serif;margin-top:28px">${escapeHtml(date)}<br><span style="font-size:15px">${escapeHtml(time)}</span></p><p style="font-size:14px;line-height:1.8">${escapeHtml(settings.venue)}<br>${escapeHtml(settings.venue_address)}</p><p style="font-size:13px">${people}</p><div style="border-top:1px dashed #b7c1a9;border-bottom:1px dashed #b7c1a9;padding:18px;margin-top:28px;font-size:18px;letter-spacing:2px">${escapeHtml(booking.reference)}</div><p style="font-size:11px;line-height:1.8;margin-top:26px">${footer}<br><a href="mailto:${escapeHtml(settings.organizer_email)}" style="color:#153e35">${escapeHtml(settings.organizer_email)}</a></p></td></tr></table></body></html>`;
  return { subject, text, html };
}
