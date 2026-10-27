# Nirvix Ai — PWA package

ऐप का नाम: Nirvix Ai

## GitHub / Render पर अपडेट
1. ZIP extract करें।
2. सभी फाइलें repository के उसी root में upload करें जहाँ `server.js`, `package.json` और `index.html` हैं।
3. Existing files replace करें, नई `manifest.json`, `service-worker.js`, `icons/` और यह README जोड़ें।
4. Commit changes करें और Render deploy पूरा होने दें।
5. `https://YOUR-DOMAIN/manifest.json`, `/service-worker.js`, `/icons/icon-192.png` और `/icons/icon-512.png` खोलकर जाँचें कि ये फाइलें खुलती हैं।
6. Android Chrome में वेबसाइट खोलें → ⋮ → Install app / Add to Home screen।

## जरूरी नोट
- यह PWA setup मौजूदा Node server और API को बनाए रखता है।
- Service worker जानबूझकर authenticated pages/API/data cache नहीं करता।
- Render Free local filesystem स्थायी database नहीं है; मौजूदा README के अनुसार स्थायी data के लिए PostgreSQL `DATABASE_URL` सेट करें।
- यह package ऐप को PWA के रूप में installable बनाने के लिए है; deployment के बाद live test करना अभी भी जरूरी है।


## इस अपडेट में
- Customer, Seller और Provider registration में 4 अंकों का password और role-specific login.
- एक mobile number से दूसरी बार registration रोकना; referral code auto-generate होता है.
- PWA icon, install button persistence, quick menu, WhatsApp/call help और supplied video.
- Room/transport form में browser geolocation और customer map link.

ध्यान दें: पुराने accounts जिनमें server database में password नहीं था, नए password check के कारण login नहीं कर पाएँगे। उन्हें सुरक्षित password-reset/migration flow से update करना होगा। Referral coupons इस build में referral registration पर referrer account में record होते हैं; कोई monetary value/payment promise नहीं है। Location access के लिए HTTPS और user permission जरूरी है। Map button saved address को Google Maps में खोलता है; यह GPS live tracking नहीं है।
