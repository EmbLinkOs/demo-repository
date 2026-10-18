import {
  invitationEmail,
  validateRegistration,
  type Booking,
} from "../supabase/functions/reservations/core.ts";
const valid = {
  firstName: "Camille",
  lastName: "Martin",
  email: "camille@example.com",
  phone: "+33 6 12 34 56 78",
  partySize: 2,
  language: "fr",
  consent: true,
  captchaToken: "verified-token",
};
const assert = (value: boolean, message: string) => {
  if (!value) throw new Error(message);
};
Deno.test(
  "registration validation: names, consent, sizes, email, phone and captcha",
  () => {
    assert(validateRegistration(valid), "valid registration accepted");
    for (const invalid of [
      { consent: false },
      { firstName: " " },
      { firstName: "x".repeat(81) },
      { partySize: 0 },
      { partySize: 1.5 },
      { partySize: 21 },
      { email: "bad" },
      { phone: "<script>" },
      { language: "unknown" },
      { captchaToken: "" },
    ])
      assert(
        !validateRegistration({ ...valid, ...invalid }),
        `invalid rejected: ${JSON.stringify(invalid)}`,
      );
  },
);
const booking: Booking = {
  id: "test",
  reference: "PD27-TEST",
  first_name: "<img src=x onerror=alert(1)>",
  last_name: "Martin & Co",
  email: "camille@example.com",
  party_size: 2,
  language: "fr",
  email_attempt: 1,
};
const settings = {
  event_date: "2027-02-28",
  event_time: null,
  venue: "Dijon <campus>",
  venue_address: "Address & more",
  organizer_email: "team@example.com",
};
Deno.test(
  "French invitation escapes guest and venue input and includes booking details",
  () => {
    const email = invitationEmail(booking, settings);
    assert(
      email.html.includes("&lt;img") && !email.html.includes("<img"),
      "guest HTML escaped",
    );
    assert(email.html.includes("Dijon &lt;campus&gt;"), "venue escaped");
    assert(email.html.includes("28 février 2027"), "French date");
    assert(
      email.html.includes("2 personnes") && email.html.includes("PD27-TEST"),
      "party count and reference",
    );
    assert(
      email.text.includes("Horaires à confirmer"),
      "unknown time is explicit",
    );
  },
);
Deno.test(
  "English invitation localizes date, labels and plaintext fallback",
  () => {
    const email = invitationEmail(
      { ...booking, language: "en" },
      { ...settings, event_time: "14:30:00" },
    );
    assert(
      email.html.includes("28 February 2027") &&
        email.html.includes("2 people"),
      "English details",
    );
    assert(
      email.text.includes("14:30") &&
        email.subject.startsWith("Your invitation"),
      "English subject and time",
    );
  },
);
