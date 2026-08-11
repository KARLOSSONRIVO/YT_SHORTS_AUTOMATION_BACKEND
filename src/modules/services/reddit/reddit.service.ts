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
  locked: boolean; removed: boolean; advertisement: boolean;
}

type RedditChild = { data?: Record<string, unknown> };
type RedditListing = { data?: { children?: RedditChild[] } };

export class RedditApiClient {
  private accessToken?: { value: string; expiresAt: number };
  constructor(private readonly clientId?: string, private readonly clientSecret?: string,
    private readonly userAgent = 'ShortsStudio/2.0', private readonly request: typeof fetch = fetch) {}

  public configured() { return Boolean(this.clientId && this.clientSecret && this.userAgent); }
  public async testConnection() { await this.token(); return { connected: true, officialApi: true }; }

  public async validateSubreddit(subreddit: string) {
    const response = await this.get('/r/' + this.cleanSubreddit(subreddit) + '/about');
    return { valid: Boolean((response as { data?: { display_name?: string } }).data?.display_name), subreddit: this.cleanSubreddit(subreddit) };
  }

  public async listing(subreddit: string, sort: RedditProjectConfig['sortMethod']) {
    const mapping: Record<RedditProjectConfig['sortMethod'], { path: string; time?: string }> = {
      NEW: { path: 'new' }, HOT: { path: 'hot' }, TOP_TODAY: { path: 'top', time: 'day' },
      TOP_WEEK: { path: 'top', time: 'week' }, RISING: { path: 'rising' }, BEST_ELIGIBLE: { path: 'top', time: 'day' }
    };
    const selected = mapping[sort]; const query = new URLSearchParams({ limit: '50', raw_json: '1' });
    if (selected.time) query.set('t', selected.time);
    const listing = await this.get('/r/' + this.cleanSubreddit(subreddit) + '/' + selected.path + '?' + query) as RedditListing;
    return (listing.data?.children ?? []).map((child) => this.normalize(child.data ?? {})).filter((post): post is RedditPost => Boolean(post));
  }

  private async get(path: string) {
    const token = await this.token();
    const response = await this.fetchWithRetry('https://oauth.reddit.com' + path, {
      headers: { Authorization: 'Bearer ' + token, 'User-Agent': this.userAgent, Accept: 'application/json' }
    });
    if (!response.ok) throw new AppError('Reddit API request failed with status ' + response.status + '.', 502, 'REDDIT_API_FAILED');
    return response.json();
  }

  private async token() {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 30_000) return this.accessToken.value;
    if (!this.clientId || !this.clientSecret) throw new AppError('Reddit API credentials are not configured.', 503, 'REDDIT_NOT_CONFIGURED');
    const basic = Buffer.from(this.clientId + ':' + this.clientSecret).toString('base64');
    const response = await this.fetchWithRetry('https://www.reddit.com/api/v1/access_token', {
      method: 'POST', headers: { Authorization: 'Basic ' + basic, 'User-Agent': this.userAgent, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials'
    });
    if (!response.ok) throw new AppError('Reddit authentication failed.', 502, 'REDDIT_AUTH_FAILED');
    const body = await response.json() as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new AppError('Reddit authentication returned no access token.', 502, 'REDDIT_AUTH_FAILED');
    this.accessToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  }

  private cleanSubreddit(value: string) { return value.trim().replace(/^r\//i, ''); }
  private async fetchWithRetry(url: string, init: RequestInit) {
    let response: Response | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await this.request(url, init);
      if (response.status !== 429 && response.status < 500) return response;
    }
    return response!;
  }
  private normalize(data: Record<string, unknown>): RedditPost | null {
    const body = String(data.selftext ?? '').trim();
    if (!data.id || !data.title || !data.permalink || !body) return null;
    return {
      id: String(data.id), subreddit: String(data.subreddit ?? ''), permalink: 'https://www.reddit.com' + String(data.permalink),
      title: String(data.title).trim(), body, author: data.author ? String(data.author) : undefined,
      createdUtc: Number(data.created_utc ?? 0), score: Number(data.score ?? 0), comments: Number(data.num_comments ?? 0),
      nsfw: Boolean(data.over_18), stickied: Boolean(data.stickied), locked: Boolean(data.locked),
      removed: body === '[removed]' || body === '[deleted]', advertisement: Boolean(data.promoted)
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
    return {
      topic: 'Reddit submission from r/' + post.subreddit, title: this.sanitize(post.title).slice(0, 100),
      summary: 'A Reddit user submitted this personal account: ' + words, storyAngle: 'Retell as an anonymized, unverified personal account',
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
        (config.allowNSFW || !post.nsfw) && post.score >= config.minimumScore && post.comments >= config.minimumComments &&
        post.body.length >= config.minimumBodyLength && !usedIds.has(post.id) && !usedLinks.has(post.permalink) &&
        !usedHashes.has(hash) && !(used.texts??[]).some((text)=>this.similarity(normalized, this.normalize(text)) >= 0.82) &&
        !this.unsafe(post.title + ' ' + post.body);
    }).sort((a, b) => this.score(b) - this.score(a));
  }

  private async eligible(config: RedditProjectConfig) {
    const subreddits = config.sourceMode === 'AUTO' || !config.subreddits.length ? [...APPROVED_SUBREDDITS] : config.subreddits;
    const batches = await Promise.all(subreddits.map((subreddit) => this.api.listing(subreddit, config.sortMethod)));
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
