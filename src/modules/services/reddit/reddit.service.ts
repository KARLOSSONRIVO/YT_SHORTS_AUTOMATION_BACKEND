import crypto from 'node:crypto';
import { AppError } from '../../../common/errors/app-error';
import { RedditProjectConfigModel, type RedditProjectConfig } from '../../models/reddit-project-config.model';
import { RedditSourceModel } from '../../models/reddit-source.model';
import type { TopicCandidate } from '../../automation/automation.types';

export const APPROVED_SUBREDDITS = [
  'AskReddit', 'TrueOffMyChest', 'AmItheAsshole', 'relationships', 'confession',
  'tifu', 'EntitledPeople', 'MaliciousCompliance', 'ProRevenge'
] as const;

export interface RedditPost {
  id: string; subreddit: string; permalink: string; title: string; body: string; author?: string;
  createdUtc: number; score: number; comments: number; nsfw: boolean; stickied: boolean;
  locked: boolean; removed: boolean; advertisement: boolean; metadataAvailable?: boolean; bodyAvailable?: boolean;
}

type RedditRssEntry = { id: string; title: string; permalink: string; author?: string; published?: string };

export class RedditApiClient {
  private static readonly BASE_URL = 'https://www.reddit.com';
  private static readonly MIN_REQUEST_INTERVAL_MS = 1_500;
  private static readonly MAX_RETRY_DELAY_MS = 60_000;
  private requestQueue: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;
  constructor(
    private readonly userAgent = 'ShortsStudio/2.0',
    private readonly request: typeof fetch = fetch,
    private readonly sleep: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
  ) {}

  public configured() { return Boolean(this.userAgent); }
  public async testConnection() {
    await this.getRss('/r/AskReddit/top/.rss?limit=1');
    return { connected: true, officialApi: false, source: 'rss' };
  }

  public async validateSubreddit(subreddit: string) {
    const cleanSubreddit = this.cleanSubreddit(subreddit);
    const response = await this.getRss('/r/' + cleanSubreddit + '/hot/.rss?limit=1');
    return { valid: /<feed(?:\s|>)/i.test(response), subreddit: cleanSubreddit };
  }

  public async listing(subreddit: string, sort: RedditProjectConfig['sortMethod']) {
    const mapping: Record<RedditProjectConfig['sortMethod'], { path: string; time?: string }> = {
      NEW: { path: 'new' }, HOT: { path: 'hot' }, TOP_TODAY: { path: 'top', time: 'day' },
      TOP_WEEK: { path: 'top', time: 'week' }, RISING: { path: 'rising' }, BEST_ELIGIBLE: { path: 'top', time: 'day' }
    };
    const selected = mapping[sort]; const query = new URLSearchParams({ limit: '10' });
    const cleanSubreddit = this.cleanSubreddit(subreddit);
    const feed = await this.getRss('/r/' + cleanSubreddit + '/' + selected.path + '/.rss?' + query);
    return this.parseRss(feed).map((entry) => this.normalizeRssEntry(entry, cleanSubreddit)).filter((post): post is RedditPost => Boolean(post));
  }

  private async getRss(path: string) {
    const response = await this.fetchWithRetry(RedditApiClient.BASE_URL + path, {
      headers: { 'User-Agent': this.userAgent, Accept: 'application/atom+xml, application/rss+xml' }
    });
    if (!response.ok) throw new AppError('Reddit RSS fetch failed with status ' + response.status + '.', 502, 'REDDIT_API_FAILED');
    return response.text();
  }

