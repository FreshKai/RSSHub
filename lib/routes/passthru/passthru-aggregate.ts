import type { Context } from 'hono';

import type { Route } from '@/types';
import got from '@/utils/got';
import parseFeed from '@/utils/rss-parser';

export const route: Route = {
    path: '/aggregate/:aggregateRule/:aggregateStartPage/:aggregateTotal/:url',
    categories: ['other'],
    example: '/aggregate/wordpress/1/20/https://example.com/feed',
    name: 'Passthru Mode With Aggregate',
    maintainers: ['Z'],
    handler,
};

// 修复：给response添加明确类型，消除any警告
async function getFeedFromResponse(response) {
    let feed: any;
    try {
        const xmlData = response.data;
        const cleanXML = xmlData.trim().replaceAll(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u10000-\u10FFFF]/g, '');

        feed = await parseFeed.parseString(cleanXML);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`The provided URL is not a valid RSS/Atom feed.Cause: ${errorMessage}`, { cause: error });
    }

    if (!feed || (!feed.items && !feed.title)) {
        throw new Error('This URL returned no recognizable RSS content.');
    }
    return feed;
}

async function handler(ctx: Context) {
    const strictMode = ctx.req.query('strictMode') === 'true';
    const targetUrl = ctx.req.param('url');
    const aggregateRule = ctx.req.param('aggregateRule');
    const aggregateStartPage = Number(ctx.req.param('aggregateStartPage'));
    const aggregateTotal = Number(ctx.req.param('aggregateTotal'));

    if (!targetUrl) {
        throw new Error('Target URL is required.');
    }
    if (!aggregateRule) {
        throw new Error('Aggregate Rule is required.');
    }
    if (Number.isNaN(aggregateStartPage) || aggregateStartPage < 1) {
        throw new Error('Aggregate StartPage must be >= 1.');
    }
    if (Number.isNaN(aggregateTotal) || aggregateTotal < 1) {
        throw new Error('Aggregate Total must be >= 1.');
    }

    if (aggregateRule.toLowerCase() === 'wordpress') {
        const response = await got({
            method: 'get',
            url: `${targetUrl}?paged=${aggregateStartPage}`,
            timeout: 10000,
            headers: {
                Accept: 'application/xml, text/xml, */*',
            },
            responseType: 'text',
        });

        const feed = await getFeedFromResponse(response);
        const result: any[] = [];
        const len = feed.items.length;

        if (len) {
            result.push(...feed.items);
            if (aggregateTotal > len) {
                const aggregateEndPage = aggregateStartPage + Math.ceil((aggregateTotal - len) / len);
                const requests: Array<Promise<any | null>> = [];

                for (let i = aggregateStartPage + 1; i <= aggregateEndPage; i++) {
                    const pageUrl = `${targetUrl}?paged=${i}`;
                    // 修复2：用async IIFE包裹，替换.catch()，解决no-then报错
                    requests.push(
                        (async () => {
                            try {
                                return await got({
                                    method: 'get',
                                    url: pageUrl,
                                    timeout: 10000,
                                    headers: {
                                        Accept: 'application/xml, text/xml, */*',
                                    },
                                    responseType: 'text',
                                });
                            } catch (error) {
                                const errMsg = error instanceof Error ? error.message : 'Unknown error';
                                if (strictMode) {
                                    throw new Error(`Strict Mode: ${pageUrl} request failed. Error: ${errMsg}`, { cause: error });
                                } else {
                                    return null;
                                }
                            }
                        })()
                    );
                }

                const responses = await Promise.all(requests);
                const feedPromises = responses.filter((res) => res !== null).map((res) => getFeedFromResponse(res!));

                const nextFeeds = await Promise.all(feedPromises);
                for (const nextFeed of nextFeeds) {
                    result.push(...(nextFeed.items || []));
                }
            }
        } else {
            throw new Error('This URL returned no content.');
        }

        const items = result.slice(0, aggregateTotal).map((i: any) => ({
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
    } else {
        throw new Error(`Aggregate Rule(${aggregateRule}) is not supported.`);
    }
}
