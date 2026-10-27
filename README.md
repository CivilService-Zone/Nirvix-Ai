# Nirvix Ai — Updated Website Package

This ZIP contains the updated Node.js website, PWA manifest, service worker, supplied logo and install icons.

## Deploy
1. Extract the ZIP and upload the contents to the same repository/root directory as `server.js`.
2. Keep `index.html`, `server.js`, `package.json`, `manifest.json`, `service-worker.js`, `icons/` and the supplied video in the root/package.
3. Set `OPENAI_API_KEY` in the hosting provider's environment for AI Help. Set `DATABASE_URL` for persistent PostgreSQL data.
4. Deploy/redeploy and test `/`, `/manifest.json`, `/icons/icon-192.png`, `/icons/icon-512.png`, `/icons/logo.png`, `/api/health`.
5. On Android Chrome, open the website and use the browser menu → Install app / Add to Home screen.

## Included updates
- Nirvix Ai branding and support number 9905018215
- Supplied logo used for auth and PWA icon assets, with white margins
- Quick menu: Call help, WhatsApp help, theme palette and About Us
- About Us in Hindi, English and Urdu
- WhatsApp help opens a direct chat with the prefilled enquiry message
- AI maintenance fallback text and Seller login with registered mobile/password flow
- PWA app name updated to Nirvix Ai

## Important
The website requires a configured `OPENAI_API_KEY` for live AI answers. Do not place API keys in browser code. Test registration/login, marketplace actions and AI Help after deployment. A successful build/package cannot guarantee the remote hosting environment or external API credentials are configured correctly.


## Requested update (Seller-only authentication)
- Replaced `/icons/logo.png`, `/icons/icon-192.png`, and `/icons/icon-512.png` with the first supplied Nirvix Ai logo.
- Registration and login screens show Seller only; the standard auth API accepts Seller accounts only.
- Existing dashboard, AI Help, marketplace pages, and non-auth service code were otherwise preserved.
- Deploy the included files together from the project root. Existing Customer/Provider accounts are retained in stored data but cannot use the standard login flow in this Seller-only build.