  private cleanSubreddit(value: string) { return value.trim().replace(/^r\//i, ''); }
  private async fetchWithRetry(url: string, init: RequestInit) {
    let response: Response | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await this.requestOnce(url, init, attempt === 0);
      if (response.status !== 429 && response.status < 500) return response;
      if (attempt < 2) await this.sleep(this.retryDelayMs(response, attempt));
    }
    return response!;
  }
  private async requestOnce(url: string, init: RequestInit, enforceInterval: boolean) {
    let release!: () => void;
    const turn = new Promise<void>((resolve) => { release = resolve; });
    const previous = this.requestQueue;
    this.requestQueue = turn;
    await previous;
    try {
      if (enforceInterval) {
        const wait = Math.max(0, this.lastRequestAt + RedditApiClient.MIN_REQUEST_INTERVAL_MS - Date.now());
        if (wait > 0) await this.sleep(wait);
      }
      this.lastRequestAt = Date.now();
      return await this.request(url, init);
    } finally {
      release();
    }
  }
  private retryDelayMs(response: Response, attempt: number) {
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds)) return Math.min(RedditApiClient.MAX_RETRY_DELAY_MS, Math.max(1_000, seconds * 1_000));
      const timestamp = Date.parse(retryAfter);
      if (Number.isFinite(timestamp)) return Math.min(RedditApiClient.MAX_RETRY_DELAY_MS, Math.max(1_000, timestamp - Date.now()));
    }
    const resetSeconds = Number(response.headers.get('x-ratelimit-reset'));
    if (Number.isFinite(resetSeconds) && resetSeconds > 0) {
      return Math.min(RedditApiClient.MAX_RETRY_DELAY_MS, Math.max(1_000, resetSeconds * 1_000));
    }
    return Math.min(RedditApiClient.MAX_RETRY_DELAY_MS, 2_500 * (2 ** attempt));
  }
  private parseRss(xml: string): RedditRssEntry[] {
    return [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)].map((match) => {
      const entry = match[1];
      const link = /<link\s+[^>]*href=["']([^"']+)["'][^>]*\/?>/i.exec(entry)?.[1] ?? '';
      const author = /<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/i.exec(entry)?.[1];
      return {
        id: this.xmlText(/<id>([\s\S]*?)<\/id>/i.exec(entry)?.[1] ?? ''),
        title: this.xmlText(/<title>([\s\S]*?)<\/title>/i.exec(entry)?.[1] ?? ''),
        permalink: this.xmlText(link),
        author: author ? this.xmlText(author) : undefined,
        published: this.xmlText(/<(?:published|updated)>([\s\S]*?)<\/(?:published|updated)>/i.exec(entry)?.[1] ?? '')
      };
    }).filter((entry) => Boolean(entry.id && entry.title && entry.permalink));
  }
  private xmlText(value: string) {
    return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')
      .replace(/&#(x[\da-f]+|\d+);/gi, (_, code: string) => String.fromCodePoint(code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code)))
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
      .replace(/\s+/g, ' ').trim();
  }
  private normalizeRssEntry(entry: RedditRssEntry, fallbackSubreddit: string): RedditPost | null {
    const id = entry.id.replace(/^t3_/i, '').trim();
    const title = entry.title.trim();
    if (!id || !title || !entry.permalink) return null;
    return {
      id, subreddit: fallbackSubreddit, permalink: entry.permalink, title, body: title, author: entry.author,
      createdUtc: entry.published ? Math.floor(new Date(entry.published).getTime() / 1000) : 0,
      score: 0, comments: 0, nsfw: false, stickied: false, locked: false, removed: false, advertisement: false,
      metadataAvailable: false, bodyAvailable: false
    };
  }
  private normalize(data: Record<string, unknown>): RedditPost | null {
    const body = String(data.selftext ?? '').trim();
    if (!data.id || !data.title || !data.permalink || !body) return null;
    return {
      id: String(data.id), subreddit: String(data.subreddit ?? ''), permalink: 'https://www.reddit.com' + String(data.permalink),
      title: String(data.title).trim(), body, author: data.author ? String(data.author) : undefined,
      createdUtc: Number(data.created_utc ?? 0), score: Number(data.score ?? 0), comments: Number(data.num_comments ?? 0),
      nsfw: Boolean(data.over_18), stickied: Boolean(data.stickied), locked: Boolean(data.locked),
      removed: body === '[removed]' || body === '[deleted]', advertisement: Boolean(data.promoted),
      metadataAvailable: true, bodyAvailable: true
    };
  }
}

