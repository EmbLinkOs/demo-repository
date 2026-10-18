// Test HTTP boundaries with simulated providers; this does not send real email.
for (const [key, value] of Object.entries({
  SUPABASE_URL: "https://db.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
  ALLOWED_ORIGIN: "https://event.test",
  RESEND_API_KEY: "test-email-key",
  INVITATION_FROM: "Invitations <invite@example.com>",
  TURNSTILE_SECRET_KEY: "test-captcha-key",
  TURNSTILE_HOSTNAME: "event.test",
}))
  Deno.env.set(key, value);
const { handleRequest } = await import(
  "../supabase/functions/reservations/index.ts"
);
const assert = (value: boolean, message: string) => {
  if (!value) throw new Error(message);
};
const settings = {
  event_date: "2027-02-28",
  event_time: null,
  venue: "Dijon",
  venue_address: "Campus",
  organizer_email: "team@example.com",
  capacity: 100,
  max_party_size: 4,
  registration_open: true,
  privacy_notice_fr: "Notice française",
  privacy_notice_en: "English notice",
};
const booking = {
  id: "11111111-1111-4111-8111-111111111111",
  reference: "PD27-EXAMPLE",
  first_name: "Camille",
  last_name: "Martin",
  email: "private@example.com",
  party_size: 2,
  language: "fr",
  email_attempt: 1,
};
const body = {
  firstName: "Camille",
  lastName: "Martin",
  email: "private@example.com",
  phone: "",
  partySize: 2,
  language: "fr",
  consent: true,
  captchaToken: "token",
};
const request = (body: unknown, authorization = "") =>
  new Request("https://function.test", {
    method: "POST",
    headers: {
      Origin: "https://event.test",
      "Content-Type": "application/json",
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify(body),
  });
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
Deno.test(
  "public event response does not include guest identities",
  async () => {
    const original = globalThis.fetch;
    globalThis.fetch = ((input: string | URL | Request) =>
      Promise.resolve(
        String(input).includes("event_settings")
          ? response([settings])
          : response([{ party_size: 2 }]),
      )) as typeof fetch;
    try {
      const result = await handleRequest(
        new Request("https://function.test", {
          headers: { Origin: "https://event.test" },
        }),
      );
      const data = await result.json();
      assert(data.availableSeats === 98, "seat count");
      assert(
        !JSON.stringify(data).includes(booking.email),
        "no guest email leaked",
      );
    } finally {
      globalThis.fetch = original;
    }
  },
);
Deno.test(
  "untrusted origins and unauthorized organizers are rejected",
  async () => {
    assert(
      (
        await handleRequest(
          new Request("https://function.test", {
            headers: { Origin: "https://untrusted.test" },
          }),
        )
      ).status === 403,
      "origin guard",
    );
    assert(
      (
        await handleRequest(
          new Request("https://function.test?admin=1", {
            headers: { Origin: "https://event.test" },
          }),
        )
      ).status === 403,
      "organizer auth guard",
    );
    assert(
      (await handleRequest(request({ action: "delete", id: booking.id })))
        .status === 403,
      "admin mutation auth guard",
    );
  },
);
Deno.test(
  "invalid registration never reaches the database or providers",
  async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("Must not fetch");
    }) as typeof fetch;
    try {
      assert(
        (await handleRequest(request({ ...body, consent: false }))).status ===
          400,
        "consent validation",
      );
    } finally {
      globalThis.fetch = original;
    }
  },
);
Deno.test(
  "email provider failure leaves a saved reservation and reports pending delivery",
  async () => {
    const original = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = ((
      input: string | URL | Request,
      options?: RequestInit,
    ) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("siteverify"))
        return Promise.resolve(
          response({ success: true, hostname: "event.test" }),
        );
      if (url.includes("reserve_graduation"))
        return Promise.resolve(
          response({ duplicate: false, reservation: booking }),
        );
      if (url.includes("event_settings"))
        return Promise.resolve(response([settings]));
      if (url.includes("claim_invitation_email"))
        return Promise.resolve(response(booking));
      if (url.includes("api.resend.com"))
        return Promise.resolve(
          response({ error: "provider private detail" }, 503),
        );
      if (url.includes("reservations?id=")) {
        assert(
          String(options?.body).includes("failed"),
          "delivery failure is persisted",
        );
        return Promise.resolve(response([]));
      }
      throw new Error("Unexpected request");
    }) as typeof fetch;
    try {
      const result = await handleRequest(request(body));
      const data = await result.json();
      assert(
        result.status === 200 && data.message.includes("enregistrée"),
        "reservation remains saved",
      );
      assert(
        data.message.includes(booking.reference),
        "reference for contacting organizers",
      );
      assert(
        !data.message.includes("provider private detail"),
        "provider error not leaked",
      );
      assert(
        calls.findIndex((url) => url.includes("reserve_graduation")) <
          calls.findIndex((url) => url.includes("api.resend.com")),
        "save before email",
      );
    } finally {
      globalThis.fetch = original;
    }
  },
);
Deno.test("duplicate submission does not send another invitation", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("siteverify"))
      return Promise.resolve(
        response({ success: true, hostname: "event.test" }),
      );
    if (url.includes("reserve_graduation"))
      return Promise.resolve(response({ duplicate: true }));
    throw new Error("Duplicate must not trigger additional calls");
  }) as typeof fetch;
  try {
    const result = await handleRequest(request(body));
    assert(result.status === 200, "duplicate handled");
    assert(
      !(await result.text()).includes(booking.reference),
      "existing reference not disclosed",
    );
  } finally {
    globalThis.fetch = original;
  }
});
Deno.test(
  "captcha from another hostname cannot create a reservation",
  async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        response({ success: true, hostname: "other.test" }),
      )) as typeof fetch;
    try {
      assert(
        (await handleRequest(request(body))).status === 400,
        "hostname rejected",
      );
    } finally {
      globalThis.fetch = original;
    }
  },
);
