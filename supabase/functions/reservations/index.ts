import {
  invitationEmail,
  validateRegistration,
  type Booking,
  type EventSettings,
} from "./core.ts";

const env = (name: string) => Deno.env.get(name) || "";
const supabase = env("SUPABASE_URL");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
const origin = env("ALLOWED_ORIGIN");
const cors = {
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  Vary: "Origin",
  "Cache-Control": "no-store",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
class DatabaseError extends Error {
  constructor(public detail: string) {
    super("Database request failed");
  }
}
async function db(path: string, options: RequestInit = {}) {
  const response = await fetch(`${supabase}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...options.headers,
    },
  });
  if (!response.ok) throw new DatabaseError(await response.text());
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
const rpc = (name: string, args: unknown) =>
  db(`rpc/${name}`, { method: "POST", body: JSON.stringify(args) });
async function getSettings() {
  return (await db("event_settings?id=eq.true&select=*"))[0];
}
async function isOrganizer(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;
  const response = await fetch(`${supabase}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: authorization },
  });
  if (!response.ok) return false;
  const user = await response.json();
  if (!/^[0-9a-f-]{36}$/i.test(user.id || "")) return false;
  return (
    (await db(`organizers?user_id=eq.${user.id}&select=user_id`)).length === 1
  );
}
async function sendInvitation(id: string, settings: EventSettings) {
  const booking: Booking | null = await rpc("claim_invitation_email", {
    p_id: id,
  });
  if (!booking) return false;
  try {
    const email = invitationEmail(booking, settings);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env("RESEND_API_KEY")}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `graduation-${booking.id}-${booking.email_attempt}`,
      },
      body: JSON.stringify({
        from: env("INVITATION_FROM"),
        to: [booking.email],
        reply_to: settings.organizer_email,
        ...email,
      }),
    });
    if (!response.ok) throw new Error("Email provider rejected send");
    const receipt = await response.json();
    await db(`reservations?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify({ email_status: "sent", resend_id: receipt.id }),
    });
    return true;
  } catch {
    await db(`reservations?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify({ email_status: "failed" }),
    });
    return false;
  }
}
export async function handleRequest(request: Request): Promise<Response> {
  const requestOrigin = request.headers.get("Origin");
  if (!origin || (requestOrigin && requestOrigin !== origin))
    return json({ error: "Origin not allowed." }, 403);
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });
  if (!supabase || !serviceKey)
    return json({ error: "Service not configured." }, 503);
  try {
    const url = new URL(request.url);
    if (request.method === "GET") {
      if (url.searchParams.get("admin") === "1") {
        if (!(await isOrganizer(request)))
          return json({ error: "Organizer access required." }, 403);
        const [settings, reservations] = await Promise.all([
          getSettings(),
          db("reservations?select=*&order=created_at.desc"),
        ]);
        return json({ settings, reservations });
      }
      const settings = await getSettings();
      const totals = await db(
        "reservations?status=eq.confirmed&select=party_size",
      );
      const reserved = totals.reduce(
        (sum: number, row: { party_size: number }) => sum + row.party_size,
        0,
      );
      return json({
        eventDate: settings.event_date,
        eventTime: settings.event_time,
        venue: settings.venue,
        venueAddress: settings.venue_address,
        capacity: settings.capacity,
        maxPartySize: settings.max_party_size,
        registrationOpen:
          settings.registration_open &&
          Boolean(
            env("RESEND_API_KEY") &&
              env("INVITATION_FROM") &&
              env("TURNSTILE_SECRET_KEY") &&
              env("TURNSTILE_HOSTNAME"),
          ),
        availableSeats:
          settings.capacity === null
            ? null
            : Math.max(0, settings.capacity - reserved),
        organizerEmail: settings.organizer_email,
        privacyNoticeFr: settings.privacy_notice_fr,
        privacyNoticeEn: settings.privacy_notice_en,
      });
    }
    if (request.method !== "POST")
      return json({ error: "Method not allowed." }, 405);
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      return json({ error: "JSON required." }, 415);
    // Limit the body before JSON parsing, including chunked requests.
    const reader = request.body?.getReader();
    let length = 0;
    const chunks: Uint8Array[] = [];
    if (!reader) return json({ error: "Request body required." }, 400);
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 20000) {
        await reader.cancel();
        return json({ error: "Request too large." }, 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return json({ error: "Invalid JSON." }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      return json({ error: "Invalid request." }, 400);
    if (body.action) {
      if (!(await isOrganizer(request)))
        return json({ error: "Organizer access required." }, 403);
      if (body.action === "settings") {
        const settings = body.settings as Record<string, unknown>;
        if (
          !settings ||
          typeof settings !== "object" ||
          Array.isArray(settings) ||
          typeof settings.registration_open !== "boolean" ||
          !Number.isInteger(settings.max_party_size) ||
          (settings.capacity !== null && !Number.isInteger(settings.capacity))
        )
          return json({ error: "Invalid event settings." }, 400);
        await rpc("update_graduation_settings", { p_settings: settings });
        return json({ ok: true });
      }
      const id = String(body.id || "");
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id,
        )
      )
        return json({ error: "Invalid reservation." }, 400);
      const booking = (await db(`reservations?id=eq.${id}&select=*`))[0];
      if (!booking) return json({ error: "Reservation not found." }, 404);
      if (body.action === "cancel") {
        await db(`reservations?id=eq.${id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "cancelled", checked_in: false }),
        });
        return json({ ok: true });
      }
      if (body.action === "checkin") {
        if (booking.status !== "confirmed")
          return json({ error: "Reservation cancelled." }, 409);
        await db(`reservations?id=eq.${id}`, {
          method: "PATCH",
          body: JSON.stringify({ checked_in: !booking.checked_in }),
        });
        return json({ ok: true });
      }
      if (body.action === "delete") {
        await db(`reservations?id=eq.${id}`, { method: "DELETE" });
        return json({ ok: true });
      }
      if (body.action === "resend") {
        if (booking.status !== "confirmed" || booking.email_status === "sent")
          return json(
            { error: "Only pending or failed invitations can be retried." },
            409,
          );
        const sent = await sendInvitation(id, await getSettings());
        return sent
          ? json({ ok: true })
          : json(
              {
                error:
                  "Email could not be sent. Check Resend settings and retry.",
              },
              502,
            );
      }
      return json({ error: "Unknown action." }, 400);
    }
    const en = body.language === "en";
    const error = (fr: string, english: string, status = 400) =>
      json({ error: en ? english : fr }, status);
    if (!validateRegistration(body))
      return error(
        "Vérifiez les champs du formulaire et votre consentement.",
        "Check your form details and consent.",
      );
    if (
      !env("RESEND_API_KEY") ||
      !env("INVITATION_FROM") ||
      !env("TURNSTILE_SECRET_KEY") ||
      !env("TURNSTILE_HOSTNAME")
    )
      return error(
        "Les inscriptions ne sont pas encore disponibles.",
        "Registration is not available yet.",
        503,
      );
    const verification = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: new URLSearchParams({
          secret: env("TURNSTILE_SECRET_KEY"),
          response: String(body.captchaToken),
        }),
      },
    );
    if (!verification.ok)
      return error(
        "La vérification de sécurité est indisponible.",
        "Security verification is unavailable.",
        503,
      );
    const challenge = await verification.json();
    if (!challenge.success || challenge.hostname !== env("TURNSTILE_HOSTNAME"))
      return error(
        "La vérification de sécurité a échoué. Réessayez.",
        "Security verification failed. Please try again.",
      );
    let reservation;
    try {
      reservation = await rpc("reserve_graduation", {
        p_first_name: body.firstName,
        p_last_name: body.lastName,
        p_email: String(body.email).toLowerCase(),
        p_phone: body.phone,
        p_party_size: body.partySize,
        p_language: body.language,
      });
    } catch (failure) {
      if (
        failure instanceof DatabaseError &&
        failure.detail.includes("CAPACITY_EXCEEDED")
      )
        return error(
          "Il ne reste pas assez de places pour votre groupe.",
          "There are not enough places left for your group.",
          409,
        );
      if (
        failure instanceof DatabaseError &&
        failure.detail.includes("REGISTRATION_CLOSED")
      )
        return error(
          "Les inscriptions sont fermées.",
          "Registration is closed.",
          409,
        );
      if (
        failure instanceof DatabaseError &&
        failure.detail.includes("INVALID_PARTY_SIZE")
      )
        return error(
          "Le nombre de personnes dépasse la limite.",
          "Your party exceeds the guest limit.",
        );
      throw failure;
    }
    // Same response for existing emails: do not expose another guest’s reservation or send repeatedly.
    const message = en
      ? "Your request has been processed. If this is a new reservation, your invitation will arrive by email. If you have already registered, keep your original invitation or contact the organizers."
      : "Votre demande a été traitée. Pour une nouvelle réservation, votre invitation vous parviendra par email. Si vous êtes déjà inscrit(e), conservez votre invitation initiale ou contactez l’organisation.";
    if (reservation.duplicate) return json({ message });
    const sent = await sendInvitation(
      reservation.reservation.id,
      await getSettings(),
    );
    if (!sent)
      return json({
        message: en
          ? `Your reservation is saved. The invitation could not be emailed yet. Contact the organizers with reference ${reservation.reservation.reference}. Do not register again.`
          : `Votre réservation est enregistrée. L’invitation n’a pas encore pu être envoyée. Contactez l’organisation avec la référence ${reservation.reservation.reference}. Ne vous réinscrivez pas.`,
      });
    return json({ message });
  } catch (failure) {
    // No guest data, tokens, database details, or provider payloads are logged or returned.
    if (
      failure instanceof DatabaseError &&
      (failure.detail.includes("CAPACITY_BELOW_BOOKED") ||
        failure.detail.includes("check constraint") ||
        failure.detail.includes("invalid input syntax"))
    )
      return json(
        {
          error:
            "Invalid settings: verify capacity, date, venue, contact, bilingual privacy notices and retention date.",
        },
        400,
      );
    return json(
      {
        error:
          "Service temporarily unavailable. Please try again later. / Service temporairement indisponible.",
      },
      503,
    );
  }
}

if (import.meta.main) Deno.serve(handleRequest);