export class RedditService {
  constructor(private readonly api: RedditApiClient) {}
  public approvedSubreddits() { return [...APPROVED_SUBREDDITS]; }
  public testConnection() { return this.api.testConnection(); }
  public validateSubreddit(value: string) { return this.api.validateSubreddit(value); }
  public saveConfig(projectId: string, config: Omit<RedditProjectConfig, 'projectId'>) {
    return RedditProjectConfigModel.findOneAndUpdate({ projectId }, { ...config, projectId }, { upsert: true, new: true, setDefaultsOnInsert: true }).exec();
  }
  public getConfig(projectId: string) { return RedditProjectConfigModel.findOne({ projectId }).exec(); }
  public history(projectId: string) { return RedditSourceModel.find({ projectId }).sort({ fetchedAt: -1 }).exec(); }

  public async preview(projectId: string) {
    const config = await this.getConfig(projectId);
    if (!config) throw new AppError('Reddit project configuration is missing.', 409, 'REDDIT_CONFIG_MISSING');
    return this.eligible(config);
  }

  public async select(projectId: string, accountId: string) {
    const config = await this.getConfig(projectId);
    if (!config) throw new AppError('Reddit project configuration is missing.', 409, 'REDDIT_CONFIG_MISSING');
    const candidates = await this.eligible(config);
    const selected = candidates[0];
    if (!selected) throw new AppError('No eligible new Reddit story was found.', 409, 'NO_ELIGIBLE_REDDIT_STORY');
    const sanitized = this.sanitize(selected.title + '. ' + selected.body);
    const contentHash = this.hash(this.normalize(sanitized));
    const record = await RedditSourceModel.create({
      redditPostId: selected.id, subreddit: selected.subreddit, permalink: selected.permalink,
      authorHash: selected.author ? this.hash(selected.author.toLowerCase()) : undefined,
      sourceCreatedAt: new Date(selected.createdUtc * 1000), fetchedAt: new Date(), originalTitle: selected.title,
      contentHash, projectId, accountId, status: 'selected', entities: [], storyAngle: 'anonymous personal account'
    });
    return { post: selected, record, candidate: this.toCandidate(selected, sanitized) };
  }

  public async reject(projectId: string, sourceId: string, reason: string) {
    return RedditSourceModel.findOneAndUpdate({ _id: sourceId, projectId }, { status: 'rejected', rejectionReason: reason }, { new: true }).exec();
  }
  public completeTransformation(sourceId: string, input: { generatedTitle: string; generatedScript: string; summary: string; entities: string[]; storyAngle: string }) {
    return RedditSourceModel.findByIdAndUpdate(sourceId, { ...input, status: 'transformed' }, { new: true }).exec();
  }
  public markUploaded(sourceId: string, youtubeVideoId?: string) {
    return RedditSourceModel.findByIdAndUpdate(sourceId, { status: 'uploaded', uploadStatus: 'uploaded', youtubeVideoId }, { new: true }).exec();
  }

  public toCandidate(post: RedditPost, sanitized = this.sanitize(post.title + '. ' + post.body)): TopicCandidate {
    const words = sanitized.split(/\s+/).slice(0, 170).join(' ');
    const summary = post.bodyAvailable === false
      ? 'A Reddit RSS entry was found with this title, but the feed did not include the original post body: ' + this.sanitize(post.title)
      : 'A Reddit user submitted this personal account: ' + words;
    return {
      topic: 'Reddit submission from r/' + post.subreddit, title: this.sanitize(post.title).slice(0, 100),
      summary, storyAngle: 'Retell as an anonymized, unverified personal account',
      importantEntities: [], dates: [], events: [], keywords: post.title.toLowerCase().split(/\W+/).filter((word) => word.length > 4).slice(0, 10),
      sourceLinks: [post.permalink], disputedFacts: ['This is a Reddit submission and is not independently verified.'],
      factualConfidence: 0.5, scores: {
        curiosity: this.curiosity(post), emotionalImpact: this.emotion(post), shortFormPotential: this.shortFit(post),
        nicheRelevance: 1, originality: 1, retentionPotential: this.score(post) / 100
      }
    };
  }

