# Nirvix Ai — Website / PWA Update

यह package आपके दिए हुए existing website/server code पर आधारित update है। Existing page structure और features को यथासंभव बनाए रखा गया है।

## इस update में
- Website/app branding को **Nirvix Ai** किया गया।
- दूसरे दिए गए logo से गोल white-background PWA icons बनाए गए: `icons/icon-192.png` और `icons/icon-512.png`।
- PWA manifest और app install label को Nirvix Ai / `Install/Update` किया गया।
- Help phone number को `9905018215` किया गया; quick menu में केवल `Call help` और `WhatsApp help` labels हैं।
- WhatsApp help खोलने पर संदेश: `Dear. Nirvix Ai help team. I enquiry related to Nirvix Ai services.`
- AI service error/maintenance पर requested Hindi message और Founder contact दिखता है।
- Seller Dashboard अब बिना login/register gate के marketplace products, overall order count और total sales दिखाता है।
- Public dashboard में केवल recent order ID, status, item names/quantities और total दिखते हैं; customer phone/address expose नहीं किए जाते।

## Deploy
1. ZIP extract करें और इसकी files उसी repository/root में upload करें जहाँ `server.js`, `package.json` और `index.html` हैं।
2. `icons/` folder सहित सभी files commit/push करें और hosting service redeploy करें।
3. OpenAI AI Help चलाने के लिए hosting Environment में `OPENAI_API_KEY` set होना चाहिए। इसे कभी भी `index.html` या browser JavaScript में न रखें।
4. Persistent data के लिए `DATABASE_URL` (PostgreSQL) configure करें; बिना database के host restart पर local JSON data खो सकता है।
5. Deploy के बाद `/api/health`, `/api/marketplace/overview`, `/manifest.json`, `/icons/icon-192.png` और `/icons/icon-512.png` जाँचें।
6. Android Chrome में website खोलकर browser menu से Install app / Add to Home screen करें।

## Security / expected behavior
- Seller dashboard का overview public/read-only है। Product publish करना, order status बदलना और seller-specific/private information access करना अभी भी authenticated seller account मांगता है।
- AI की वास्तविक availability API key, API billing/credits और hosting configuration पर निर्भर करती है। Deployment के बाद वास्तविक सवाल पूछकर जाँचें।
