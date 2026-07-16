export default async function handler(req, res) {
    // إعدادات الـ CORS الكاملة
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { portalUrl, mac } = req.body;
    if (!portalUrl || !mac) {
        return res.status(400).json({ error: 'بيانات ناقصة' });
    }

    let cleanUrl = portalUrl.trim().replace(/\/$/, "");
    if (!cleanUrl.endsWith('portal.php')) {
        cleanUrl += '/portal.php';
    }

    const cleanMac = mac.trim();

    const baseHeaders = {
        'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
        'Cookie': `mac=${encodeURIComponent(cleanMac)}; stb_lang=en; timezone=Africa/Cairo;`,
        'Referer': cleanUrl,
        'Accept': '*/*',
        'Connection': 'keep-alive'
    };

    try {
        // --- الخطوة 1: عمل الـ Handshake المطور ---
        const handshakeUrl = `${cleanUrl}?type=stb&action=handshake&JsHttpRequest=1-xml`;
        const handshakeRes = await fetch(handshakeUrl, { headers: baseHeaders });
        const handshakeText = await handshakeRes.text();
        
        let token = '';
        // محاولة استخراج التوكن بأكثر من طريقة (Regex و JSON) لضمان عدم الفشل
        const matchToken = handshakeText.match(/"token"\s*:\s*"([^"]+)"/);
        if (matchToken) {
            token = matchToken[1];
        } else {
            try {
                const parsed = JSON.parse(handshakeText);
                token = parsed?.js?.token || '';
            } catch(e) {}
        }

        // --- الخطوة 2: جلب الملف الشخصي وتاريخ الانتهاء المطور ---
        const profileUrl = `${cleanUrl}?type=stb&action=get_profile&token=${token}&JsHttpRequest=1-xml`;
        const profileRes = await fetch(profileUrl, { headers: baseHeaders });
        const profileText = await profileRes.text();

        let profileData = null;
        let expiryDate = '';

        // تحليل ملف التعريف بمرونة عالية
        try {
            const parsedProfile = JSON.parse(profileText);
            profileData = parsedProfile?.js || parsedProfile;
        } catch (e) {
            // إذا كان السيرفر يرسل نص مدمج وليس JSON صافي
            const matchAuth = profileText.match(/"active"\s*:\s*(true|1)/);
            if (matchAuth) {
                profileData = { active: true };
                const matchDate = profileText.match(/"end_date"\s*:\s*"([^"]+)"/);
                expiryDate = matchDate ? matchDate[1] : "مفتوح / غير محدد";
            }
        }

        // التحقق من صحة الماك وأنه مفعل وشغال
        if (!profileData || profileData.active === false || profileData.active === "false") {
            return res.status(200).json({ success: false });
        }

        if (!expiryDate) {
            expiryDate = profileData.end_date || "غير محدد (مفتوح)";
        }

        // --- الخطوة 3: جلب قنوات البث المباشر (Live) ---
        const liveUrl = `${cleanUrl}?type=itv&action=get_genres&token=${token}&JsHttpRequest=1-xml`;
        const liveRes = await fetch(liveUrl, { headers: baseHeaders });
        const liveText = await liveRes.text();
        let liveTitles = [];
        try {
            const liveJson = JSON.parse(liveText);
            const genres = liveJson?.js || [];
            liveTitles = genres.map(g => g.title || g.name).filter(Boolean);
        } catch(e) {
            // محاولة جلب العناوين بالـ Regex إذا فشل الـ JSON
            const matches = [...liveText.matchAll(/"title"\s*:\s*"([^"]+)"/g)];
            liveTitles = matches.map(m => m[1]);
        }

        // --- الخطوة 4: جلب الأفلام (Vod) ---
        const vodUrl = `${cleanUrl}?type=vod&action=get_categories&token=${token}&JsHttpRequest=1-xml`;
        const vodRes = await fetch(vodUrl, { headers: baseHeaders });
        const vodText = await vodRes.text();
        let vodTitles = [];
        try {
            const vodJson = JSON.parse(vodText);
            const genres = vodJson?.js || [];
            vodTitles = genres.map(g => g.category_name || g.title || g.name).filter(Boolean);
        } catch(e) {
            const matches = [...vodText.matchAll(/"(category_name|title)"\s*:\s*"([^"]+)"/g)];
            vodTitles = matches.map(m => m[2]);
        }

        // --- الخطوة 5: جلب المسلسلات (Series) ---
        const seriesUrl = `${cleanUrl}?type=series&action=get_genres&token=${token}&JsHttpRequest=1-xml`;
        const seriesRes = await fetch(seriesUrl, { headers: baseHeaders });
        const seriesText = await seriesRes.text();
        let seriesTitles = [];
        try {
            const seriesJson = JSON.parse(seriesText);
            const genres = seriesJson?.js || [];
            seriesTitles = genres.map(g => g.title || g.name).filter(Boolean);
        } catch(e) {
            const matches = [...seriesText.matchAll(/"title"\s*:\s*"([^"]+)"/g)];
            seriesTitles = matches.map(m => m[1]);
        }

        // إرجاع النتيجة الكاملة والناجحة للموقع
        return res.status(200).json({
            success: true,
            expiry: expiryDate,
            live: liveTitles,
            vod: vodTitles,
            series: seriesTitles
        });

    } catch (error) {
        return res.status(200).json({ success: false, error: error.message });
    }
}
