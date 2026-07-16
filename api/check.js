export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { portalUrl, mac, actionType, genreId, token: clientToken } = req.body;

    if (!portalUrl || !mac) {
        return res.status(400).json({ error: 'بيانات ناقصة' });
    }

    let cleanUrl = portalUrl.trim().replace(/\/$/, "");
    if (!cleanUrl.endsWith('portal.php')) cleanUrl += '/portal.php';

    const baseHeaders = {
        'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
        'Cookie': `mac=${encodeURIComponent(mac.trim())}; stb_lang=en; timezone=Africa/Cairo;`,
        'Referer': cleanUrl,
        'Accept': '*/*'
    };

    try {
        // إذا كان الطلب هو تحميل محتوى باقة معينة فقط
        if (req.method === 'POST' && actionType === 'get_channels') {
            const channelsUrl = `${cleanUrl}?type=${actionType === 'vod' ? 'vod' : 'itv'}&action=get_ordered_list&genre=${encodeURIComponent(genreId)}&token=${clientToken || ''}&JsHttpRequest=1-xml`;
            const channelsRes = await fetch(channelsUrl, { headers: baseHeaders });
            const channelsJson = await channelsRes.json();
            const channelsList = channelsJson?.js?.data || [];
            return res.status(200).json({ success: true, channels: channelsList });
        }

        // --- الفحص العادي وجلب الباقات (الطلب الرئيسي للوحة Control) ---
        const handshakeUrl = `${cleanUrl}?type=stb&action=handshake&JsHttpRequest=1-xml`;
        const handshakeRes = await fetch(handshakeUrl, { headers: baseHeaders });
        const handshakeText = await handshakeRes.text();
        
        let token = '';
        const matchToken = handshakeText.match(/"token"\s*:\s*"([^"]+)"/);
        if (matchToken) token = matchToken[1];
        else {
            try { token = JSON.parse(handshakeText)?.js?.token || ''; } catch(e) {}
        }

        const profileUrl = `${cleanUrl}?type=stb&action=get_profile&token=${token}&JsHttpRequest=1-xml`;
        const profileRes = await fetch(profileUrl, { headers: baseHeaders });
        const profileJson = await profileRes.json();
        const profileData = profileJson?.js;

        if (!profileData || profileData.active === false) {
            return res.status(200).json({ success: false });
        }

        const expiryDate = profileData.end_date || "غير محدد (مفتوح)";

        // جلب تصنيفات البث المباشر مع الـ ID الخاص بكل باقة
        const liveRes = await fetch(`${cleanUrl}?type=itv&action=get_genres&token=${token}&JsHttpRequest=1-xml`, { headers: baseHeaders });
        const liveGenres = (await liveRes.json())?.js || [];

        // جلب تصنيفات الأفلام مع الـ ID
        const vodRes = await fetch(`${cleanUrl}?type=vod&action=get_categories&token=${token}&JsHttpRequest=1-xml`, { headers: baseHeaders });
        const vodGenres = (await vodRes.json())?.js || [];

        // جلب تصنيفات المسلسلات
        const seriesRes = await fetch(`${cleanUrl}?type=series&action=get_genres&token=${token}&JsHttpRequest=1-xml`, { headers: baseHeaders });
        const seriesGenres = (await seriesRes.json())?.js || [];

        return res.status(200).json({
            success: true,
            token: token,
            expiry: expiryDate,
            live: liveGenres.map(g => ({ id: g.id || g.alias, title: g.title || g.name })),
            vod: vodGenres.map(g => ({ id: g.id || g.category_alias, title: g.category_name || g.title })),
            series: seriesGenres.map(g => ({ id: g.id, title: g.title }))
        });

    } catch (error) {
        return res.status(200).json({ success: false, error: error.message });
    }
}
