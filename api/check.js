// نقوم باستخدام fetch المدمج في بيئة Node.js الحديثة على Vercel
export default async function handler(req, res) {
    // تفعيل الـ CORS للسماح بالطلبات
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

    const headers = {
        'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
        'Cookie': `mac=${encodeURIComponent(mac.trim())}; stb_lang=en; timezone=Europe/Paris;`,
        'Referer': cleanUrl
    };

    try {
        // 1. طلب الـ Handshake والـ Profile مع مهلة زمنية (Timeout 6 ثوانٍ)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);

        const profileApi = `${cleanUrl}?type=stb&action=get_profile&JsHttpRequest=1-xml`;
        const profileRes = await fetch(profileApi, { headers, signal: controller.signal });
        const profileText = await profileRes.text();
        clearTimeout(timeoutId);

        let profileData;
        try {
            profileData = JSON.parse(profileText)?.js;
        } catch(e) {
            // بعض السيرفرات تحتاج لـ Handshake مسبق للحصول على توكن
            const handshakeApi = `${cleanUrl}?type=stb&action=handshake&JsHttpRequest=1-xml`;
            const handshakeRes = await fetch(handshakeApi, { headers });
            const handshakeJson = await handshakeRes.json();
            const token = handshakeJson?.js?.token || '';
            
            const profileWithTokenApi = `${cleanUrl}?type=stb&action=get_profile&token=${token}&JsHttpRequest=1-xml`;
            const pRes = await fetch(profileWithTokenApi, { headers });
            profileData = (await pRes.json())?.js;
        }

        if (!profileData) {
            return res.status(200).json({ success: false });
        }

        const expiryDate = profileData.end_date || "غير محدد (مفتوح)";

        // 2. جلب باقات البث المباشر (Live)
        const liveApi = `${cleanUrl}?type=itv&action=get_genres&JsHttpRequest=1-xml`;
        const liveRes = await fetch(liveApi, { headers });
        const liveGenres = (await liveRes.json())?.js || [];
        const liveTitles = liveGenres.map(g => g.title);

        // 3. جلب باقات الأفلام (VOD)
        const vodApi = `${cleanUrl}?type=vod&action=get_categories&JsHttpRequest=1-xml`;
        const vodRes = await fetch(vodApi, { headers });
        const vodGenres = (await vodRes.json())?.js || [];
        const vodTitles = vodGenres.map(g => g.category_name || g.title);

        // 4. جلب باقات المسلسلات (Series)
        const seriesApi = `${cleanUrl}?type=series&action=get_genres&JsHttpRequest=1-xml`;
        const seriesRes = await fetch(seriesApi, { headers });
        const seriesGenres = (await seriesRes.json())?.js || [];
        const seriesTitles = seriesGenres.map(g => g.title);

        return res.status(200).json({
            success: true,
            expiry: expiryDate,
            live: liveTitles,
            vod: vodTitles,
            series: seriesTitles
        });

    } catch (error) {
        return res.status(200).json({ success: false, msg: error.message });
    }
}
