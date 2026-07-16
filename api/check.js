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

    const cleanMac = mac.trim();

    const getHeaders = (token = '') => ({
        'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
        'Cookie': `mac=${encodeURIComponent(cleanMac)}; stb_lang=en; timezone=Africa/Cairo;${token ? ` Bearer=${token};` : ''}`,
        'Referer': cleanUrl,
        'Accept': '*/*',
        'Authorization': token ? `Bearer ${token}` : undefined
    });

    try {
        // --- وضع جلب القنوات الآمن ضد الأخطاء ---
        if (req.method === 'POST' && actionType === 'get_channels') {
            const reqType = (genreId.startsWith('vod_') || genreId.includes('movie')) ? 'vod' : 'itv';
            const channelsUrl = `${cleanUrl}?type=${reqType}&action=get_ordered_list&genre=${encodeURIComponent(genreId)}&token=${clientToken || ''}&JsHttpRequest=1-xml`;
            
            try {
                const channelsRes = await fetch(channelsUrl, { headers: getHeaders(clientToken) });
                const channelsJson = await channelsRes.json();
                const channelsList = channelsJson?.js?.data || channelsJson?.js || [];
                return res.status(200).json({ success: true, channels: Array.isArray(channelsList) ? channelsList : [] });
            } catch (innerErr) {
                // محاولة احتياطية ثانية في حال فشل الـ JSON المباشر
                return res.status(200).json({ success: true, channels: [] });
            }
        }

        // --- وضع الفحص الرئيسي والـ Handshake ---
        const handshakeUrl = `${cleanUrl}?type=stb&action=handshake&JsHttpRequest=1-xml`;
        const handshakeRes = await fetch(handshakeUrl, { headers: getHeaders() });
        const handshakeText = await handshakeRes.text();
        
        let token = '';
        const matchToken = handshakeText.match(/"token"\s*:\s*"([^"]+)"/);
        if (matchToken) token = matchToken[1];
        else {
            try { token = JSON.parse(handshakeText)?.js?.token || ''; } catch(e) {}
        }

        // جلب الـ Profile
        const profileUrl = `${cleanUrl}?type=stb&action=get_profile&token=${token}&JsHttpRequest=1-xml`;
        const profileRes = await fetch(profileUrl, { headers: getHeaders(token) });
        const profileText = await profileRes.text();
        
        let profileData = null;
        try { profileData = JSON.parse(profileText)?.js; } catch(e) {}

        // جلب تصنيفات البث المباشر
        let liveGenres = [];
        try {
            const liveRes = await fetch(`${cleanUrl}?type=itv&action=get_genres&token=${token}&JsHttpRequest=1-xml`, { headers: getHeaders(token) });
            liveGenres = (await liveRes.json())?.js || [];
        } catch(e) {}

        // التحقق من العمل: لو جلب باقات أو بروفايل شغال، يعتبر السيرفر أكتف علطول
        if (!liveGenres || liveGenres.length === 0) {
            if (!profileData || profileData.active === false || profileData.active === "false") {
                return res.status(200).json({ success: false });
            }
        }

        const expiryDate = profileData?.end_date || "غير محدد (مفتوح / Active)";

        // جلب تصنيفات الأفلام
        let vodGenres = [];
        try {
            const vodRes = await fetch(`${cleanUrl}?type=vod&action=get_categories&token=${token}&JsHttpRequest=1-xml`, { headers: getHeaders(token) });
            vodGenres = (await vodRes.json())?.js || [];
        } catch(e) {}

        const formatGenres = (arr) => {
            if (!Array.isArray(arr)) return [];
            return arr.map(g => {
                const id = g.id || g.alias || g.category_alias || '';
                const title = g.title || g.name || g.category_name || id;
                return id ? { id: String(id), title: String(title) } : null;
            }).filter(Boolean);
        };

        return res.status(200).json({
            success: true,
            token: token,
            expiry: expiryDate,
            live: formatGenres(liveGenres),
            vod: formatGenres(vodGenres)
        });

    } catch (error) {
        return res.status(200).json({ success: false, error: error.message });
    }
}
