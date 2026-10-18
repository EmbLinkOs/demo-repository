# Le début de la suite · Polytech Dijon

A bilingual French/English graduation website for **28 February 2027**, built as a student project. The venue, time and total capacity still need confirmation.

- Responsive event website with a live, personalized invitation preview.
- Registration for a guest and accompanying people, with optional phone number.
- Supabase storage with private guest records and atomic capacity checks.
- Designed HTML invitation emails in the guest's selected language, sent through Resend.
- Password-protected organizer access, guest counts, search, check-in, cancellation, email retries, CSV export and deletion.

The website is hosted on GitHub Pages. **Reservations are intentionally closed until the backend and event capacity are configured.** A preview card is not a reservation or a real invitation.

See [SETUP.md](SETUP.md) for backend activation, administrator creation, retention, and testing. Never commit service-role keys or email API keys.

## Local website

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open the local server in your browser. The site has no build step. GitHub Pages publishes only the selected public files and `assets/`; database code, tests and documentation are not in the deployment artifact.
