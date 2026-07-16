export default async function handler(req, res) {
    // إعدادات الـ CORS للسماح للمتصفح بالقراءة
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

    // تنظيف وتجهيز رابط السيرفر
    let cleanUrl = portalUrl.trim().replace(/\/$/, "");
    if (!cleanUrl.endsWith('portal.php')) {
        cleanUrl += '/portal.php';
    }

    const baseHeaders = {
        'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
        'Cookie': `mac=${encodeURIComponent(mac.trim())}; stb_lang=en; timezone=Africa/Cairo;`,
        'Referer': cleanUrl,
        'Accept': '*/*'
    };

    try {
        // الخطوة 1: عمل Handshake إلزامي للحصول على التوكن (Token)
        const handshakeUrl = `${cleanUrl}?type=stb&action=handshake&JsHttpRequest=1-xml`;
        const handshakeRes = await fetch(handshakeUrl, { headers: baseHeaders });
        const handshakeText = await handshakeRes.text();
        
        let token = '';
        try {
            const parsedHandshake = JSON.parse(handshakeText);
            token = parsedHandshake?.js?.token || '';
        } catch (e) {
            // محاولة أخرى في حال كان السيرفر يرسل البيانات بصيغة مختلفة
            const matchToken = handshakeText.match(/"token"\s*:\s*"([^"]+)"/);
            if (matchToken) token = matchToken[1];
        }

        // الخطوة 2: جلب الملف الشخصي وتاريخ الانتهاء باستخدام التوكن
        const profileUrl = `${cleanUrl}?type=stb&action=get_profile&token=${token}&JsHttpRequest=1-xml`;
        const profileRes = await fetch(profileUrl, { headers: baseHeaders });
        const profileJson = await profileRes.json();
        const profileData = profileJson?.js;

        // إذا رفض السيرفر الماك
        if (!profileData || profileData.active === false) {
            return res.status(200).json({ success: false });
        }

        const expiryDate = profileData.end_date || "غير محدد (مفتوح)";

        // الخطوة 3: جلب تصنيفات وقنوات البث المباشر (Live)
        const liveUrl = `${cleanUrl}?type=itv&action=get_genres&token=${token}&JsHttpRequest=1-xml`;
        const liveRes = await fetch(liveUrl, { headers: baseHeaders });
        const liveJson = await liveRes.json();
        const liveGenres = liveJson?.js || [];
        const liveTitles = liveGenres.map(g => g.title || g.name).filter(Boolean);

        // الخطوة 4: جلب تصنيفات الأفلام (Vod)
        const vodUrl = `${cleanUrl}?type=vod&action=get_categories&token=${token}&JsHttpRequest=1-xml`;
        const vodRes = await fetch(vodUrl, { headers: baseHeaders });
        const vodJson = await vodRes.json();
        const vodGenres = vodJson?.js || [];
        const vodTitles = vodGenres.map(g => g.category_name || g.title || g.name).filter(Boolean);

        // الخطوة 5: جلب تصنيفات المسلسلات (Series)
        const seriesUrl = `${cleanUrl}?type=series&action=get_genres&token=${token}&JsHttpRequest=1-xml`;
        const seriesRes = await fetch(seriesUrl, { headers: baseHeaders });
        const seriesJson = await seriesRes.json();
        const seriesGenres = seriesJson?.js || [];
        const seriesTitles = seriesGenres.map(g => g.title || g.name).filter(Boolean);

        // إرسال البيانات كاملة للواجهة
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
