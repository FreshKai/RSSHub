import type { Context } from 'hono';

import type { Route } from '@/types';
import got from '@/utils/got';
import parseFeed from '@/utils/rss-parser';

export const route: Route = {
    path: '/:url',
    categories: ['other'],
    example: '/passthru/:url',
    name: 'Passthru Mode',
    maintainers: ['Z'],
    handler,
};

async function handler(ctx: Context) {
    const targetUrl = ctx.req.param('url');

    if (!targetUrl) {
        throw new Error('Target URL is required.');
    }

    const response = await got({
        method: 'get',
        url: targetUrl,
        timeout: 10000, // 总超时时间 10秒,
        headers: {
            Accept: 'application/xml, text/xml, */*',
        },
        // 强制不进行 JSON 解析，直接获取原始字符串
        responseType: 'text',
    });

    // 获取返回的文本内容
    const xmlData = response.data;

    // 清洗逻辑：
    const cleanXML = xmlData
        .trim() // 去掉头尾空格，防止 <?xml ?> 前面有换行
        .replaceAll(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u10000-\u10FFFF]/g, ''); // 过滤非法 XML 字符

    let feed: any;
    try {
        feed = await parseFeed.parseString(cleanXML);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`The provided URL is not a valid RSS/Atom feed.Cause: ${errorMessage}`, { cause: e });
    }

    if (!feed || (!feed.items && !feed.title)) {
        throw new Error('This URL returned no recognizable RSS content.');
    }

    const items = feed.items?.map((i: any) => ({
        title: i.title,
        link: i.link,
        description: i['content:encoded'] || i.content || i.description || i.summary,
        pubDate: i.pubDate,
        author: i.author,
        category: i.category,
    }));

    return {
        title: feed.title,
        link: feed.link,
        description: feed.description,
        item: items,
        language: feed.language,
    };
}