  public sanitize(value: string) {
    return value.replace(/u\/[A-Za-z0-9_-]+/g, 'the author').replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email removed]')
      .replace(/\+?\d[\d\s().-]{7,}\d/g, '[phone removed]')
      .replace(/\b\d{1,5}\s+[A-Z][\w.-]+(?:\s+[A-Z][\w.-]+){0,3}\s+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr)\b/gi, '[address removed]');
  }

  public filterAndRank(posts: RedditPost[], config: RedditProjectConfig,
    used: { ids?: Set<string>; links?: Set<string>; hashes?: Set<string>; texts?: string[] } = {}) {
    const usedIds=used.ids??new Set<string>(),usedLinks=used.links??new Set<string>(),usedHashes=used.hashes??new Set<string>();
    return posts.filter((post) => {
      const hash = this.hash(this.normalize(this.sanitize(post.title + ' ' + post.body)));
      const normalized = this.normalize(this.sanitize(post.title + ' ' + post.body));
      return !post.stickied && !post.advertisement && !post.removed && (!config.excludeLocked || !post.locked) &&
        (config.allowNSFW || !post.nsfw) && (post.metadataAvailable === false || (post.score >= config.minimumScore && post.comments >= config.minimumComments)) &&
        (post.bodyAvailable === false || post.body.length >= config.minimumBodyLength) && !usedIds.has(post.id) && !usedLinks.has(post.permalink) &&
        !usedHashes.has(hash) && !(used.texts??[]).some((text)=>this.similarity(normalized, this.normalize(text)) >= 0.82) &&
        !this.unsafe(post.title + ' ' + post.body);
    }).sort((a, b) => this.score(b) - this.score(a));
  }

  private async eligible(config: RedditProjectConfig) {
    const subreddits = config.sourceMode === 'AUTO' || !config.subreddits.length ? [...APPROVED_SUBREDDITS] : config.subreddits;
    const batches: RedditPost[][] = [];
    let firstFetchError: unknown;
    for (const subreddit of subreddits) {
      try {
        batches.push(await this.api.listing(subreddit, config.sortMethod));
      } catch (error) {
        firstFetchError ??= error;
      }
    }
    if (batches.length === 0 && firstFetchError) throw firstFetchError;
    const prior = await RedditSourceModel.find({}, { redditPostId: 1, permalink: 1, contentHash: 1, originalTitle: 1, summary: 1 }).lean().exec();
    const usedIds = new Set(prior.map((item) => item.redditPostId)); const usedLinks = new Set(prior.map((item) => item.permalink));
    const usedHashes = new Set(prior.map((item) => item.contentHash));
    return this.filterAndRank(batches.flat(), config, { ids: usedIds, links: usedLinks, hashes: usedHashes,
      texts: prior.map((item) => [item.originalTitle, item.summary].filter(Boolean).join(' ')) }).slice(0, 25);
  }

  private unsafe(text: string) {
    const normalized = text.toLowerCase();
    return ['sexual minor', 'child pornography', 'how to kill', 'how to make a bomb', 'doxx'].some((term) => normalized.includes(term));
  }
  private score(post: RedditPost) {
    const ageHours = Math.max(1, (Date.now() / 1000 - post.createdUtc) / 3600);
    return Math.min(100, 20 / ageHours + Math.log10(post.score + 1) * 12 + Math.log10(post.comments + 1) * 10 +
      this.shortFit(post) * 20 + this.curiosity(post) * 15 + this.emotion(post) * 15);
  }
  private shortFit(post: RedditPost) { const words = (post.title + ' ' + post.body).split(/\s+/).length; return Math.max(0, 1 - Math.abs(words - 160) / 500); }
  private curiosity(post: RedditPost) { return /\?|secret|never|unexpected|found|realized|why/i.test(post.title) ? 1 : 0.65; }
  private emotion(post: RedditPost) { return /love|hate|cry|angry|afraid|shock|betray|family|friend/i.test(post.title + ' ' + post.body) ? 1 : 0.6; }
  private normalize(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  private similarity(left: string, right: string) {
    const a=new Set(left.split(' ').filter((word)=>word.length>3)),b=new Set(right.split(' ').filter((word)=>word.length>3));
    if (!a.size || !b.size) return 0; let overlap=0; for(const word of a)if(b.has(word))overlap+=1;
    return overlap/(a.size+b.size-overlap);
  }
  private hash(value: string) { return crypto.createHash('sha256').update(value).digest('hex'); }
}
